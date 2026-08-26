'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('host entry loads without synchronously requiring ESM peers', () => {
  const plugin = require('..');

  assert.equal(plugin.name, 'dsh-client-masquerade');
  assert.equal(plugin.apply.constructor.name, 'AsyncFunction');
  assert.deepEqual(plugin.inject, ['settings', 'tools', 'llm', 'webServer']);
});

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ROOT = join(__dirname, '..');
const HALVES = [['index.js', 'index.js'], ['host.body.js', 'host.body.js']];
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
/** The claude-code preset literal, isolated from the codex one. */
const claudeBlock = (src) => src.slice(src.indexOf("'claude-code': {"), src.indexOf("'codex': {"));

// Regression guard: both host halves must ship a real user-agent in every
// preset. Without it, User-Agent-fingerprinting gateways (agentrouter et al.)
// keep seeing "deepseek-harness/..." and reject the disguised request.
for (const [variant, file] of HALVES) {
  test(`${variant} claude-code preset ships a real claude-cli user-agent`, () => {
    const block = claudeBlock(read(file));
    assert.match(block, /'user-agent': 'claude-cli\/' \+ CLAUDE_CLI_VERSION \+ ' \(external, cli\)'/,
      `${file}: claude-code preset must build its user-agent from CLAUDE_CLI_VERSION`);
  });

  test(`${variant} codex preset ships the real codex-tui user-agent`, () => {
    assert.ok(read(file).includes("'user-agent': 'codex-tui/0.145.0"),
      `${file}: codex preset must include a codex-tui user-agent`);
  });

  test(`${variant} claude-code preset includes Anthropic API version`, () => {
    assert.ok(claudeBlock(read(file)).includes("'anthropic-version': '2023-06-01'"),
      `${file}: claude-code preset must include anthropic-version`);
  });

  // The observed AnyRouter behaviour: without an anthropic-beta opt-in the
  // gateway refuses with 400 "1m 上下文已经全量可用，请启用 1m 上下文后重试".
  test(`${variant} claude-code preset opts into the 1m-context beta`, () => {
    const src = read(file);
    assert.ok(claudeBlock(src).includes("'anthropic-beta': CLAUDE_CODE_BETA"),
      `${file}: claude-code preset must send anthropic-beta`);
    assert.ok(src.includes('context-1m-2025-08-07'),
      `${file}: the beta list must opt into context-1m-2025-08-07`);
  });

  // Captured from the real client; gateways gate on the claude-cli version.
  test(`${variant} claude-cli fingerprint matches the captured 2.1.241 client`, () => {
    const src = read(file);
    assert.ok(src.includes("const CLAUDE_CLI_VERSION = '2.1.241'"),
      `${file}: must claim the captured claude-cli version`);
    assert.ok(src.includes("const CLAUDE_STAINLESS_VERSION = '0.112.1'"),
      `${file}: must claim the stainless version the captured client sent`);
  });

  // A frozen per-session UUID is a worse fingerprint than none at all.
  test(`${variant} does not spoof the per-session claude-code session id`, () => {
    assert.ok(!claudeBlock(read(file)).includes('x-claude-code-session-id'),
      `${file}: x-claude-code-session-id must not be a constant preset header`);
  });

  // The core honesty fix: a relay with no free upstream channel rejects a REAL
  // Claude Code CLI identically, so it must not be reported as a disguise fault.
  test(`${variant} classifies a saturated gateway as not-the-disguise`, () => {
    const src = read(file);
    assert.ok(src.includes('disguiseImplicated'),
      `${file}: classification must state whether the disguise is implicated`);
    assert.ok(src.includes('get_channel_failed'),
      `${file}: must recognise the new-api no-available-channel signature`);
    assert.match(src, /RETRYABLE_STATUS = \/\\b\(429\|/,
      `${file}: 429 must be retryable — these relays answer 429 with a bare "Service Unavailable"`);
  });

  test(`${variant} retries a transient rejection before judging the disguise`, () => {
    const src = read(file);
    assert.ok(src.includes('TEST_ATTEMPTS'), `${file}: must define a retry budget`);
    assert.ok(src.includes('while (attempts < TEST_ATTEMPTS)'), `${file}: test must retry`);
  });

  // An upgraded plugin must not silently mislabel an old disguise as "custom".
  test(`${variant} flags a stale preset written by an older version`, () => {
    const src = read(file);
    assert.ok(src.includes('detectPresetDetailed'), `${file}: must expose detailed detection`);
    assert.ok(src.includes('stale: true'), `${file}: must report family matches as stale`);
  });
}

test('pi-ai patch removes case-variant user-agent duplicates before writing the wire header', () => {
  const src = read(join('patches', 'patch-lib.js'));
  assert.ok(src.includes("lower !== \\'user-agent\\'"));
  assert.ok(src.includes("name.toLowerCase() === \\'user-agent\\'"));
});

// Behavioural checks on the real exported logic, not just its source text.
test('detectPresetDetailed distinguishes exact, stale, custom and empty', () => {
  const src = read('index.js');
  // Evaluate the pure helpers in isolation: they precede apply() and touch no ctx.
  const cut = src.indexOf('/** Resolve the installed');
  const sandbox = { module: { exports: {} }, require, console };
  const factory = new Function('module', 'require', 'console',
    src.slice(src.indexOf('const CLAUDE_CLI_VERSION'), cut) +
    '\nmodule.exports = { PRESETS, detectPresetDetailed, classifyCallError, RETRYABLE_STATUS };');
  factory(sandbox.module, require, console);
  const { PRESETS, detectPresetDetailed, classifyCallError } = sandbox.module.exports;

  assert.deepEqual(detectPresetDetailed(PRESETS['claude-code']), { active: 'claude-code', stale: false });
  assert.deepEqual(detectPresetDetailed(PRESETS['codex']), { active: 'codex', stale: false });
  assert.deepEqual(detectPresetDetailed({}), { active: null, stale: false });
  // What an older plugin version left in settings.yaml.
  assert.deepEqual(
    detectPresetDetailed({ 'user-agent': 'claude-cli/2.1.206 (external, cli)', 'anthropic-client': 'claude-code/2.1.206' }),
    { active: 'claude-code', stale: true }
  );
  assert.deepEqual(detectPresetDetailed({ 'x-custom': '1' }), { active: 'custom', stale: false });

  // The exact rejections observed from anyrouter.top during diagnosis.
  const saturated = classifyCallError('503 {"error":{"message":"Service Unavailable","type":"error"},"type":"error"}');
  assert.equal(saturated.category, 'upstream-saturated');
  assert.equal(saturated.disguiseImplicated, false);

  const throttled = classifyCallError('429 {"error":{"message":"Service Unavailable","type":"error"},"type":"error"}');
  assert.equal(throttled.disguiseImplicated, false, '429 + "Service Unavailable" is a channel shortage, not a disguise fault');

  const noChannel = classifyCallError('500 当前模型 gpt-5.6-sol 负载已经达到上限，请稍后重试 code:get_channel_failed');
  assert.equal(noChannel.category, 'no-upstream-channel');
  assert.equal(noChannel.disguiseImplicated, false);

  const gate = classifyCallError('400 {"error":"1m 上下文已经全量可用，请启用 1m 上下文后重试"}');
  assert.equal(gate.category, 'policy-gate');
  assert.equal(gate.disguiseImplicated, true);

  const auth = classifyCallError('401 UNAUTHENTICATED');
  assert.equal(auth.category, 'auth');
  assert.equal(auth.disguiseImplicated, true);
});

// Switching presets must never leave a previous preset's identity headers
// behind, including the ones added for the beta gate.
test('every preset key is tracked for cleanup', () => {
  const src = read('index.js');
  const cut = src.indexOf('/** Resolve the installed');
  const sandbox = { module: { exports: {} } };
  const factory = new Function('module', 'require', 'console',
    src.slice(src.indexOf('const CLAUDE_CLI_VERSION'), cut) + '\nmodule.exports = { PRESETS, SPOOF_KEYS };');
  factory(sandbox.module, require, console);
  const { PRESETS, SPOOF_KEYS } = sandbox.module.exports;
  for (const id of Object.keys(PRESETS)) {
    for (const name of Object.keys(PRESETS[id])) {
      assert.ok(SPOOF_KEYS.includes(name), `${name} (from ${id}) must be in SPOOF_KEYS so off/switch removes it`);
    }
  }
  assert.ok(SPOOF_KEYS.includes('anthropic-beta'), 'the beta header must be cleanable');
});
