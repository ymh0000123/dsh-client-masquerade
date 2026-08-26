#!/usr/bin/env node
// Apply the retry-policy forwarding patch to the installed
// @anionex/dsh-vision-toolkit image-input-variants.js so every
// `vision-toolkit-<upstream>` wrapper route inherits the upstream route's
// resolved retry policy (including a queue-adaptive one).
//
// Why: ImageInputVariantAdapter delegates streams to the upstream route but
// never implements `providerRetryPolicy`, so the variant registration falls
// back to the DEFAULT policy (5 retries, 500ms→10s) no matter what retryPolicy
// the upstream profile carries — the "still only retries five times" symptom
// when the agent's default model is a vision-toolkit-* wrapper (e.g.
// vision-toolkit-anyrouter).
//
// Usage (run from your DSH profile directory, e.g. the dir containing node_modules):
//   node patches/apply-variant-retry-patch.mjs              # apply (default)
//   node patches/apply-variant-retry-patch.mjs --revert      # revert to stock
// Or point at the installed file directly:
//   node patches/apply-variant-retry-patch.mjs --target <path/to/.../lib/image-input-variants.js>
//
// Idempotent: safe to run again (e.g. after reinstalling/upgrading dsh-vision-toolkit).
// A server restart is required for the change to take effect.
//
// The VARIANT_* strings and apply/revert logic live in patch-lib.js (shared
// with the installed Host plugin so the web settings page can apply and revert
// the same patch).

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { applyVariantRetryPatch, revertVariantRetryPatch } = require('./patch-lib.js');
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** Resolve the installed @anionex/dsh-vision-toolkit image-input-variants.js from a package.json root. */
function resolveFromRoot(root) {
  const requireRoot = createRequire(join(root, 'package.json'));
  try {
    const pkg = requireRoot.resolve('@anionex/dsh-vision-toolkit/package.json');
    return join(dirname(pkg), 'lib', 'image-input-variants.js');
  } catch {
    return undefined;
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
    const candidate = join(dir, 'node_modules', '@anionex', 'dsh-vision-toolkit', 'lib', 'image-input-variants.js');
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
    'could not resolve @anionex/dsh-vision-toolkit (this patch is only needed when the agent ' +
    'uses a vision-toolkit-<upstream> wrapper route); run this script from your DSH profile ' +
    'directory (the one containing node_modules, e.g. ' + join(dshHome, 'profiles', 'web') + ') ' +
    'or pass --target <path/to/.../lib/image-input-variants.js>'
  );
}

const target = resolveTarget();
try {
  if (process.argv.indexOf('--revert') >= 0) {
    const result = revertVariantRetryPatch(target);
    if (result.alreadyStock) {
      console.log('already stock (no patch): ' + target);
    } else {
      console.log('reverted: ' + target);
      console.log('restart dsh web for the change to take effect.');
    }
    process.exit(0);
  }
  const result = applyVariantRetryPatch(target);
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
