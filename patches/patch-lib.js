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
 * @param {string} target - absolute path of the installed lib/index.js.
 * @returns {{ reverted: boolean, alreadyStock: boolean }} reverted=true when the file was rewritten.
 * @throws {Error} when neither the stock nor the patched block is found (version drift).
 */
function revertPatch(target) {
  const src = readFileSync(target, 'utf8');
  if (src.includes(OLD)) return { reverted: false, alreadyStock: true };
  if (!src.includes(NEW)) {
    throw new Error(
      'neither the stock nor the patched requestHeaders block found in ' + target +
      '; the installed dsh-llm-pi-ai may differ from the version this patch targets'
    );
  }
  writeFileSync(target, src.replace(NEW, OLD), 'utf8');
  return { reverted: true, alreadyStock: false };
}

module.exports = { OLD, NEW, MARKER, applyPatch, revertPatch };
