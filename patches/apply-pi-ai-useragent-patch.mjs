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
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { applyPatch } = require('./patch-lib.js');
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Resolve the installed @deepseek-ai/dsh-llm-pi-ai lib/index.js from a package.json root. */
function resolveFromRoot(root) {
  const requireRoot = createRequire(join(root, 'package.json'));
  try {
    return requireRoot.resolve('@deepseek-ai/dsh-llm-pi-ai');
  } catch {
    const pkg = requireRoot.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json');
    return join(dirname(pkg), 'lib', 'index.js');
  }
}

/**
 * Walk up from the script's own location to find the profile that actually
 * installed this plugin (works with an absolute script path from anywhere;
 * for pnpm isolated installs the walk still reaches the profile root).
 */
function resolveFromScriptLocation() {
  let dir = SCRIPT_DIR;
  for (;;) {
    const candidate = join(dir, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function resolveTarget() {
  const i = process.argv.indexOf('--target');
  if (i >= 0 && process.argv[i + 1]) return resolve(process.argv[i + 1]);
  // 1) The current directory (documented usage: run from the profile dir).
  try {
    return resolveFromRoot(process.cwd());
  } catch {}
  // 2) The script's own install location — the profile this plugin is installed in.
  const fromScript = resolveFromScriptLocation();
  if (fromScript !== undefined) return fromScript;
  // 3) Last resort: any DSH profile under $DSH_HOME/profiles (or ~/.dsh/profiles).
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const profilesDir = join(dshHome, 'profiles');
  try {
    for (const name of readdirSync(profilesDir)) {
      try {
        return resolveFromRoot(join(profilesDir, name));
      } catch {}
    }
  } catch {}
  throw new Error(
    'could not resolve @deepseek-ai/dsh-llm-pi-ai; run this script from your DSH profile directory ' +
    '(the one containing node_modules, e.g. ' + join(dshHome, 'profiles', 'web') + ') ' +
    'or pass --target <path/to/dsh-llm-pi-ai/lib/index.js>'
  );
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
