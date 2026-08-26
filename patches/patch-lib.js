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
const { readFileSync, writeFileSync } = require('node:fs');

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
  writeFileSync(target, src.replace(OLD, NEW), 'utf8');
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
    writeFileSync(target, src.replace(NEW, OLD), 'utf8');
    return { reverted: true, alreadyStock: false };
  }
  if (src.includes(NEW_LEGACY)) {
    writeFileSync(target, src.replace(NEW_LEGACY, OLD), 'utf8');
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
  writeFileSync(target, src.replace(VARIANT_ANCHOR, VARIANT_PATCHED), 'utf8');
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
  writeFileSync(target, src.replace(VARIANT_PATCHED, VARIANT_ANCHOR), 'utf8');
  return { reverted: true, alreadyStock: false };
}

module.exports = { OLD, NEW, NEW_LEGACY, MARKER, applyPatch, revertPatch, VARIANT_MARKER, VARIANT_ANCHOR, VARIANT_PATCHED, applyVariantRetryPatch, revertVariantRetryPatch };
