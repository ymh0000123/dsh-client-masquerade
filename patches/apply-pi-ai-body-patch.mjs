#!/usr/bin/env node
// Apply the request-body masquerade patch to the installed
// @earendil-works/pi-ai anthropic-messages API, so a provider route can present
// a body that satisfies a relay's Claude Code check.
//
// Why: anyrouter-family relays (new-api derivatives) fingerprint the request
// BODY, not just its headers. Measured by ablation against a live route, they
// refuse a body that lacks any of: a JSON `metadata.user_id` (device_id
// non-empty, session_id UUID-shaped), a client-identity `system` block, or
// verbatim Glob/Grep/Read tool definitions. The refusal is a bare 429/503
// "Service Unavailable" — the same answer a genuinely busy channel pool gives,
// which is why this failure is so often misread as queueing and "fixed" with
// more retries that can never succeed.
//
// The patch is INERT by itself: it only acts on routes whose profile carries
// `x-dsh-body-masquerade: claude-code[:<deviceId>]`, a header the patch also
// strips before the request goes out. Turn it on per provider with:
//   mask_client action=body state=on provider=<id>
//
// Usage (run from your DSH profile directory, e.g. the dir containing node_modules):
//   node patches/apply-pi-ai-body-patch.mjs              # apply (default)
//   node patches/apply-pi-ai-body-patch.mjs --revert     # revert to stock
// Or point at the installed file directly:
//   node patches/apply-pi-ai-body-patch.mjs --target <path/to/dist/api/anthropic-messages.js>
//
// Idempotent: safe to run again (e.g. after reinstalling/upgrading pi-ai).
// A server restart is required for the change to take effect.
//
// The patch text and apply/revert logic live in patch-lib.js (shared with the
// installed Host plugin so the web settings page applies the same patch), and
// the captured Claude Code traits live in claude-code-fingerprint.js.

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { applyBodyPatch, revertBodyPatch, FINGERPRINT } = require('./patch-lib.js');
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const REL_PATH = ['dist', 'api', 'anthropic-messages.js'];
const REL_FROM_MODULES = join('node_modules', '@earendil-works', 'pi-ai', ...REL_PATH);

/**
 * Resolve the installed @earendil-works/pi-ai messages API under a root dir.
 *
 * Deliberately a filesystem lookup rather than createRequire().resolve(): pi-ai
 * ships an `exports` map that exposes neither `./package.json` nor a
 * CJS-resolvable main, so every require.resolve form throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED regardless of where the package actually is.
 */
function resolveFromRoot(root) {
  const candidate = join(root, REL_FROM_MODULES);
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Walk up from the script's own location to find the profile that actually
 * installed this plugin (works with an absolute script path from anywhere;
 * for pnpm isolated installs the walk still reaches the profile root).
 */
function resolveFromScriptLocation() {
  let dir = SCRIPT_DIR;
  for (;;) {
    const candidate = join(dir, REL_FROM_MODULES);
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
  const fromCwd = resolveFromRoot(process.cwd());
  if (fromCwd !== undefined) return fromCwd;
  // 2) The script's own install location — the profile this plugin is installed in.
  const fromScript = resolveFromScriptLocation();
  if (fromScript !== undefined) return fromScript;
  // 3) Last resort: any DSH profile under $DSH_HOME/profiles (or ~/.dsh/profiles).
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const profilesDir = join(dshHome, 'profiles');
  try {
    for (const name of readdirSync(profilesDir)) {
      const found = resolveFromRoot(join(profilesDir, name));
      if (found !== undefined) return found;
    }
  } catch {}
  throw new Error(
    'could not resolve @earendil-works/pi-ai (the library dsh-llm-pi-ai builds Anthropic ' +
    'requests with); run this script from your DSH profile directory (the one containing ' +
    'node_modules, e.g. ' + join(dshHome, 'profiles', 'web') + ') or pass ' +
    '--target <path/to/dist/api/anthropic-messages.js>'
  );
}

const target = resolveTarget();
try {
  if (process.argv.indexOf('--revert') >= 0) {
    const result = revertBodyPatch(target);
    if (result.alreadyStock) {
      console.log('already stock (no patch): ' + target);
    } else {
      console.log('reverted: ' + target);
      console.log('restart dsh web for the change to take effect.');
    }
    process.exit(0);
  }
  const result = applyBodyPatch(target);
  if (result.alreadyPatched) {
    console.log('already patched: ' + target);
  } else {
    console.log('patched: ' + target);
    console.log('sentinel tools injected when a route opts in: ' + FINGERPRINT.sentinelTools.map((t) => t.name).join(', '));
    console.log('this patch is inert until a provider opts in:  mask_client action=body state=on provider=<id>');
    console.log('restart dsh web for the change to take effect.');
  }
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
