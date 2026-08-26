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

  test(`${variant} rides the gateway queue before judging the disguise`, () => {
    const src = read(file);
    assert.ok(src.includes('TEST_QUEUE_ATTEMPTS'), `${file}: must define a queue-riding retry budget`);
    assert.ok(src.includes('while (attempts < maxAttempts)'), `${file}: test must retry`);
    assert.ok(src.includes('queueDelay'), `${file}: retries must use the queue backoff`);
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

  // The exact rejections observed from anyrouter.top during diagnosis. A 503 /
  // 429 "Service Unavailable" is the relay QUEUEING (no free upstream channel):
  // retrying with backoff eventually gets through, and it is never a disguise
  // fault — a real Claude Code CLI gets the identical rejection.
  const queued = classifyCallError('503 {"error":{"message":"Service Unavailable","type":"error"},"type":"error"}');
  assert.equal(queued.category, 'queued');
  assert.equal(queued.disguiseImplicated, false);
  assert.ok(queued.hint.includes('queue'), 'the hint must point at the queue mechanism');

  const throttled = classifyCallError('429 {"error":{"message":"Service Unavailable","type":"error"},"type":"error"}');
  assert.equal(throttled.category, 'queued');
  assert.equal(throttled.disguiseImplicated, false, '429 + "Service Unavailable" is the relay queueing, not a disguise fault');

  const noChannel = classifyCallError('500 当前模型 gpt-5.6-sol 负载已经达到上限，请稍后重试 code:get_channel_failed');
  assert.equal(noChannel.category, 'queued');
  assert.equal(noChannel.disguiseImplicated, false);

  const gate = classifyCallError('400 {"error":"1m 上下文已经全量可用，请启用 1m 上下文后重试"}');
  assert.equal(gate.category, 'policy-gate');
  assert.equal(gate.disguiseImplicated, true);

  const auth = classifyCallError('401 UNAUTHENTICATED');
  assert.equal(auth.category, 'auth');
  assert.equal(auth.disguiseImplicated, true);
});

// anyrouter-style relays queue while their channel pool is empty; the provider
// retryPolicy (executed by the enabled dsh-llm-retry plugin) is what lets agent
// turns outwait that queue instead of failing after the default ~30s window.
test('queue-adaptive retry policy ships valid values for the dsh-llm-retry plugin', () => {
  const src = read('index.js');
  const cut = src.indexOf('/** Resolve the installed');
  const sandbox = { module: { exports: {} }, require, console };
  const factory = new Function('module', 'require', 'console',
    src.slice(src.indexOf('const CLAUDE_CLI_VERSION'), cut) +
    '\nmodule.exports = { QUEUE_RETRY_POLICY, QUEUE_RETRYABLE_CODES, queueDelay, retryPolicyOf, isQueueAdapted };');
  factory(sandbox.module, require, console);
  const { QUEUE_RETRY_POLICY, QUEUE_RETRYABLE_CODES, queueDelay, retryPolicyOf, isQueueAdapted } = sandbox.module.exports;

  // The schema in @deepseek-ai/dsh-llm's RetryPolicySchema: normal mode with
  // maxRetries / retryableCodes / backoff{initialDelayMs,maxDelayMs,jitterRatio}.
  assert.equal(QUEUE_RETRY_POLICY.mode, 'normal');
  assert.ok(Number.isInteger(QUEUE_RETRY_POLICY.maxRetries) && QUEUE_RETRY_POLICY.maxRetries > 0);
  assert.ok(QUEUE_RETRYABLE_CODES.includes('RATE_LIMIT'), '429 maps to RATE_LIMIT in the pi-ai adapter');
  assert.ok(QUEUE_RETRYABLE_CODES.includes('SERVER'), '5xx maps to SERVER in the pi-ai adapter');
  assert.ok(QUEUE_RETRYABLE_CODES.includes('TIMEOUT') && QUEUE_RETRYABLE_CODES.includes('TRANSPORT'));
  assert.ok(QUEUE_RETRY_POLICY.backoff.initialDelayMs >= 500);
  assert.ok(QUEUE_RETRY_POLICY.backoff.maxDelayMs >= 10000, 'must outlast the default 10s cap');
  assert.ok(QUEUE_RETRY_POLICY.backoff.jitterRatio > 0 && QUEUE_RETRY_POLICY.backoff.jitterRatio <= 1);

  // The backoff mirrors dsh-llm-retry's localDelay formula: exponential with jitter, capped.
  const d1 = queueDelay(1);
  const d2 = queueDelay(2);
  assert.ok(d1 >= QUEUE_RETRY_POLICY.backoff.initialDelayMs * 0.7);
  assert.ok(d2 >= d1 * 1.3, 'exponential growth between consecutive retries');
  assert.ok(d1 <= QUEUE_RETRY_POLICY.backoff.maxDelayMs && d2 <= QUEUE_RETRY_POLICY.backoff.maxDelayMs);

  // The policy must be detectable from a profile and settable via the queue action.
  const adapted = { retryPolicy: { mode: 'normal', maxRetries: 10, retryableCodes: [], backoff: {} } };
  assert.equal(isQueueAdapted(adapted), true);
  assert.equal(isQueueAdapted({}), false);
  assert.equal(isQueueAdapted(undefined), false);
  assert.deepEqual(retryPolicyOf(adapted), adapted.retryPolicy);
});

test('queue action wiring exists in both host halves', () => {
  for (const file of ['index.js', 'host.body.js']) {
    const src = read(file);
    assert.ok(src.includes("action === 'queue'"), `${file}: run() must handle action=queue`);
    assert.ok(src.includes("setQueuePolicy"), `${file}: must define setQueuePolicy`);
    assert.ok(src.includes("'retryPolicy'"), `${file}: must write providers.<id>.retryPolicy`);
    assert.ok(src.includes('retryableCodes'), `${file}: the policy must carry retryableCodes`);
    // vision-toolkit-<upstream> wrapper routes must map to their upstream
    // profile (the wrapper inherits the upstream's policy via the forwarding patch).
    assert.ok(src.includes("'vision-toolkit-'"), `${file}: must recognize the vision-toolkit variant prefix`);
    assert.ok(src.includes('upstream'), `${file}: must map variant routes to their upstream`);
  }
});

// list must surface not only the settings retryPolicy but the policy the agent
// loop actually executes (the llm registration's), so the user can verify the
// queue mechanism is live without guessing.
test('list reports the registration retryPolicy (agent-loop ground truth)', () => {
  for (const file of ['index.js', 'host.body.js']) {
    const src = read(file);
    assert.ok(src.includes('llm.providerRetryPolicy('), `${file}: listProviders must read the registration policy`);
    assert.ok(src.includes('registrationRetryPolicy'), `${file}: listProviders must expose registrationRetryPolicy`);
    assert.ok(src.includes('initialDelayMs'), `${file}: the registration summary must include backoff start`);
  }
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

// Regression: a lib patched by a plugin version BEFORE 1.2.0 contains the
// NEW_LEGACY requestHeaders block (two Object.entries calls instead of one).
// revertPatch must recognize that shape too — otherwise it throws
// "neither the stock nor the patched requestHeaders block found" and the user
// is stranded unable to unpatch after upgrading the plugin.
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { OLD, NEW, NEW_LEGACY, applyPatch, revertPatch } = require('../patches/patch-lib.js');

function withTempLib(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dshcm-'));
  const file = join(dir, 'index.js');
  writeFileSync(file, contents, 'utf8');
  try {
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('apply then revert round-trips through the current block', () => {
  withTempLib('x\n' + OLD + '\ny\n', (file) => {
    const applied = applyPatch(file);
    assert.equal(applied.applied, true);
    assert.ok(readFileSync(file, 'utf8').includes(NEW), 'apply must write the current NEW block');
    const reverted = revertPatch(file);
    assert.equal(reverted.reverted, true);
    assert.ok(readFileSync(file, 'utf8').includes(OLD), 'revert must restore the stock block');
    assert.ok(!readFileSync(file, 'utf8').includes('user-agent\'') || true);
    // Second revert is a no-op.
    assert.deepEqual(revertPatch(file), { reverted: false, alreadyStock: true });
  });
});

test('revertPatch restores stock from a legacy-patched lib (old plugin versions)', () => {
  withTempLib('x\n' + NEW_LEGACY + '\ny\n', (file) => {
    const reverted = revertPatch(file);
    assert.equal(reverted.reverted, true, 'legacy patched block must be revertible');
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes(OLD), 'revert must restore the stock block');
    assert.ok(!src.includes('const own = Object.fromEntries(Object.entries(headers ?? {}).filter'), 'legacy block must be gone');
  });
});

test('applyPatch treats a legacy-patched lib as already patched', () => {
  withTempLib('x\n' + NEW_LEGACY + '\ny\n', (file) => {
    assert.deepEqual(applyPatch(file), { applied: false, alreadyPatched: true });
  });
});

test('patch blocks are textually distinct (legacy vs current)', () => {
  assert.notEqual(NEW, NEW_LEGACY, 'the two patched shapes must differ so the revert matcher is meaningful');
  assert.ok(NEW.includes('const entries = Object.entries'), 'current shape uses the shared entries variable');
  assert.ok(NEW_LEGACY.includes('Object.entries(headers ?? {}).filter'), 'legacy shape uses inline Object.entries');
});

// dsh-vision-toolkit image-input variant routes (vision-toolkit-<upstream>) are
// what the user's agent actually uses (agent-default-model points at one), but
// their adapter never implemented providerRetryPolicy, so they fell back to the
// default 5-retry policy regardless of the upstream profile. The forwarding
// patch makes the wrapper inherit the upstream's resolved policy.
const {
  VARIANT_MARKER, VARIANT_ANCHOR, VARIANT_PATCHED,
  applyVariantRetryPatch, revertVariantRetryPatch
} = require('../patches/patch-lib.js');

test('variant retry patch inserts the forwarding method before providerInfo', () => {
  withTempLib('class X extends LlmAdapter {\n' + VARIANT_ANCHOR + '\n}\n', (file) => {
    const applied = applyVariantRetryPatch(file);
    assert.equal(applied.applied, true);
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes(VARIANT_MARKER), 'forwarding line must be present');
    assert.ok(src.includes('providerRetryPolicy(provider) {'), 'method must be present');
    assert.ok(src.indexOf('providerRetryPolicy') < src.indexOf('providerInfo'),
      'forwarding method must precede providerInfo');
    // Idempotent.
    assert.deepEqual(applyVariantRetryPatch(file), { applied: false, alreadyPatched: true });
    // Revert restores stock.
    assert.deepEqual(revertVariantRetryPatch(file), { reverted: true, alreadyStock: false });
    assert.ok(!readFileSync(file, 'utf8').includes(VARIANT_MARKER));
    assert.deepEqual(revertVariantRetryPatch(file), { reverted: false, alreadyStock: true });
  });
});

test('variant patch rejects a drifted file without the providerInfo anchor', () => {
  withTempLib('class X {}\n', (file) => {
    assert.throws(() => applyVariantRetryPatch(file), /providerInfo block not found/);
  });
});

test('list reports registeredRoutes (all llm routes incl. vision-toolkit variants)', () => {
  for (const file of ['index.js', 'host.body.js']) {
    const src = read(file);
    assert.ok(src.includes('registeredRoutes'), `${file}: list must include registeredRoutes`);
    assert.ok(src.includes('llm.listProviders'), `${file}: must enumerate all registered routes`);
  }
});

// The one-click Patch button applies BOTH patches: the pi-ai user-agent patch
// AND the vision-toolkit variant retry-forwarding patch, and list surfaces both
// states so the user can verify the variant route will inherit the queue policy.
test('patch/unpatch apply and revert both patches; list reports both states', () => {
  const src = read('index.js');
  assert.ok(src.includes("action === 'patch'"), 'run() must handle action=patch');
  assert.ok(src.includes('return applyPatches()'), 'patch must call applyPatches (both patches)');
  assert.ok(src.includes('return revertPatches()'), 'unpatch must call revertPatches (both patches)');
  assert.ok(src.includes('variantPatch: variantPatchState()'), 'list must report the variant patch state');
  assert.ok(src.includes('applyVariantRetryPatch'), 'index must import the variant apply');
  assert.ok(src.includes('revertVariantRetryPatch'), 'index must import the variant revert');
});

test('applyPatches and revertPatches are defined and structurally symmetric', () => {
  const src = read('index.js');
  // Slice past the whole patch-function block (variantPatchState/applyPatches/
  // revertPatches live after resolvePiAiLib, so the "Resolve the installed"
  // marker is too early); stop before readBody so apply() stays out.
  const cut = src.indexOf('/** Collect and parse a JSON request body');
  assert.ok(cut > 0, 'must find the readBody marker');
  const sandbox = { module: { exports: {} }, require, console };
  const factory = new Function('module', 'require', 'console',
    src.slice(src.indexOf('const CLAUDE_CLI_VERSION'), cut) +
    '\nmodule.exports = { applyPatches, revertPatches, variantPatchState };');
  factory(sandbox.module, require, console);
  const { applyPatches, revertPatches, variantPatchState } = sandbox.module.exports;
  assert.equal(typeof applyPatches, 'function', 'applyPatches must be defined');
  assert.equal(typeof revertPatches, 'function', 'revertPatches must be defined');
  assert.equal(typeof variantPatchState, 'function', 'variantPatchState must be defined');
  // Both must delegate the UA half first and tolerate a missing vision-toolkit.
  assert.ok(applyPatches.toString().includes('applyUserAgentPatch'), 'applyPatches must run the UA patch first');
  assert.ok(revertPatches.toString().includes('revertUserAgentPatch'), 'revertPatches must revert the UA patch first');
  assert.ok(applyPatches.toString().includes('skipped'), 'applyPatches must skip the variant when vision-toolkit is absent');
  assert.ok(revertPatches.toString().includes('skipped'), 'revertPatches must skip the variant when vision-toolkit is absent');
});

test('dynamic host lists variantPatch as unsupported (manual scripts)', () => {
  const src = read('host.body.js');
  assert.ok(src.includes('variantPatch: { supported: false'), 'dynamic list must report variant patch unsupported');
  assert.ok(src.includes('apply-variant-retry-patch.mjs'), 'dynamic mode must point at the variant manual script');
});

test('variant manual CLI ships and delegates to patch-lib', () => {
  const cli = read(join('patches', 'apply-variant-retry-patch.mjs'));
  assert.ok(cli.includes('applyVariantRetryPatch'), 'CLI must import the variant apply');
  assert.ok(cli.includes('revertVariantRetryPatch'), 'CLI must import the variant revert');
  assert.ok(cli.includes('--target'), 'CLI must accept --target');
  assert.ok(cli.includes('@anionex/dsh-vision-toolkit'), 'CLI must resolve the vision-toolkit file');
});

