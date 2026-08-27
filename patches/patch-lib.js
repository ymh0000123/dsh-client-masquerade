'use strict';
/**
 * Shared user-agent patch logic, used by both the manual CLI
 * (apply-pi-ai-useragent-patch.mjs) and the installed Host plugin (index.js)
 * so the OLD/NEW blocks never drift apart.
 *
 * The stock requestHeaders() strips any profile `user-agent` and always merges
 * `deepseek-harness/...` back in, so User-Agent-fingerprinting gateways
 * (agentrouter, claude-code-router style proxies) reject the disguised request
 * with 401 UNAUTHENTICATED. The patched version preserves an explicitly
 * configured profile `user-agent` on the wire and keeps the attribution
 * User-Agent only as the default when none is configured.
 */
const { readFileSync, writeFileSync, unlinkSync } = require('node:fs');

/**
 * Write a patched file WITHOUT following hard links.
 *
 * pnpm populates node_modules by hard-linking from its global content store, so
 * these target files typically have several links: the store copy, and one per
 * profile that installed the same version. A plain writeFileSync truncates the
 * shared inode, which silently patches every other profile and corrupts the
 * store (a later `pnpm install` then either serves patched files or fails its
 * integrity check). Unlinking first breaks this profile's link out of that set,
 * so the patch lands only where it was asked for.
 *
 * @param {string} target - path to overwrite.
 * @param {string} content - new file content.
 */
function writeDetached(target, content) {
  try {
    unlinkSync(target);
  } catch (e) {
    // A missing file is fine (we recreate it); anything else — a read-only dir,
    // a lock — will surface from the write below with a clearer message.
    if (e.code !== 'ENOENT') { /* fall through to write */ }
  }
  writeFileSync(target, content, 'utf8');
}

const OLD = [
  '/** Merge deployment headers while removing case-insensitive attribution collisions. */',
  'function requestHeaders(headers) {',
  '\tconst attribution = attributionHeaders();',
  '\tconst reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));',
  '\treturn {',
  '\t\t...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),',
  '\t\t...attribution',
  '\t};',
  '}'
].join('\n');

const NEW = [
  '/**',
  ' * Merge deployment headers while removing case-insensitive attribution',
  ' * collisions. An explicitly configured profile `user-agent` is preserved on',
  ' * the wire (masquerade routes rely on being able to spoof it); when the',
  ' * profile does not set one, the mandatory attribution User-Agent is merged as',
  ' * the default so every request still carries the harness identity.',
  ' */',
  'function requestHeaders(headers) {',
  '\tconst attribution = attributionHeaders();',
  '\tconst reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));',
  '\tconst entries = Object.entries(headers ?? {});',
  '\tconst configuredUserAgent = entries.find(([name]) => name.toLowerCase() === \'user-agent\');',
  '\tconst own = Object.fromEntries(entries.filter(([name]) => {',
  '\t\tconst lower = name.toLowerCase();',
  '\t\treturn !reserved.has(lower) && lower !== \'user-agent\';',
  '\t}));',
  '\tif (configuredUserAgent === void 0) return { ...own, ...attribution };',
  '\treturn { ...own, \'user-agent\': String(configuredUserAgent[1]) };',
  '}'
].join('\n');

/**
 * The patched block as shipped by plugin versions before 1.2.0. It has the same
 * wire behavior (identical reserved-set filtering) but a different textual
 * shape: it computed `own` and `configuredUserAgent` with two independent
 * Object.entries calls instead of one. A lib patched by an older version still
 * contains THIS block, so revert must recognize it too — otherwise revert
 * throws "neither the stock nor the patched requestHeaders block found".
 */
const NEW_LEGACY = [
  '/**',
  ' * Merge deployment headers while removing case-insensitive attribution',
  ' * collisions. An explicitly configured profile `user-agent` is preserved on',
  ' * the wire (masquerade routes rely on being able to spoof it); when the',
  ' * profile does not set one, the mandatory attribution User-Agent is merged as',
  ' * the default so every request still carries the harness identity.',
  ' */',
  'function requestHeaders(headers) {',
  '\tconst attribution = attributionHeaders();',
  '\tconst reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));',
  '\tconst own = Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase())));',
  '\tconst configuredUserAgent = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === \'user-agent\');',
  '\tif (configuredUserAgent === void 0) return { ...own, ...attribution };',
  '\treturn { ...own, \'user-agent\': String(configuredUserAgent[1]) };',
  '}'
].join('\n');

/** Marker comment the patched file contains; also used to detect the patch state. */
const MARKER = 'An explicitly configured profile `user-agent` is preserved';

/**
 * Apply the patch to one dsh-llm-pi-ai lib/index.js file. Idempotent.
 * @param {string} target - absolute path of the installed lib/index.js.
 * @returns {{ applied: boolean, alreadyPatched: boolean }} applied=true when the file was rewritten.
 * @throws {Error} when the expected requestHeaders block is not found (version drift).
 */
function applyPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (src.includes(MARKER)) return { applied: false, alreadyPatched: true };
  if (!src.includes(OLD)) {
    throw new Error(
      'requestHeaders block not found in ' + target +
      '; the installed dsh-llm-pi-ai may differ from the version this patch targets'
    );
  }
  writeDetached(target, src.replace(OLD, NEW));
  return { applied: true, alreadyPatched: false };
}

/**
 * Revert the patch, restoring the stock requestHeaders block. Idempotent.
 *
 * Recognizes both patched shapes: the current NEW block and the NEW_LEGACY
 * block older plugin versions wrote. Reverting a legacy-patched lib yields the
 * same stock result, so an upgrade never strands the user in the
 * "neither the stock nor the patched block found" dead end.
 *
 * @param {string} target - absolute path of the installed lib/index.js.
 * @returns {{ reverted: boolean, alreadyStock: boolean }} reverted=true when the file was rewritten.
 * @throws {Error} when neither the stock nor a known patched block is found (version drift).
 */
function revertPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (src.includes(OLD)) return { reverted: false, alreadyStock: true };
  if (src.includes(NEW)) {
    writeDetached(target, src.replace(NEW, OLD));
    return { reverted: true, alreadyStock: false };
  }
  if (src.includes(NEW_LEGACY)) {
    writeDetached(target, src.replace(NEW_LEGACY, OLD));
    return { reverted: true, alreadyStock: false };
  }
  throw new Error(
    'neither the stock nor a known patched requestHeaders block found in ' + target +
    '; the installed dsh-llm-pi-ai may differ from the version this patch targets'
  );
}

// ---------------------------------------------------------------------------
// dsh-vision-toolkit image-input variant retry-policy forwarding.
//
// @anionex/dsh-vision-toolkit registers a `vision-toolkit-<upstream>` wrapper
// route for every text-only upstream provider (the agent's default model here
// is `vision-toolkit-anyrouter`, NOT `anyrouter`). The wrapper delegates streams
// to the upstream route and its own comment says "the upstream route owns
// retry" — but ImageInputVariantAdapter never implements `providerRetryPolicy`,
// so the variant registration falls back to the DEFAULT policy (5 retries,
// 500ms→10s) no matter what retryPolicy the upstream profile carries. That is
// exactly why a queue-adaptive policy written to `anyrouter` never reached the
// user's agent turns.
//
// The patch adds the forwarding method so the variant route inherits the
// upstream route's resolved policy (queue-adaptive included):
//
//   providerRetryPolicy(provider) {
//     return this.llm.providerRetryPolicy(this.upstream);
//   }
// ---------------------------------------------------------------------------

/** Marker line the patched variant file contains (single line, present verbatim); also used to detect patch state. */
const VARIANT_MARKER = '        return this.llm.providerRetryPolicy(this.upstream);';

/** The stock anchor: the variant adapter's providerInfo method (stable across versions). */
const VARIANT_ANCHOR = [
  '    providerInfo(provider) {',
  '        return {',
  '            id: provider,',
  '            name: this.hidden() ? this.upstreamName : `${this.upstreamName}${VARIANT_SUFFIX}`,',
  '        };',
  '    }'
].join('\n');

/** The patched block: forwarding method inserted before providerInfo. */
const VARIANT_PATCHED = [
  '    providerRetryPolicy(provider) {',
  '        return this.llm.providerRetryPolicy(this.upstream);',
  '    }',
  '    providerInfo(provider) {',
  '        return {',
  '            id: provider,',
  '            name: this.hidden() ? this.upstreamName : `${this.upstreamName}${VARIANT_SUFFIX}`,',
  '        };',
  '    }'
].join('\n');

/**
 * Apply the variant retry-policy forwarding patch to one
 * dsh-vision-toolkit image-input-variants.js file. Idempotent.
 * @param {string} target - absolute path of the installed image-input-variants.js.
 * @returns {{ applied: boolean, alreadyPatched: boolean }}
 * @throws {Error} when the providerInfo anchor is not found (version drift).
 */
function applyVariantRetryPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (src.includes(VARIANT_MARKER)) return { applied: false, alreadyPatched: true };
  if (!src.includes(VARIANT_ANCHOR)) {
    throw new Error(
      'ImageInputVariantAdapter providerInfo block not found in ' + target +
      '; the installed dsh-vision-toolkit may differ from the version this patch targets'
    );
  }
  writeDetached(target, src.replace(VARIANT_ANCHOR, VARIANT_PATCHED));
  return { applied: true, alreadyPatched: false };
}

/**
 * Revert the variant retry-policy forwarding patch. Idempotent.
 * @param {string} target - absolute path of the installed image-input-variants.js.
 * @returns {{ reverted: boolean, alreadyStock: boolean }}
 * @throws {Error} when neither the stock nor the patched block is found (version drift).
 */
function revertVariantRetryPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (!src.includes(VARIANT_MARKER)) return { reverted: false, alreadyStock: true };
  if (!src.includes(VARIANT_PATCHED)) {
    throw new Error(
      'the patched variant providerRetryPolicy block was not found in ' + target +
      '; the installed dsh-vision-toolkit may differ from the version this patch targets'
    );
  }
  writeDetached(target, src.replace(VARIANT_PATCHED, VARIANT_ANCHOR));
  return { reverted: true, alreadyStock: false };
}

// ---------------------------------------------------------------------------
// Request-body Claude Code masquerade for anyrouter-family relays.
//
// Header spoofing alone cannot reach these gateways: they fingerprint the
// REQUEST BODY. Measured by ablation against a live anyrouter route, replaying
// a real claude-cli 2.1.241 request byte-for-byte (200 OK) and removing one
// thing at a time:
//
//   drop metadata                                     -> 503
//   metadata.user_id as a plain string (not JSON)      -> 503
//   metadata.user_id JSON with an empty session_id     -> 503
//   metadata.user_id JSON, session_id not UUID-shaped  -> 503
//   drop the client-identity system block              -> 503
//   rename the sentinel tools                          -> 429
//   27 invented tools at the same payload size         -> 429
//   16 low-traffic real tools (no Glob/Grep/Read)      -> 429
//   Glob + Grep + Read, by name                        -> 200
//
// So a provider route only clears the gate when its body carries a JSON
// metadata.user_id (device_id any non-empty value; session_id shaped like a
// UUID — `dsh-session-…` and bare 32-hex both answer 503), a client-identity
// system block, and the three sentinel tools by name. Appending them leaves the
// caller's own tools and messages intact — verified: appending or prepending
// extra tools, reordering them, shortening messages, and appending system text
// all still return 200.
//
// The tool DESCRIPTIONS turn out not to be checked (blanking them still returns
// 200), so a Claude Code release that merely rewords these tools does not break
// the disguise; they ship verbatim regardless, because that is what a real
// client sends and a relay that starts checking them would fail in a way
// indistinguishable from a busy gateway.
//
// The switch is a provider header, `x-dsh-body-masquerade: claude-code[:<id>]`,
// which the patched mergeHeaders strips so it never reaches the wire. Carrying
// the device id in that header keeps the injected code dependency-free: the
// plugin generates a stable id once, at the point it writes the header, and
// this patch only has to read it.
// ---------------------------------------------------------------------------

const FINGERPRINT = require('./claude-code-fingerprint.js');

/** Marker line the patched file contains; also used to detect the patch state. */
const BODY_MARKER = 'function applyDshClientMasquerade(params, options) {';

/** Provider header that switches body masquerade on, and carries the device id. */
const BODY_SWITCH_HEADER = 'x-dsh-body-masquerade';

/** Stock mergeHeaders: the internal switch header would otherwise reach the wire. */
const BODY_HEADERS_ANCHOR = [
  'function mergeHeaders(...headerSources) {',
  '    const merged = {};',
  '    for (const headers of headerSources) {',
  '        if (headers) {',
  '            Object.assign(merged, headers);',
  '        }',
  '    }',
  '    return merged;',
  '}'
].join('\n');

const BODY_HEADERS_PATCHED = [
  'function mergeHeaders(...headerSources) {',
  '    const merged = {};',
  '    for (const headers of headerSources) {',
  '        if (headers) {',
  '            Object.assign(merged, headers);',
  '        }',
  '    }',
  '    // dsh-client-masquerade: the body-masquerade switch is internal, never sent.',
  '    for (const name of Object.keys(merged)) {',
  `        if (name.toLowerCase() === "${BODY_SWITCH_HEADER}")`,
  '            delete merged[name];',
  '    }',
  '    return merged;',
  '}'
].join('\n');

/** Stock buildParams tail — the last mutation before the params object is returned. */
const BODY_PARAMS_ANCHOR = [
  '    if (options?.toolChoice) {',
  '        if (typeof options.toolChoice === "string") {',
  '            params.tool_choice = { type: options.toolChoice };',
  '        }',
  '        else {',
  '            params.tool_choice = options.toolChoice;',
  '        }',
  '    }',
  '    return params;'
].join('\n');

/**
 * The injected masquerade function plus the call site. Built from the captured
 * fingerprint module so the patch and the plugin's own copy cannot drift.
 */
const BODY_PARAMS_PATCHED = [
  '    if (options?.toolChoice) {',
  '        if (typeof options.toolChoice === "string") {',
  '            params.tool_choice = { type: options.toolChoice };',
  '        }',
  '        else {',
  '            params.tool_choice = options.toolChoice;',
  '        }',
  '    }',
  '    applyDshClientMasquerade(params, options);',
  '    return params;',
  '}',
  '// dsh-client-masquerade: captured from ' + FINGERPRINT.capturedFrom + '. Refresh',
  '// when Claude Code changes these tool descriptions — a stale fingerprint reads',
  '// exactly like a busy gateway (429), not like a broken disguise.',
  'const DSH_MASQUERADE_FINGERPRINT = ' + JSON.stringify({
    identitySystemBlock: FINGERPRINT.identitySystemBlock,
    sentinelTools: FINGERPRINT.sentinelTools
  }) + ';',
  'const DSH_MASQUERADE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;',
  '/**',
  ' * Derive a UUID-shaped id from an arbitrary seed, deterministically.',
  ' *',
  ' * The relay checks the SHAPE of metadata.user_id.session_id, not its value:',
  ' * a UUID passes, `dsh-session-…` and bare 32-hex answer 503. DSH session ids',
  ' * are not UUIDs, so they are folded into this shape rather than sent raw.',
  ' * Deterministic, so one DSH session keeps one identity across its requests;',
  ' * FNV-1a rather than crypto because the injected code stays import-free.',
  ' */',
  'function dshMasqueradeUuid(seed) {',
  '    let hex = "";',
  '    for (let lane = 0; lane < 4; lane++) {',
  '        let hash = (0x811c9dc5 ^ (lane * 0x9e3779b9)) >>> 0;',
  '        for (let i = 0; i < seed.length; i++) {',
  '            hash ^= seed.charCodeAt(i);',
  '            hash = Math.imul(hash, 0x01000193) >>> 0;',
  '        }',
  '        hex += hash.toString(16).padStart(8, "0");',
  '    }',
  '    // v4 layout: version nibble 4, variant nibble 8 — shaped like the real thing.',
  '    return [',
  '        hex.slice(0, 8),',
  '        hex.slice(8, 12),',
  '        "4" + hex.slice(13, 16),',
  '        "8" + hex.slice(17, 20),',
  '        hex.slice(20, 32),',
  '    ].join("-");',
  '}',
  '/**',
  ' * Make one request body look like Claude Code to a body-fingerprinting relay.',
  ' * Off unless the provider carries `' + BODY_SWITCH_HEADER + ': claude-code[:<deviceId>]`.',
  ' * Additive only: the caller\'s own system prompt, tools and messages survive,',
  ' * which is what keeps a masqueraded route usable as an ordinary route.',
  ' */',
  'function applyDshClientMasquerade(params, options) {',
  '    const headers = options?.headers;',
  '    if (!headers)',
  '        return;',
  '    let signal;',
  '    for (const [name, value] of Object.entries(headers)) {',
  `        if (name.toLowerCase() === "${BODY_SWITCH_HEADER}")`,
  '            signal = String(value ?? "").trim();',
  '    }',
  '    if (signal === undefined || !signal.startsWith("claude-code"))',
  '        return;',
  '    const fingerprint = DSH_MASQUERADE_FINGERPRINT;',
  '    // The relay reads metadata.user_id as JSON: device_id must be non-empty',
  '    // (its value is not checked) and session_id must be UUID-SHAPED. A plain',
  '    // string, an empty session_id, or a non-UUID one (`dsh-session-…`, bare',
  '    // 32-hex) all route to an empty channel pool and answer 503.',
  '    const configuredId = signal.includes(":") ? signal.slice(signal.indexOf(":") + 1) : "";',
  '    const deviceId = configuredId.length > 0 ? configuredId : "dsh-client-masquerade";',
  '    const currentUserId = typeof params.metadata?.user_id === "string" ? params.metadata.user_id : "";',
  '    if (!currentUserId.startsWith("{")) {',
  '        const rawSession = options?.sessionId === undefined ? "" : String(options.sessionId);',
  '        const sessionId = DSH_MASQUERADE_UUID_RE.test(rawSession)',
  '            ? rawSession',
  '            : dshMasqueradeUuid(rawSession.length > 0 ? rawSession : deviceId);',
  '        params.metadata = {',
  '            user_id: JSON.stringify({ device_id: deviceId, account_uuid: "", session_id: sessionId }),',
  '        };',
  '    }',
  '    // The identity block is what the relay looks for in `system`; prepend it',
  '    // rather than replacing, so the caller\'s instructions still apply.',
  '    const identityBlock = { type: "text", text: fingerprint.identitySystemBlock };',
  '    const carriesIdentity = (block) => typeof block?.text === "string" && block.text.includes(fingerprint.identitySystemBlock);',
  '    if (typeof params.system === "string") {',
  '        params.system = params.system.length > 0',
  '            ? [identityBlock, { type: "text", text: params.system }]',
  '            : [identityBlock];',
  '    }',
  '    else if (Array.isArray(params.system)) {',
  '        if (!params.system.some(carriesIdentity))',
  '            params.system = [identityBlock, ...params.system];',
  '    }',
  '    else {',
  '        params.system = [identityBlock];',
  '    }',
  '    // Sentinel tools are appended, so the model still sees the real toolset',
  '    // first. They are read-only by design: a model that reaches for one at',
  '    // worst attempts a search the harness cannot run.',
  '    const tools = Array.isArray(params.tools) ? params.tools : [];',
  '    const present = new Set(tools.map((tool) => tool?.name));',
  '    const missing = fingerprint.sentinelTools.filter((tool) => !present.has(tool.name));',
  '    if (missing.length > 0)',
  '        params.tools = [...tools, ...missing.map((tool) => ({ ...tool }))];'
].join('\n');

/**
 * Apply the body-masquerade patch to one pi-ai anthropic-messages.js. Idempotent.
 * @param {string} target - absolute path of the installed dist/api/anthropic-messages.js.
 * @returns {{ applied: boolean, alreadyPatched: boolean }}
 * @throws {Error} when either anchor is missing (version drift).
 */
function applyBodyPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (src.includes(BODY_MARKER)) return { applied: false, alreadyPatched: true };
  if (!src.includes(BODY_HEADERS_ANCHOR)) {
    throw new Error(
      'mergeHeaders block not found in ' + target +
      '; the installed @earendil-works/pi-ai may differ from the version this patch targets'
    );
  }
  if (!src.includes(BODY_PARAMS_ANCHOR)) {
    throw new Error(
      'buildParams tail not found in ' + target +
      '; the installed @earendil-works/pi-ai may differ from the version this patch targets'
    );
  }
  const patched = src
    .replace(BODY_HEADERS_ANCHOR, BODY_HEADERS_PATCHED)
    .replace(BODY_PARAMS_ANCHOR, BODY_PARAMS_PATCHED);
  writeDetached(target, patched);
  return { applied: true, alreadyPatched: false };
}

/**
 * Revert the body-masquerade patch. Idempotent.
 * @param {string} target - absolute path of the installed dist/api/anthropic-messages.js.
 * @returns {{ reverted: boolean, alreadyStock: boolean }}
 * @throws {Error} when the patched blocks are not found (hand-edited or drifted).
 */
function revertBodyPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (!src.includes(BODY_MARKER)) return { reverted: false, alreadyStock: true };
  if (!src.includes(BODY_HEADERS_PATCHED) || !src.includes(BODY_PARAMS_PATCHED)) {
    throw new Error(
      'the patched body-masquerade blocks were not found in ' + target +
      '; it may carry a patch from a different plugin version — reinstall @earendil-works/pi-ai to get a clean file'
    );
  }
  const reverted = src
    .replace(BODY_PARAMS_PATCHED, BODY_PARAMS_ANCHOR)
    .replace(BODY_HEADERS_PATCHED, BODY_HEADERS_ANCHOR);
  writeDetached(target, reverted);
  return { reverted: true, alreadyStock: false };
}

module.exports = {
  OLD, NEW, NEW_LEGACY, MARKER, applyPatch, revertPatch,
  VARIANT_MARKER, VARIANT_ANCHOR, VARIANT_PATCHED, applyVariantRetryPatch, revertVariantRetryPatch,
  BODY_MARKER, BODY_SWITCH_HEADER, BODY_HEADERS_ANCHOR, BODY_HEADERS_PATCHED, BODY_PARAMS_ANCHOR, BODY_PARAMS_PATCHED,
  applyBodyPatch, revertBodyPatch, FINGERPRINT
};
