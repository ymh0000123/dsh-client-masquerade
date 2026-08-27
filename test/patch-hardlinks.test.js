// Regression test for the hard-link hazard: pnpm hard-links node_modules files
// from its global content store, so every patch target typically shares an
// inode with the store copy and with the same version installed under other
// profiles. Writing in place would patch all of them at once — silently
// changing other profiles and corrupting the store. Each patch must break its
// own link first.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mkdtempSync, writeFileSync, readFileSync, linkSync, statSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const lib = require('../patches/patch-lib.js');

const PI_AI = 'C:/Users/ad/.dsh/profiles/web/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js';

/**
 * Stage a file as pnpm would: the "installed" path hard-linked to a "store"
 * path, so both names share one inode.
 */
function stageHardLinked(dir, name, content) {
  const store = join(dir, 'store-' + name);
  const installed = join(dir, 'installed-' + name);
  writeFileSync(store, content, 'utf8');
  linkSync(store, installed);
  assert.strictEqual(statSync(installed).nlink, 2, 'staging should produce two links');
  return { store, installed };
}

/**
 * The stock source the body patch expects.
 *
 * The installed file is normally ALREADY patched (that is the working state),
 * so a test that skipped in that case would never run where it matters. Instead
 * derive the stock text by reverting a scratch copy — that is exactly the round
 * trip revertBodyPatch guarantees, and it leaves the installed file untouched.
 */
function stockPiAiSource(t, dir) {
  let src;
  try {
    src = readFileSync(PI_AI, 'utf8');
  } catch {
    t.skip('@earendil-works/pi-ai is not installed in the reference profile');
    return undefined;
  }
  if (!src.includes(lib.BODY_MARKER)) return src;
  const scratch = join(dir, 'derive-stock.js');
  writeFileSync(scratch, src, 'utf8');
  lib.revertBodyPatch(scratch);
  return readFileSync(scratch, 'utf8');
}

test('applyBodyPatch breaks the hard link instead of writing through it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-link-'));
  try {
    const stock = stockPiAiSource(t, dir);
    if (stock === undefined) return;
    const { store, installed } = stageHardLinked(dir, 'anthropic-messages.js', stock);

    lib.applyBodyPatch(installed);

    assert.ok(readFileSync(installed, 'utf8').includes(lib.BODY_MARKER), 'the installed copy must be patched');
    assert.strictEqual(readFileSync(store, 'utf8'), stock, 'the store copy must be untouched');
    assert.strictEqual(statSync(installed).nlink, 1, 'the patched file must no longer share its inode');
    assert.strictEqual(statSync(store).nlink, 1, 'the store copy must be left on its own');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('revertBodyPatch also leaves other links alone', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-link-'));
  try {
    const stock = stockPiAiSource(t, dir);
    if (stock === undefined) return;
    // A profile that was patched, then hard-linked again (e.g. a second install).
    const patchedPath = join(dir, 'first.js');
    writeFileSync(patchedPath, stock, 'utf8');
    lib.applyBodyPatch(patchedPath);
    const patchedSource = readFileSync(patchedPath, 'utf8');

    const { store, installed } = stageHardLinked(dir, 'revert.js', patchedSource);
    lib.revertBodyPatch(installed);

    assert.ok(!readFileSync(installed, 'utf8').includes(lib.BODY_MARKER), 'the installed copy must be reverted');
    assert.strictEqual(readFileSync(store, 'utf8'), patchedSource, 'the other link must keep its content');
    assert.strictEqual(statSync(installed).nlink, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the user-agent patch breaks its hard link too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-link-'));
  try {
    const stock = 'header\n' + lib.OLD + '\nfooter\n';
    const { store, installed } = stageHardLinked(dir, 'lib-index.js', stock);

    lib.applyPatch(installed);

    assert.ok(readFileSync(installed, 'utf8').includes(lib.MARKER));
    assert.strictEqual(readFileSync(store, 'utf8'), stock, 'the store copy must be untouched');
    assert.strictEqual(statSync(installed).nlink, 1);

    // …and so does the revert.
    const { store: store2, installed: installed2 } = stageHardLinked(dir, 'lib-index-2.js', readFileSync(installed, 'utf8'));
    lib.revertPatch(installed2);
    assert.ok(readFileSync(installed2, 'utf8').includes(lib.OLD));
    assert.ok(readFileSync(store2, 'utf8').includes(lib.MARKER), 'the other link must keep the patched content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the vision-toolkit variant patch breaks its hard link too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-link-'));
  try {
    const stock = 'class X {\n' + lib.VARIANT_ANCHOR + '\n}\n';
    const { store, installed } = stageHardLinked(dir, 'variants.js', stock);

    lib.applyVariantRetryPatch(installed);

    assert.ok(readFileSync(installed, 'utf8').includes(lib.VARIANT_MARKER));
    assert.strictEqual(readFileSync(store, 'utf8'), stock, 'the store copy must be untouched');
    assert.strictEqual(statSync(installed).nlink, 1);

    const { store: store2, installed: installed2 } = stageHardLinked(dir, 'variants-2.js', readFileSync(installed, 'utf8'));
    lib.revertVariantRetryPatch(installed2);
    assert.ok(!readFileSync(installed2, 'utf8').includes(lib.VARIANT_MARKER));
    assert.ok(readFileSync(store2, 'utf8').includes(lib.VARIANT_MARKER), 'the other link must keep the patched content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('revertBodyPatch works on a block this version did not write', (t) => {
  // The injected text changes whenever the fingerprint or the injected logic
  // does. Revert therefore cuts on the delimiters, never on content: matching
  // content meant a lib patched by one version could not be un-patched by the
  // next, stranding the user on "the patched blocks were not found".
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-drift-'));
  try {
    const stock = stockPiAiSource(t, dir);
    if (stock === undefined) return;
    const target = join(dir, 'drifted.js');
    writeFileSync(target, stock, 'utf8');
    lib.applyBodyPatch(target);

    // Simulate a future version: same delimiters, different innards.
    const patched = readFileSync(target, 'utf8');
    const begin = patched.indexOf(lib.BODY_BEGIN);
    const end = patched.indexOf(lib.BODY_END);
    assert.ok(begin !== -1 && end > begin, 'the delimiters must be present');
    const drifted = patched.slice(0, begin) + lib.BODY_BEGIN
      + '\nfunction applyDshClientMasquerade(params, options) { /* a later version */ }\n'
      + 'const SOMETHING_NEW = 1;\n'
      + patched.slice(end);
    writeFileSync(target, drifted, 'utf8');
    assert.ok(readFileSync(target, 'utf8').includes(lib.BODY_MARKER), 'the drifted file still reads as patched');

    const result = lib.revertBodyPatch(target);
    assert.strictEqual(result.reverted, true);
    assert.strictEqual(readFileSync(target, 'utf8'), stock, 'a drifted block must still revert to exact stock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('revertBodyPatch refuses a file whose delimiters were hand-edited', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-drift-'));
  try {
    const stock = stockPiAiSource(t, dir);
    if (stock === undefined) return;
    const target = join(dir, 'mangled.js');
    writeFileSync(target, stock, 'utf8');
    lib.applyBodyPatch(target);
    // Remove the closing delimiter but leave the marker: an unrecognisable file.
    writeFileSync(target, readFileSync(target, 'utf8').replace(lib.BODY_END, ''), 'utf8');
    assert.throws(() => lib.revertBodyPatch(target), /not delimited as expected|hand-edited/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
