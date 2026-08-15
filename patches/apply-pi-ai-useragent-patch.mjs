#!/usr/bin/env node
// Apply the user-agent override patch to the installed @deepseek-ai/dsh-llm-pi-ai
// adapter so an explicitly configured profile `user-agent` reaches the wire
// (masquerade routes), while keeping the harness attribution User-Agent as the
// default when none is configured.
//
// Why: the stock requestHeaders() strips any profile `user-agent` and always
// merges `deepseek-harness/...` back in, so User-Agent-fingerprinting gateways
// (agentrouter, claude-code-router style proxies) reject the disguised request
// with 401 UNAUTHENTICATED.
//
// Usage (run from your DSH profile directory, e.g. the dir containing node_modules):
//   node patches/apply-pi-ai-useragent-patch.mjs
// Or point at the installed lib directly:
//   node patches/apply-pi-ai-useragent-patch.mjs --target <path/to/dsh-llm-pi-ai/lib/index.js>
//
// Idempotent: safe to run again (e.g. after reinstalling/upgrading dsh-llm-pi-ai).
// A server restart is required for the change to take effect.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const OLD = [
  '/** Merge deployment headers while removing case-insensitive attribution collisions. */',
  'function requestHeaders(headers) {',
  '\tconst attribution = attributionHeaders();',
  '\tconst reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));',
  '\treturn {',
  '\t\t...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),',
  '\t\t...attribution',
  '\t};',
  '}',
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
  '\tconst own = Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase())));',
  '\tconst configuredUserAgent = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === \'user-agent\');',
  '\tif (configuredUserAgent === void 0) return { ...own, ...attribution };',
  '\treturn { ...own, \'user-agent\': String(configuredUserAgent[1]) };',
  '}',
].join('\n');

const MARKER = 'An explicitly configured profile `user-agent` is preserved';

function resolveTarget() {
  const i = process.argv.indexOf('--target');
  if (i >= 0 && process.argv[i + 1]) return resolve(process.argv[i + 1]);
  const require = createRequire(join(process.cwd(), 'package.json'));
  try {
    return require.resolve('@deepseek-ai/dsh-llm-pi-ai');
  } catch {
    try {
      const pkg = require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json');
      return join(dirname(pkg), 'lib', 'index.js');
    } catch {
      throw new Error(
        'could not resolve @deepseek-ai/dsh-llm-pi-ai from ' + process.cwd() +
        '; run this script from your DSH profile directory (the one containing node_modules) ' +
        'or pass --target <path/to/lib/index.js>'
      );
    }
  }
}

const target = resolveTarget();
const src = readFileSync(target, 'utf8');

if (src.includes(MARKER)) {
  console.log('already patched: ' + target);
  process.exit(0);
}
if (!src.includes(OLD)) {
  throw new Error('requestHeaders block not found in ' + target + '; the installed dsh-llm-pi-ai may differ from the version this patch targets');
}
writeFileSync(target, src.replace(OLD, NEW), 'utf8');
console.log('patched: ' + target);
console.log('restart dsh web for the change to take effect.');
