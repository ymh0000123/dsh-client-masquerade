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
//
// The OLD/NEW/MARKER strings and the apply logic live in patch-lib.js (shared
// with the installed Host plugin so the web settings page can apply the same patch).

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { applyPatch } = require('./patch-lib.js');

function resolveTarget() {
  const i = process.argv.indexOf('--target');
  if (i >= 0 && process.argv[i + 1]) return resolve(process.argv[i + 1]);
  const requireCwd = createRequire(join(process.cwd(), 'package.json'));
  try {
    return requireCwd.resolve('@deepseek-ai/dsh-llm-pi-ai');
  } catch {
    try {
      const pkg = requireCwd.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json');
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
try {
  const result = applyPatch(target);
  if (result.alreadyPatched) {
    console.log('already patched: ' + target);
  } else {
    console.log('patched: ' + target);
    console.log('restart dsh web for the change to take effect.');
  }
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
