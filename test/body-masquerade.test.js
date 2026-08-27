// Behavioural test of the injected masquerade function, run against the exact
// source the patch inserts. It is extracted rather than re-implemented, so a
// drift between what the patch writes and what is tested here cannot hide.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  BODY_PARAMS_PATCHED, BODY_SWITCH_HEADER, BODY_HEADERS_PATCHED, BODY_HEADERS_ANCHOR, FINGERPRINT, SENTINEL_NOTICE
} = require('../patches/patch-lib.js');

/**
 * Compile the injected function out of the patch text and hand it back.
 *
 * The injected block is self-contained between its markers (that is what makes
 * revert version-independent), so the slice needs no synthetic closing brace.
 */
function loadInjected() {
  const begin = BODY_PARAMS_PATCHED.indexOf('const DSH_MASQUERADE_FINGERPRINT =');
  const end = BODY_PARAMS_PATCHED.lastIndexOf('// <<<');
  const body = BODY_PARAMS_PATCHED.slice(begin, end);
  // eslint-disable-next-line no-new-func -- compiling the shipped patch text is the point
  return new Function(`${body}\nreturn applyDshClientMasquerade;`)();
}

/** Compile the patched mergeHeaders so the strip behaviour is covered too. */
function loadMergeHeaders() {
  return new Function(`${BODY_HEADERS_PATCHED}\nreturn mergeHeaders;`)();
}

const apply = loadInjected();
const ON = { [BODY_SWITCH_HEADER]: 'claude-code:abc123' };
const SENTINELS = FINGERPRINT.sentinelTools.map((tool) => tool.name);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i;

test('off unless the switch header is present', () => {
  const params = { model: 'm', messages: [] };
  apply(params, { headers: { 'user-agent': 'claude-cli/2.1.241 (external, cli)' } });
  assert.deepStrictEqual(params, { model: 'm', messages: [] });

  apply(params, {});
  apply(params, undefined);
  assert.deepStrictEqual(params, { model: 'm', messages: [] });
});

test('off when the switch names a different mode', () => {
  const params = { model: 'm', messages: [] };
  apply(params, { headers: { [BODY_SWITCH_HEADER]: 'codex' } });
  assert.deepStrictEqual(params, { model: 'm', messages: [] });
});

test('injects the three things the relay gates on', () => {
  const params = { model: 'm', messages: [] };
  apply(params, { headers: ON, sessionId: 'sess-1' });

  const userId = JSON.parse(params.metadata.user_id);
  assert.strictEqual(userId.device_id, 'abc123');
  assert.strictEqual(userId.account_uuid, '');
  assert.match(userId.session_id, UUID_RE);

  assert.strictEqual(params.system[0].text, FINGERPRINT.identitySystemBlock);
  assert.deepStrictEqual(params.tools.map((tool) => tool.name), SENTINELS);
});

test('session_id is always UUID-shaped — the relay answers 503 to anything else', () => {
  // A DSH session id, an empty one, and a bare 32-hex string are all rejected
  // by the relay as-is, so each has to come out UUID-shaped.
  for (const sessionId of [undefined, '', 'sess-1', 'dsh-session-0123456789abcdef', '11111111222243338444555555555555']) {
    const params = { model: 'm', messages: [] };
    apply(params, { headers: ON, sessionId });
    assert.match(JSON.parse(params.metadata.user_id).session_id, UUID_RE, `sessionId=${JSON.stringify(sessionId)}`);
  }
});

test('a session id that is already a UUID is passed through untouched', () => {
  const real = '383e0f18-3b1f-4020-8a79-1662987b9d75';
  const params = { model: 'm', messages: [] };
  apply(params, { headers: ON, sessionId: real });
  assert.strictEqual(JSON.parse(params.metadata.user_id).session_id, real);
});

test('derived session ids are stable per session and differ between sessions', () => {
  const idFor = (sessionId) => {
    const params = { model: 'm', messages: [] };
    apply(params, { headers: ON, sessionId });
    return JSON.parse(params.metadata.user_id).session_id;
  };
  assert.strictEqual(idFor('sess-a'), idFor('sess-a'));
  assert.notStrictEqual(idFor('sess-a'), idFor('sess-b'));
});

test('falls back to a placeholder device id when the header carries none', () => {
  const params = { model: 'm', messages: [] };
  apply(params, { headers: { [BODY_SWITCH_HEADER]: 'claude-code' }, sessionId: 's' });
  assert.strictEqual(JSON.parse(params.metadata.user_id).device_id, 'dsh-client-masquerade');
});

test('additive: the caller keeps its own tools, system and messages', () => {
  const ownTool = { name: 'bash', description: 'DSH shell', input_schema: { type: 'object' } };
  const params = {
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    system: [{ type: 'text', text: 'DSH harness instructions' }],
    tools: [ownTool]
  };
  apply(params, { headers: ON, sessionId: 's' });

  assert.deepStrictEqual(params.messages, [{ role: 'user', content: 'hi' }]);
  // own tools stay first, so the model still reads the real toolset first
  assert.strictEqual(params.tools[0], ownTool);
  assert.deepStrictEqual(params.tools.slice(1).map((tool) => tool.name), SENTINELS);
  // identity leads, caller's own system prompt survives after it
  assert.strictEqual(params.system[0].text, FINGERPRINT.identitySystemBlock);
  assert.strictEqual(params.system[1].text, 'DSH harness instructions');
});

test('a string system prompt is promoted, not discarded', () => {
  const params = { model: 'm', messages: [], system: 'be terse' };
  apply(params, { headers: ON, sessionId: 's' });
  assert.deepStrictEqual(params.system.map((block) => block.text), [FINGERPRINT.identitySystemBlock, 'be terse']);

  const empty = { model: 'm', messages: [], system: '' };
  apply(empty, { headers: ON, sessionId: 's' });
  assert.deepStrictEqual(empty.system.map((block) => block.text), [FINGERPRINT.identitySystemBlock]);
});

test('idempotent: a second pass adds no duplicate identity block or sentinels', () => {
  const params = { model: 'm', messages: [] };
  apply(params, { headers: ON, sessionId: 's' });
  const afterFirst = JSON.stringify(params);
  apply(params, { headers: ON, sessionId: 's' });
  assert.strictEqual(JSON.stringify(params), afterFirst);
});

test('a caller-supplied JSON user_id is left alone', () => {
  const mine = JSON.stringify({ device_id: 'mine', account_uuid: '', session_id: 'x' });
  const params = { model: 'm', messages: [], metadata: { user_id: mine } };
  apply(params, { headers: ON, sessionId: 's' });
  assert.strictEqual(params.metadata.user_id, mine);
});

test('sentinel tools are advertised as unavailable, so the model leaves them alone', () => {
  // The harness does not implement these; with their captured descriptions in
  // place a model calls one, the harness has no result to return, and the turn
  // hangs after the model has already replied. Measured against a live route:
  // the gate is on tool NAMES, so the description is free to say "do not call".
  assert.deepStrictEqual(SENTINELS, ['Glob', 'Grep', 'Read']);

  const params = { model: 'm', messages: [] };
  apply(params, { headers: ON, sessionId: 's' });
  for (const tool of params.tools) {
    assert.strictEqual(tool.description, SENTINEL_NOTICE, `${tool.name} must advertise itself as unavailable`);
    assert.match(tool.description, /do not call/i);
  }
  // The captured descriptions still ship, for the day a relay checks them.
  for (const tool of FINGERPRINT.sentinelTools) {
    assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${tool.name} needs its captured description on file`);
    assert.ok(tool.input_schema && typeof tool.input_schema === 'object', `${tool.name} needs its input schema`);
  }
});

test('the switch header is stripped before the request reaches the wire', () => {
  const mergeHeaders = loadMergeHeaders();
  const merged = mergeHeaders(
    { 'user-agent': 'claude-cli/2.1.241 (external, cli)' },
    { [BODY_SWITCH_HEADER]: 'claude-code:abc123', 'X-DSH-Body-Masquerade': 'claude-code' },
    { 'x-app': 'cli' }
  );
  assert.deepStrictEqual(merged, {
    'user-agent': 'claude-cli/2.1.241 (external, cli)',
    'x-app': 'cli'
  });
});

test('the stock mergeHeaders anchor still merges as before', () => {
  const stock = new Function(`${BODY_HEADERS_ANCHOR}\nreturn mergeHeaders;`)();
  assert.deepStrictEqual(stock({ a: '1' }, undefined, { b: '2' }), { a: '1', b: '2' });
});
