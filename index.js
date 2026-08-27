'use strict';
/**
 * dsh-client-masquerade — installed (bundle) HOST half.
 *
 * This module is the cordis plugin the loader mounts when the package is
 * installed through the official CLI:
 *
 *   dsh plugin --profile web add github:ymh0000123/dsh-client-masquerade
 *
 * The `dsh.bundle.patch` layer (cordis.patch.yml) inserts this package's row;
 * the loader requires this main entry and uses its `name` + `apply` exports.
 * Unlike the dynamic-plugin variant (host.body.js), this half runs in the
 * host realm, so plain object literals are fine for settings.mutate and the
 * model tool registers through ctx.tools instead of the dynamic `harness`.
 */
const NAME = 'dsh-client-masquerade';
const NS = 'llm-pi-ai';
const API_PATH = '/dsh-client-masquerade/api';

const { readFileSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  applyPatch, revertPatch, MARKER: PATCH_MARKER,
  VARIANT_MARKER, applyVariantRetryPatch, revertVariantRetryPatch,
  BODY_MARKER, BODY_SWITCH_HEADER, applyBodyPatch, revertBodyPatch, FINGERPRINT
} = require('./patches/patch-lib.js');

/*
 * The claude-code preset mirrors a REAL Claude Code request, captured off the
 * wire from claude-cli 2.1.241 talking to an Anthropic-protocol relay:
 *
 *   POST /v1/messages?beta=true
 *   user-agent: claude-cli/2.1.241 (external, sdk-cli)
 *   x-stainless-package-version: 0.112.1
 *   anthropic-beta: claude-code-20250219,context-1m-2025-08-07,…,advisor-tool-2026-03-01,effort-2025-11-24
 *   anthropic-dangerous-direct-browser-access: true
 *   x-stainless-retry-count: 0 / x-stainless-timeout: 600
 *
 * Keep these in sync with the client line gateways fingerprint on: relays of the
 * "any"/"agent" router family gate on the claude-cli version, and several of
 * them hard-require the anthropic-beta opt-in before they will route at all
 * (without it they answer 400 "1m 上下文已经全量可用，请启用 1m 上下文后重试").
 * `x-claude-code-session-id` is deliberately NOT spoofed: it is a per-session
 * UUID, and a frozen value is a worse fingerprint than none.
 */
const CLAUDE_CLI_VERSION = '2.1.241';
const CLAUDE_STAINLESS_VERSION = '0.112.1';
const CLAUDE_CODE_BETA = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,effort-2025-11-24';

const PRESETS = {
  'claude-code': {
    'user-agent': 'claude-cli/' + CLAUDE_CLI_VERSION + ' (external, cli)',
    'anthropic-client': 'claude-code/' + CLAUDE_CLI_VERSION,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': CLAUDE_CODE_BETA,
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'x-stainless-package-version': CLAUDE_STAINLESS_VERSION,
    'x-stainless-os': 'Windows',
    'x-stainless-arch': 'x64',
    'x-stainless-lang': 'js',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v26.3.0',
    'x-stainless-retry-count': '0',
    'x-stainless-timeout': '600'
  },
  'codex': {
    'user-agent': 'codex-tui/0.145.0 (Windows 10.0.26200; x86_64) WindowsTerminal (codex-tui; 0.145.0)',
    'openai-client': 'codex/0.48.0',
    'x-stainless-package-version': '0.48.0',
    'x-stainless-os': 'Windows',
    'x-stainless-arch': 'x64',
    'x-stainless-lang': 'js',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': '22.0.0'
  }
};
const SPOOF_KEYS = [];
for (const id of Object.keys(PRESETS)) {
  for (const name of Object.keys(PRESETS[id])) {
    if (SPOOF_KEYS.indexOf(name) === -1) SPOOF_KEYS.push(name);
  }
}
const RESERVED_HEADERS = ['user-agent']; // attribution default; an explicit profile user-agent is now honored on the wire

/**
 * Gateway statuses worth another attempt. Relays of the new-api family answer
 * 503/500 with `get_channel_failed` — and, confusingly, 429 with the SAME body
 * "Service Unavailable" — while their upstream pool has no free channel. Those
 * clear on their own, so a single shot is not evidence about the disguise.
 */
const RETRYABLE_STATUS = /\b(429|500|502|503|504|520|521|522|523|524|529)\b/;
const TEST_ATTEMPTS = 3;
const TEST_RETRY_BASE_MS = 1500;
/** How long `test` rides the queue before reporting (see QUEUE_RETRY_POLICY). */
const TEST_QUEUE_ATTEMPTS = 10;

/**
 * Queue-adaptive retry policy written to a provider profile when the user turns
 * "queue" on. anyrouter-style relays reject every request with 503/429 while
 * their channel pool is empty; a real Claude Code CLI outwaits that by
 * retrying for minutes. The already-enabled dsh-llm-retry plugin executes this
 * policy on the agent loop's failed-step extension point, so an agent turn
 * keeps the request in the queue instead of failing after ~30s (the default
 * policy is 5 retries at 500ms→10s).
 *
 * Values: 15 retries with exponential backoff 1s→45s (with jitter), covering
 * the failure codes pi-ai maps a relay rejection to (RATE_LIMIT for 429,
 * SERVER for 5xx, plus transport/timeout/empty-response). Cumulative wait is
 * roughly 7-8 minutes — longer than a real Claude Code CLI's own retry window
 * (measured ~10 attempts over ~3:45 against the same relay), so DSH outwaits
 * any queue a stock client can ride out, while still failing loudly on a
 * genuinely dead route.
 */
const QUEUE_RETRYABLE_CODES = ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'];
const QUEUE_RETRY_POLICY = {
  mode: 'normal',
  maxRetries: 15,
  retryableCodes: QUEUE_RETRYABLE_CODES,
  backoff: {
    initialDelayMs: 1000,
    maxDelayMs: 45000,
    jitterRatio: 0.3
  }
};

const sleep = (ms) => new Promise((resolve) => {
  if (typeof setTimeout === 'function') setTimeout(resolve, ms); else resolve();
});

/** The queue backoff shape the dsh-llm-retry plugin uses (same formula). */
const queueDelay = (retry) => {
  const exponent = Math.min(retry - 1, 1024);
  const exponential = Math.min(QUEUE_RETRY_POLICY.backoff.initialDelayMs * 2 ** exponent, QUEUE_RETRY_POLICY.backoff.maxDelayMs);
  const jitter = 1 - QUEUE_RETRY_POLICY.backoff.jitterRatio + 2 * QUEUE_RETRY_POLICY.backoff.jitterRatio * Math.random();
  return Math.min(exponential * jitter, QUEUE_RETRY_POLICY.backoff.maxDelayMs);
};

/** Read the provider's configured retryPolicy (any object shape). */
function retryPolicyOf(profile) {
  if (profile === undefined || profile === null || typeof profile !== 'object') return undefined;
  const rp = profile.retryPolicy;
  return rp && typeof rp === 'object' ? rp : undefined;
}

/** Is this profile queue-adapted (i.e. does it carry any retry policy)? */
function isQueueAdapted(profile) {
  const rp = retryPolicyOf(profile);
  return rp !== undefined && typeof rp.mode === 'string' && rp.mode.length > 0;
}

/**
 * Turn one gateway rejection into something actionable, and — crucially — say
 * whether the disguise is even implicated.
 *
 * The hard case is the new-api family (anyrouter and friends), which answers
 * 429/503 with a bare "Service Unavailable" for TWO unrelated reasons: its
 * upstream channel pool is genuinely busy, or its Claude Code check rejected
 * the request body. The two are indistinguishable from the status line alone,
 * and reading every one of them as a queue is what made an earlier version of
 * this plugin advise "just wait" for a route that would never come back. So
 * when the profile asks for a body-fingerprinting disguise, the classifier
 * reports what the caller can actually act on — whether the body masquerade is
 * live — instead of asserting a queue it cannot observe.
 *
 * @param {string} callError - the error text captured from the stream.
 * @param {{ bodyMasquerade?: boolean, bodyPatched?: boolean|null }} [context] - route state.
 * @returns {{category: string, disguiseImplicated: boolean, hint: string, hintZh: string}}
 */
function classifyCallError(callError, context) {
  const text = String(callError || '');
  const ctxt = context === undefined || context === null ? {} : context;
  // Credential/identity refusals: the one family a header disguise can fix.
  if (/\b(401|403)\b/.test(text) || /UNAUTHENTICATED/i.test(text)) {
    return {
      category: 'auth',
      disguiseImplicated: true,
      hint: 'gateway rejected the credential or client identity; check the API key and, for User-Agent-fingerprinting gateways, that the pi-ai user-agent patch is applied and dsh web restarted',
      hintZh: '网关拒绝了凭证或客户端身份：检查 API Key；若网关按 User-Agent 指纹识别，确认已应用 pi-ai user-agent 补丁并重启 dsh web'
    };
  }
  // Missing beta opt-in: fixable by re-applying the current claude-code preset.
  if (/\b400\b/.test(text) && /(1m|上下文|beta|context)/i.test(text)) {
    return {
      category: 'policy-gate',
      disguiseImplicated: true,
      hint: 'gateway demands a beta opt-in header (e.g. anthropic-beta: context-1m-2025-08-07); re-apply the current claude-code preset, which now ships the full anthropic-beta list',
      hintZh: '网关要求 beta 声明头（如 anthropic-beta: context-1m-2025-08-07）；重新应用新版 claude-code 预设（已内置完整 anthropic-beta 列表）'
    };
  }
  if (/invalid claude code request/i.test(text)) {
    return {
      category: 'shape-validation',
      disguiseImplicated: true,
      hint: 'gateway validated the Claude Code request body shape and rejected it; enable body masquerade for this provider (mask_client action=body state=on provider=…), apply the patch and restart dsh web',
      hintZh: '网关校验了 Claude Code 请求体结构并拒绝；为该 provider 开启请求体伪装（mask_client action=body state=on provider=…），应用补丁并重启 dsh web'
    };
  }
  const relayBusyText = /get_channel_failed|无可用渠道|负载已经达到上限|当前分组.*(负载|无可用)|no available channel/i.test(text);
  if (relayBusyText || RETRYABLE_STATUS.test(text)) {
    // A bare 429/503 from this relay family means either "no free channel" or
    // "your body did not look like Claude Code". Which one it is depends on
    // state this function CAN see: whether the route asked for body masquerade
    // and whether the patch that performs it is actually loaded.
    if (ctxt.bodyMasquerade === true && ctxt.bodyPatched === false) {
      return {
        category: 'body-fingerprint',
        disguiseImplicated: true,
        hint: 'this route asks for body masquerade but the pi-ai body patch is NOT applied, so the request body still looks like DSH — anyrouter-family relays answer exactly this 429/503 to a body that fails their Claude Code check. Apply the patch (mask_client action=patch) and restart dsh web',
        hintZh: '该路线已开启请求体伪装，但 pi-ai 请求体补丁未生效，请求体仍是 DSH 的形状——anyrouter 系网关对通不过 Claude Code 校验的请求体正是回这个 429/503。请应用补丁（mask_client action=patch）并重启 dsh web'
      };
    }
    if (ctxt.bodyMasquerade !== true) {
      return {
        category: 'body-fingerprint',
        disguiseImplicated: true,
        hint: 'a bare 429/503 from a new-api-family relay is ambiguous: either its channel pool is busy, or its Claude Code check rejected the request body. Header spoofing alone does not satisfy that check — these relays gate on metadata.user_id, a client-identity system block and verbatim tool definitions. Enable body masquerade (mask_client action=body state=on provider=…), apply the patch, restart dsh web; if it still fails after that, the pool really is busy and the queue policy is what helps',
        hintZh: '这类 new-api 系网关的裸 429/503 有两种含义：渠道池真的忙，或者它的 Claude Code 校验拒绝了请求体。仅靠请求头伪装满足不了该校验——它们校验 metadata.user_id、客户端身份 system 块与逐字的工具定义。请开启请求体伪装（mask_client action=body state=on provider=…），应用补丁并重启 dsh web；若之后仍失败，才是渠道池真忙，此时排队策略才有用'
      };
    }
    // Body masquerade is on AND live: now a busy pool is the better reading.
    return {
      category: 'queued',
      disguiseImplicated: false,
      hint: 'body masquerade is live on this route, so the remaining reading of 429/503 is a busy upstream pool — the same answer a real Claude Code CLI gets. Retrying with backoff eventually gets through; enable the provider queue policy (mask_client action=queue state=on provider=…) so agent turns outwait the queue instead of failing after the default ~30s',
      hintZh: '该路线的请求体伪装已生效，因此 429/503 更可能是上游渠道池真的繁忙（真实 Claude Code CLI 也会收到同样结果）。带退避重试最终能通过；为该 provider 开启排队适配（mask_client action=queue state=on provider=…），让 agent 请求能等到渠道空闲，而不是在默认约 30 秒后就失败'
    };
  }
  return { category: 'other', disguiseImplicated: false, hint: '', hintZh: '' };
}

/**
 * Which preset a profile's headers currently express.
 *
 * An exact match reports that preset id. A profile that clearly belongs to a
 * preset FAMILY (it carries that client's identity headers) but no longer
 * matches value-for-value is reported as that preset with `stale: true`: this
 * is what an older plugin version wrote, and it matters because gateways gate
 * on the exact client version, so the user must re-apply to get the refreshed
 * fingerprint. Anything else with headers present is 'custom'.
 *
 * @param {Record<string, unknown>} headers - the profile's configured headers.
 * @returns {{ active: string|null, stale: boolean }}
 */
function detectPresetDetailed(headers) {
  if (headers === undefined || headers === null || typeof headers !== 'object') return { active: null, stale: false };
  const lower = {};
  for (const name of Object.keys(headers)) lower[name.toLowerCase()] = String(headers[name]);
  for (const id of Object.keys(PRESETS)) {
    const target = PRESETS[id];
    let match = true;
    for (const name of Object.keys(target)) {
      if (headers[name] !== target[name]) { match = false; break; }
    }
    if (match) return { active: id, stale: false };
  }
  const ua = lower['user-agent'] || '';
  // Family fingerprints: an older preset of ours, or a hand-rolled equivalent.
  if (ua.indexOf('claude-cli/') === 0 || (lower['anthropic-client'] || '').indexOf('claude-code/') === 0) {
    return { active: 'claude-code', stale: true };
  }
  if (ua.indexOf('codex-tui/') === 0 || (lower['openai-client'] || '').indexOf('codex/') === 0) {
    return { active: 'codex', stale: true };
  }
  return { active: Object.keys(headers).length > 0 ? 'custom' : null, stale: false };
}

/** Back-compat shape used by test reporting: just the preset id. */
function detectPreset(headers) {
  return detectPresetDetailed(headers).active;
}

/** Resolve the installed @deepseek-ai/dsh-llm-pi-ai lib/index.js path. */
function resolvePiAiLib() {
  const pkgJson = require.resolve('@deepseek-ai/dsh-llm-pi-ai/package.json');
  return join(dirname(pkgJson), 'lib', 'index.js');
}

/** Inspect the pi-ai user-agent patch state (supported=false when dsh-llm-pi-ai is missing). */
function uaPatchState() {
  try {
    const target = resolvePiAiLib();
    return { supported: true, patched: readFileSync(target, 'utf8').includes(PATCH_MARKER), target: target };
  } catch (e) {
    return { supported: false, patched: null, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Apply the pi-ai user-agent patch from the web settings page.
 * Writing succeeds immediately, but the running requestHeaders() is already in
 * memory, so the change only takes effect after a `dsh web` restart.
 */
function applyUserAgentPatch() {
  const state = uaPatchState();
  if (state.error !== undefined) return { ok: false, error: state.error };
  if (state.patched) return { ok: true, alreadyPatched: true, restartRequired: false, target: state.target };
  try {
    applyPatch(state.target);
    return { ok: true, alreadyPatched: false, restartRequired: true, target: state.target };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Revert the pi-ai user-agent patch (clean uninstall support).
 * Also requires a `dsh web` restart to take effect.
 */
function revertUserAgentPatch() {
  const state = uaPatchState();
  if (state.error !== undefined) return { ok: false, error: state.error };
  if (!state.patched) return { ok: true, alreadyStock: true, restartRequired: false, target: state.target };
  try {
    revertPatch(state.target);
    return { ok: true, alreadyStock: false, restartRequired: true, target: state.target };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Inspect the dsh-vision-toolkit variant retry-forwarding patch state.
 * supported=false when the package is not installed (nothing to patch).
 */
function variantPatchState() {
  try {
    const target = resolveVisionToolkitVariants();
    if (target === undefined) {
      return { supported: false, patched: null, error: '@anionex/dsh-vision-toolkit is not installed (variant patch not needed)' };
    }
    return { supported: true, patched: readFileSync(target, 'utf8').includes(VARIANT_MARKER), target: target };
  } catch (e) {
    return { supported: false, patched: null, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Resolve the installed @earendil-works/pi-ai anthropic-messages API module —
 * the file that builds the Anthropic request body, and so the only place a
 * body-level masquerade can be applied. Returns undefined when absent.
 *
 * Located by walking up node_modules rather than with require.resolve: pi-ai's
 * `exports` map exposes neither `./package.json` nor a CJS-resolvable main, so
 * every require.resolve form throws ERR_PACKAGE_PATH_NOT_EXPORTED. Walking is
 * also what finds the copy in THIS profile when the plugin is installed as a
 * sibling package, which is exactly the layout we patch.
 */
function resolvePiAiMessagesApi() {
  const rel = join('node_modules', '@earendil-works', 'pi-ai', 'dist', 'api', 'anthropic-messages.js');
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Inspect the pi-ai body-masquerade patch state (supported=false when pi-ai is missing). */
function bodyPatchState() {
  const target = resolvePiAiMessagesApi();
  if (target === undefined) {
    return { supported: false, patched: null, error: '@earendil-works/pi-ai is not installed' };
  }
  try {
    return { supported: true, patched: readFileSync(target, 'utf8').includes(BODY_MARKER), target: target };
  } catch (e) {
    return { supported: false, patched: null, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Apply ALL patches from the web settings page / tool action:
 * 1. the pi-ai user-agent patch (profile user-agent reaches the wire),
 * 2. the pi-ai body-masquerade patch (request bodies can pass a relay's Claude
 *    Code check — inert until a provider turns body masquerade on), and
 * 3. the dsh-vision-toolkit variant retry-forwarding patch (vision-toolkit-*
 *    wrapper routes inherit the upstream queue policy; skipped when the
 *    package is not installed).
 * Each write succeeds immediately but only takes effect after a `dsh web`
 * restart (requestHeaders / buildParams / variant registration are already in
 * memory).
 */
function applyPatches() {
  const ua = applyUserAgentPatch();
  if (!ua.ok) return { ok: false, error: ua.error };
  const result = { ok: true, uaPatch: ua };
  const bodyTarget = resolvePiAiMessagesApi();
  if (bodyTarget === undefined) {
    result.bodyPatch = { ok: false, error: '@earendil-works/pi-ai is not installed', target: null };
  } else {
    try {
      const r = applyBodyPatch(bodyTarget);
      result.bodyPatch = { ok: true, alreadyPatched: r.alreadyPatched, restartRequired: !r.alreadyPatched, target: bodyTarget };
    } catch (e) {
      result.bodyPatch = { ok: false, error: String(e && e.message ? e.message : e), target: bodyTarget };
    }
  }
  const variantTarget = resolveVisionToolkitVariants();
  if (variantTarget === undefined) {
    result.variantPatch = { ok: true, skipped: true, alreadyPatched: false, restartRequired: false, target: null };
  } else {
    try {
      const r = applyVariantRetryPatch(variantTarget);
      result.variantPatch = { ok: true, skipped: false, alreadyPatched: r.alreadyPatched, restartRequired: !r.alreadyPatched, target: variantTarget };
    } catch (e) {
      result.variantPatch = { ok: false, error: String(e && e.message ? e.message : e), target: variantTarget };
    }
  }
  return result;
}

/**
 * Revert ALL patches (clean uninstall support). Also requires a `dsh web`
 * restart to take effect.
 */
function revertPatches() {
  const ua = revertUserAgentPatch();
  if (!ua.ok) return { ok: false, error: ua.error };
  const result = { ok: true, uaPatch: ua };
  const bodyTarget = resolvePiAiMessagesApi();
  if (bodyTarget === undefined) {
    result.bodyPatch = { ok: true, skipped: true, alreadyStock: true, restartRequired: false, target: null };
  } else {
    try {
      const r = revertBodyPatch(bodyTarget);
      result.bodyPatch = { ok: true, skipped: false, alreadyStock: r.alreadyStock, restartRequired: !r.alreadyStock, target: bodyTarget };
    } catch (e) {
      result.bodyPatch = { ok: false, error: String(e && e.message ? e.message : e), target: bodyTarget };
    }
  }
  const variantTarget = resolveVisionToolkitVariants();
  if (variantTarget === undefined) {
    result.variantPatch = { ok: true, skipped: true, alreadyStock: true, restartRequired: false, target: null };
  } else {
    try {
      const r = revertVariantRetryPatch(variantTarget);
      result.variantPatch = { ok: true, skipped: false, alreadyStock: r.alreadyStock, restartRequired: !r.alreadyStock, target: variantTarget };
    } catch (e) {
      result.variantPatch = { ok: false, error: String(e && e.message ? e.message : e), target: variantTarget };
    }
  }
  return result;
}

/** Warn loudly when the pi-ai user-agent patch is missing (the #1 "disguise written but gateway 401" cause). */
function checkUserAgentPatch() {
  const state = uaPatchState();
  if (state.error !== undefined) {
    console.warn('[client-masquerade] could not verify dsh-llm-pi-ai patch state: ' + state.error);
    return;
  }
  if (!state.patched) {
    console.warn('[client-masquerade] dsh-llm-pi-ai is NOT user-agent patched: an explicit profile user-agent is stripped on the wire, so User-Agent-fingerprinting gateways (agentrouter / claude-code-router) reject disguised requests with 401. Apply it from the Client Masquerade settings page, or run (from your profile dir): node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs — then restart dsh web.');
  }
}

/**
 * Warn when a provider asks for body masquerade but the patch that performs it
 * is not loaded. This is the silent-failure case worth shouting about: the
 * switch header sits in settings, the route looks configured, and the relay
 * answers a bare 429/503 that reads exactly like a busy channel pool.
 *
 * @param {Record<string, unknown>} providers - the llm-pi-ai providers map.
 */
function checkBodyPatch(providers) {
  const wanted = Object.keys(providers === undefined || providers === null ? {} : providers)
    .filter((id) => {
      const profile = providers[id];
      const headers = profile && typeof profile === 'object' && profile.headers && typeof profile.headers === 'object' ? profile.headers : {};
      return Object.keys(headers).some((name) => name.toLowerCase() === BODY_SWITCH_HEADER);
    });
  if (wanted.length === 0) return; // nobody asked for it; an unpatched pi-ai is fine
  const state = bodyPatchState();
  if (state.error !== undefined) {
    console.warn('[client-masquerade] could not verify the pi-ai body-masquerade patch state: ' + state.error);
    return;
  }
  if (!state.patched) {
    console.warn(
      '[client-masquerade] provider(s) ' + wanted.join(', ') + ' ask for request-body masquerade but @earendil-works/pi-ai is NOT body patched, so their request bodies still look like DSH. ' +
      'anyrouter-family relays answer a body that fails their Claude Code check with a bare 429/503 — indistinguishable from a busy channel pool, so this failure is easy to misread as queueing. ' +
      'Apply it from the Client Masquerade settings page (Patch applies all patches), or run (from your profile dir): node node_modules/dsh-client-masquerade/patches/apply-pi-ai-body-patch.mjs — then restart dsh web.'
    );
  }
}

/**
 * Resolve the installed @anionex/dsh-vision-toolkit image-input-variants.js.
 * Returns undefined when the package is not installed.
 */
function resolveVisionToolkitVariants() {
  try {
    const pkgJson = require.resolve('@anionex/dsh-vision-toolkit/package.json');
    return join(dirname(pkgJson), 'lib', 'image-input-variants.js');
  } catch (e) {
    return undefined;
  }
}

/**
 * Warn loudly when the dsh-vision-toolkit variant retry-forwarding patch is
 * missing. Without it, `vision-toolkit-<upstream>` wrapper routes (which the
 * agent may actually use, e.g. vision-toolkit-anyrouter) always fall back to
 * the default 5-retry policy no matter what queue policy the upstream profile
 * carries — the exact "still only retries five times" symptom.
 */
function checkVariantRetryPatch() {
  const target = resolveVisionToolkitVariants();
  if (target === undefined) return; // vision-toolkit not installed; nothing to patch
  try {
    const src = readFileSync(target, 'utf8');
    if (!src.includes(VARIANT_MARKER)) {
      console.warn(
        '[client-masquerade] dsh-vision-toolkit image-input variants are NOT retry-forwarding patched: vision-toolkit-<upstream> wrapper routes (e.g. vision-toolkit-anyrouter) fall back to the default 5-retry policy even when the upstream profile carries a queue retryPolicy. ' +
        'Apply it from the Client Masquerade settings page (Patch applies both patches), or run (from your profile dir): node node_modules/dsh-client-masquerade/patches/apply-variant-retry-patch.mjs — then restart dsh web.'
      );
    }
  } catch (e) {
    console.warn('[client-masquerade] could not verify dsh-vision-toolkit variant patch state: ' + String(e && e.message ? e.message : e));
  }
}

/** Collect and parse a JSON request body (node http IncomingMessage). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid JSON body: ' + String(e.message)));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

/** The webServer binds browsers only; still refuse clearly non-local Host headers. */
function isLocalHost(host) {
  if (host === undefined || host === null) return false;
  const h = String(host).toLowerCase();
  return h.indexOf('127.0.0.1') === 0 || h.indexOf('localhost') === 0 || h.indexOf('[::1]') === 0 || h.indexOf('::1') === 0;
}

async function apply(ctx) {
  checkUserAgentPatch();
  checkVariantRetryPatch();
  const settings = ctx.get('settings');
  if (settings === undefined) {
    console.error(NAME + ': settings service unavailable');
    return;
  }

  const providersMap = () => {
    const value = settings.get(NS);
    if (value === undefined || value === null || typeof value !== 'object') return {};
    const p = value.providers;
    return p && typeof p === 'object' ? p : {};
  };

  // Only meaningful once settings are readable: warn about routes that ask for
  // body masquerade while the patch performing it is absent.
  checkBodyPatch(providersMap());

  const headersOf = (profile) => {
    if (profile === undefined || profile === null || typeof profile !== 'object') return {};
    const h = profile.headers;
    return h && typeof h === 'object' ? h : {};
  };

  /** Does this profile carry the body-masquerade switch header? */
  const bodyMasqueradeOf = (profile) => {
    const headers = headersOf(profile);
    return Object.keys(headers).some((name) => {
      if (name.toLowerCase() !== BODY_SWITCH_HEADER) return false;
      return String(headers[name]).startsWith('claude-code');
    });
  };

  const listProviders = () => {
    const map = providersMap();
    const llm = ctx.get('llm');
    return Object.keys(map).map((id) => {
      const profile = map[id];
      const headers = headersOf(profile);
      const detected = detectPresetDetailed(headers);
      const rp = retryPolicyOf(profile);
      // The policy the AGENT LOOP actually executes: captured in the llm
      // registration at adapter (re)registration time, handed to
      // agent/request-error via prepareCall, and consumed by dsh-llm-retry.
      // It follows settings changes live (pi-ai re-registers on onChange), so
      // this is the ground truth for whether the queue policy is in effect.
      let registrationRetryPolicy = null;
      if (llm !== undefined) {
        try {
          const reg = llm.providerRetryPolicy(id);
          if (reg !== undefined && reg !== null) {
            registrationRetryPolicy = {
              mode: typeof reg.mode === 'string' ? reg.mode : null,
              maxRetries: typeof reg.maxRetries === 'number' ? reg.maxRetries : null,
              initialDelayMs: typeof reg.initialDelayMs === 'number' ? reg.initialDelayMs : null,
              maxDelayMs: typeof reg.maxDelayMs === 'number' ? reg.maxDelayMs : null,
              retryableCodes: Array.isArray(reg.retryableCodes) ? reg.retryableCodes.map(String) : []
            };
          }
        } catch (e) {
          registrationRetryPolicy = { error: String(e && e.message ? e.message : e) };
        }
      }
      return {
        id: id,
        displayName: profile && typeof profile.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName : id,
        active: detected.active,
        // An older plugin version wrote this disguise; the client version it
        // claims is out of date, so re-applying the preset may be required.
        stale: detected.stale,
        // Whether this route asks for request-body masquerade. Paired with the
        // top-level bodyPatch state, this is what says whether the relay's
        // Claude Code body check can actually be satisfied: the switch alone
        // does nothing until the patch is applied and dsh web restarted.
        bodyMasquerade: bodyMasqueradeOf(profile),
        // anyrouter-style relays queue while channels are busy; the queue
        // policy tells dsh-llm-retry to keep retrying (see QUEUE_RETRY_POLICY).
        queue: isQueueAdapted(profile),
        retryPolicy: rp === undefined ? null : {
          mode: typeof rp.mode === 'string' ? rp.mode : null,
          maxRetries: typeof rp.maxRetries === 'number' ? rp.maxRetries : null,
          maxDelayMs: rp.backoff !== null && typeof rp.backoff === 'object' && typeof rp.backoff.maxDelayMs === 'number' ? rp.backoff.maxDelayMs : null,
          retryableCodes: Array.isArray(rp.retryableCodes) ? rp.retryableCodes.map(String) : []
        },
        // What the agent loop will actually use — matches retryPolicy when the
        // settings change has propagated (it does, live).
        registrationRetryPolicy: registrationRetryPolicy,
        headers: Object.keys(headers).map((name) => ({ name: name, value: String(headers[name]) }))
      };
    });
  };

  const requireProvider = (map, providerId) => {
    if (!Object.prototype.hasOwnProperty.call(map, providerId)) {
      const available = Object.keys(map);
      throw new Error('provider "' + providerId + '" is not a configured llm-pi-ai route' + (available.length > 0 ? '; available: ' + available.join(', ') : ''));
    }
  };

  const parseExtra = (headersJson) => {
    if (headersJson === undefined || headersJson === null || headersJson === '') return {};
    let parsed;
    try {
      parsed = JSON.parse(headersJson);
    } catch (e) {
      throw new Error('headersJson must be a JSON object string: ' + String(e && e.message ? e.message : e));
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headersJson must be a JSON object');
    }
    return parsed;
  };

  const applyPreset = async (providerId, presetId, headersJson) => {
    const map = providersMap();
    requireProvider(map, providerId);
    const base = presetId === 'custom' ? {} : PRESETS[presetId];
    if (base === undefined) throw new Error('unknown preset "' + presetId + '"');
    const current = headersOf(map[providerId]);
    // Strip ALL spoof keys first so switching presets never leaves stale headers
    // from a previous preset (e.g. anthropic-client when switching to codex).
    const sanitized = {};
    for (const name of Object.keys(current)) {
      if (SPOOF_KEYS.some((key) => key.toLowerCase() === name.toLowerCase()) === false) sanitized[name] = current[name];
    }
    const next = Object.assign({}, sanitized, base, parseExtra(headersJson));
    if (!settings.writable) throw new Error('settings are not writable in this deployment');
    await settings.mutate(NS, [{ op: 'set', path: ['providers', providerId, 'headers'], value: next }]);
    return { provider: providerId, preset: presetId, headers: next };
  };

  const clearSpoof = async (providerId) => {
    const map = providersMap();
    requireProvider(map, providerId);
    const current = headersOf(map[providerId]);
    const filtered = {};
    for (const name of Object.keys(current)) {
      // `off` means "this route is not masquerading", so the body-masquerade
      // switch goes with the spoofed headers. Switching PRESETS keeps it (see
      // applyPreset), because that is a change of disguise, not a removal.
      if (name.toLowerCase() === BODY_SWITCH_HEADER) continue;
      if (SPOOF_KEYS.some((key) => key.toLowerCase() === name.toLowerCase()) === false) filtered[name] = current[name];
    }
    if (!settings.writable) throw new Error('settings are not writable in this deployment');
    if (Object.keys(filtered).length === 0) {
      await settings.mutate(NS, [{ op: 'unset', path: ['providers', providerId, 'headers'] }]);
      return { provider: providerId, preset: null, headers: {} };
    }
    await settings.mutate(NS, [{ op: 'set', path: ['providers', providerId, 'headers'], value: filtered }]);
    return { provider: providerId, preset: null, headers: filtered };
  };

  /**
   * Turn request-body masquerade for a provider on or off.
   *
   * What this buys: anyrouter-family relays gate /v1/messages on the request
   * BODY, not its headers. Measured against a live route, a body missing any of
   * these is refused — a JSON `metadata.user_id` (device_id non-empty,
   * session_id UUID-shaped), a client-identity `system` block, and verbatim
   * Glob/Grep/Read tool definitions. A DSH-shaped body gets 503; the same body
   * with those three injected gets 200.
   *
   * The switch is a header, `x-dsh-body-masquerade: claude-code:<deviceId>`,
   * which the patched pi-ai strips before the request goes out. Keeping the
   * device id in settings (generated once, here) is what lets the injected code
   * stay dependency-free, and gives the relay a stable device per provider
   * instead of a new one per request.
   *
   * What it costs: the sentinel tools are advertised to the model but not
   * implemented by DSH. They are read-only by choice (Glob/Grep/Read), so a
   * model that reaches for one attempts a search the harness cannot run — the
   * step fails rather than anything being executed or edited. Two tools do not
   * satisfy the gate, so three is the floor.
   *
   * @param {string} providerId - pi-ai provider route id.
   * @param {boolean} enabled - true writes the switch header, false removes it.
   * @returns {{ provider: string, bodyMasquerade: boolean, deviceId: string|null, sentinelTools: string[], patched: boolean|null, restartRequired: boolean }}
   */
  const setBodyMasquerade = async (providerId, enabled) => {
    const map = providersMap();
    requireProvider(map, providerId);
    if (!settings.writable) throw new Error('settings are not writable in this deployment');
    const current = headersOf(map[providerId]);
    const patchState = bodyPatchState();
    const sentinelTools = FINGERPRINT.sentinelTools.map((tool) => tool.name);
    if (!enabled) {
      const filtered = {};
      for (const name of Object.keys(current)) {
        if (name.toLowerCase() !== BODY_SWITCH_HEADER) filtered[name] = current[name];
      }
      if (Object.keys(filtered).length === 0) {
        await settings.mutate(NS, [{ op: 'unset', path: ['providers', providerId, 'headers'] }]);
      } else {
        await settings.mutate(NS, [{ op: 'set', path: ['providers', providerId, 'headers'], value: filtered }]);
      }
      return { provider: providerId, bodyMasquerade: false, deviceId: null, sentinelTools: sentinelTools, patched: patchState.patched, restartRequired: false };
    }
    // Reuse the device id already on file, so turning the switch off and on
    // again does not present the relay with a brand-new device.
    const existing = Object.keys(current).find((name) => name.toLowerCase() === BODY_SWITCH_HEADER);
    const existingId = existing === undefined ? '' : String(current[existing]).split(':').slice(1).join(':');
    const deviceId = existingId.length > 0 ? existingId : randomUUID().replace(/-/g, '');
    const next = {};
    for (const name of Object.keys(current)) {
      if (name.toLowerCase() !== BODY_SWITCH_HEADER) next[name] = current[name];
    }
    next[BODY_SWITCH_HEADER] = 'claude-code:' + deviceId;
    await settings.mutate(NS, [{ op: 'set', path: ['providers', providerId, 'headers'], value: next }]);
    return {
      provider: providerId,
      bodyMasquerade: true,
      deviceId: deviceId,
      sentinelTools: sentinelTools,
      patched: patchState.patched,
      // The switch reaches the next request immediately (pi-ai re-reads the
      // profile per call), but the code that ACTS on it is loaded at startup.
      restartRequired: patchState.patched === false
    };
  };

  /**
   * Turn the queue-adaptation policy for a provider on or off.
   *
   * The policy lives in the provider profile (`retryPolicy`) and is executed by
   * the already-enabled dsh-llm-retry plugin on every failed agent step: while
   * anyrouter-style relays queue (429/503 "Service Unavailable"), the agent
   * keeps retrying with exponential backoff instead of failing after ~30s.
   *
   * A `vision-toolkit-<upstream>` wrapper route (the image-input variant the
   * agent may actually use, e.g. vision-toolkit-anyrouter) is mapped to its
   * upstream provider: the wrapper inherits the upstream's resolved policy via
   * the dsh-vision-toolkit retry-forwarding patch, so writing the policy to the
   * upstream is what makes the variant queue-adapted too.
   *
   * @param {string} providerId - pi-ai provider route id (or a variant wrapper).
   * @param {boolean} enabled - true writes the policy, false removes it.
   * @param {{retries?: number, maxdelay?: number}} [override] - optional policy
   *   overrides for maxRetries and backoff.maxDelayMs (ms).
   * @returns {{ provider: string, upstream?: string, queue: boolean, retryPolicy: object|null }}
   */
  const setQueuePolicy = async (providerId, enabled, override) => {
    const map = providersMap();
    // vision-toolkit-<upstream> wrapper routes are not llm-pi-ai providers;
    // their retry policy inherits from the upstream route via the
    // dsh-vision-toolkit forwarding patch, so write to the upstream profile.
    const VARIANT_PREFIX = 'vision-toolkit-';
    let upstream = providerId;
    if (providerId.indexOf(VARIANT_PREFIX) === 0) {
      upstream = providerId.slice(VARIANT_PREFIX.length);
      if (upstream.length === 0 || !Object.prototype.hasOwnProperty.call(map, upstream)) {
        throw new Error('provider "' + providerId + '" is a vision-toolkit wrapper whose upstream "' + upstream + '" is not a configured llm-pi-ai route');
      }
    }
    requireProvider(map, upstream);
    if (!settings.writable) throw new Error('settings are not writable in this deployment');
    if (!enabled) {
      await settings.mutate(NS, [{ op: 'unset', path: ['providers', upstream, 'retryPolicy'] }]);
      return { provider: providerId, ...(upstream === providerId ? {} : { upstream: upstream }), queue: false, retryPolicy: null };
    }
    const o = override === undefined || override === null ? {} : override;
    const retries = typeof o.retries === 'number' && Number.isFinite(o.retries) && o.retries >= 0 ? o.retries : QUEUE_RETRY_POLICY.maxRetries;
    const maxDelay = typeof o.maxdelay === 'number' && Number.isFinite(o.maxdelay) && o.maxdelay > 0 ? o.maxdelay : QUEUE_RETRY_POLICY.backoff.maxDelayMs;
    const policy = {
      mode: 'normal',
      maxRetries: retries,
      retryableCodes: QUEUE_RETRY_POLICY.retryableCodes.slice(),
      backoff: {
        initialDelayMs: QUEUE_RETRY_POLICY.backoff.initialDelayMs,
        maxDelayMs: maxDelay,
        jitterRatio: QUEUE_RETRY_POLICY.backoff.jitterRatio
      }
    };
    await settings.mutate(NS, [{ op: 'set', path: ['providers', upstream, 'retryPolicy'], value: policy }]);
    return { provider: providerId, ...(upstream === providerId ? {} : { upstream: upstream }), queue: true, retryPolicy: policy };
  };

  /** One real streaming call through the route; never throws, always reports. */
  const callOnce = async (providerId, chosen, signal) => {
    const llm = ctx.get('llm');
    if (llm === undefined) return { callError: 'llm service unavailable', firstText: '', finishReason: null, chunkCount: 0 };
    let firstText = '';
    let finishReason = null;
    let callError = null;
    let chunkCount = 0;
    try {
      const stream = llm.stream({
        provider: providerId,
        model: chosen,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: PONG' }] }],
        maxTokens: 8,
        ...(signal === undefined ? {} : { signal: signal })
      });
      for await (const chunk of stream) {
        chunkCount += 1;
        if (chunk.type === 'text-delta') firstText += chunk.text;
        if (chunk.type === 'finish') { finishReason = chunk.reason; break; }
      }
    } catch (e) {
      callError = String(e && e.message ? e.message : e);
    }
    const badFinish = finishReason !== null && (finishReason.kind === 'error' || finishReason.kind === 'aborted');
    if (callError === null && badFinish) {
      const failure = finishReason.failure;
      callError = String(failure && failure.message ? failure.message : 'finish reason: ' + finishReason.kind);
    }
    return { callError: callError, firstText: firstText, finishReason: finishReason, chunkCount: chunkCount };
  };

  const runTest = async (providerId, modelId, signal) => {
    const map = providersMap();
    requireProvider(map, providerId);
    const profile = map[providerId];
    const headers = headersOf(profile);
    const bodyMasquerade = bodyMasqueradeOf(profile);
    const bodyPatch = bodyPatchState();
    // Mirror the pi-ai adapter's requestHeaders: attribution names are used as
    // defaults, but an explicitly configured profile user-agent wins on the wire.
    const effective = {};
    for (const name of Object.keys(headers)) {
      // The body-masquerade switch is internal — the patched pi-ai strips it,
      // so reporting it as a wire header would be a lie.
      if (name.toLowerCase() === BODY_SWITCH_HEADER) continue;
      if (RESERVED_HEADERS.indexOf(name.toLowerCase()) === -1) effective[name] = String(headers[name]);
    }
    const profileUA = Object.keys(headers).find((name) => name.toLowerCase() === 'user-agent');
    if (profileUA === undefined) {
      effective['user-agent'] = 'deepseek-harness (attribution; no profile user-agent configured) ' + (detectPreset(headers) || 'no-disguise');
    } else {
      effective['user-agent'] = String(headers[profileUA]);
    }
    const models = profile.models && Array.isArray(profile.models) ? profile.models : [];
    const chosen = modelId || (models.length > 0 && models[0] && models[0].id ? models[0].id : '');
    if (!chosen) return { ok: false, error: 'provider has no models configured; pass model explicitly' };
    // anyrouter-style relays QUEUE while their channels are busy: they reject
    // every shot with 429/503 ("Service Unavailable") and a client that keeps
    // retrying with exponential backoff eventually gets through. Ride the queue
    // for up to ~2-3 minutes (abortable via the caller's signal) before
    // reporting anything about the disguise.
    const maxAttempts = TEST_QUEUE_ATTEMPTS;
    let result = null;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts += 1;
      result = await callOnce(providerId, chosen, signal);
      if (result.callError === null || !RETRYABLE_STATUS.test(result.callError)) break;
      if (signal && signal.aborted) break;
      if (attempts < maxAttempts) await sleep(queueDelay(attempts));
    }
    const callError = result.callError;
    const classification = callError === null ? null : classifyCallError(callError, {
      bodyMasquerade: bodyMasquerade,
      bodyPatched: bodyPatch.patched
    });
    const uaPatch = uaPatchState();
    // When the profile spoofs a user-agent but the adapter is unpatched, the
    // wire header is NOT what this report shows; say so rather than implying it.
    const uaSpoofIneffective = profileUA !== undefined && uaPatch.supported === true && uaPatch.patched === false;
    // Same trap one level down: the switch is in settings but the code that
    // acts on it is not loaded, so the body still looks like DSH on the wire.
    const bodySpoofIneffective = bodyMasquerade && bodyPatch.supported === true && bodyPatch.patched === false;
    return {
      ok: callError === null,
      provider: providerId,
      model: chosen,
      activePreset: detectPreset(headers),
      bodyMasquerade: bodyMasquerade,
      bodyMasqueradeLive: bodyMasquerade && bodyPatch.patched === true,
      effectiveWireHeaders: effective,
      attempts: attempts,
      firstText: result.firstText,
      finishReason: result.finishReason === null ? null : result.finishReason.kind,
      chunkCount: result.chunkCount,
      callError: callError,
      ...(uaSpoofIneffective ? {
        warning: 'dsh-llm-pi-ai is NOT user-agent patched, so the spoofed user-agent above is replaced by the harness attribution UA on the wire; apply the patch and restart dsh web',
        warningZh: 'dsh-llm-pi-ai 未打 user-agent 补丁，上面的伪装 user-agent 实际不会上线（会被归属 UA 覆盖）；请应用补丁并重启 dsh web'
      } : {}),
      ...(bodySpoofIneffective ? {
        bodyWarning: 'this route asks for body masquerade but @earendil-works/pi-ai is NOT body patched, so the request body still looks like DSH; apply the patch and restart dsh web',
        bodyWarningZh: '该路线已开启请求体伪装，但 @earendil-works/pi-ai 未打请求体补丁，请求体实际仍是 DSH 的形状；请应用补丁并重启 dsh web'
      } : {}),
      ...(classification ? {
        classification: classification.category,
        disguiseImplicated: classification.disguiseImplicated,
        hint: classification.hint,
        hintZh: classification.hintZh
      } : {})
    };
  };

  const run = async (args, signal) => {
    const action = args && args.action ? String(args.action) : 'list';
    if (action === 'list') {
      const llm = ctx.get('llm');
      let registeredRoutes = [];
      if (llm !== undefined) {
        try {
          // Every route with a registered adapter — including wrapper routes the
          // user's agent actually uses (e.g. vision-toolkit-anyrouter), which
          // are not llm-pi-ai providers and would otherwise be invisible here.
          const infos = llm.listProviders ? llm.listProviders() : [];
          registeredRoutes = infos.map((info) => {
            const id = info && info.id ? String(info.id) : '';
            let policy = null;
            try {
              const reg = llm.providerRetryPolicy(id);
              if (reg !== undefined && reg !== null) {
                policy = {
                  mode: typeof reg.mode === 'string' ? reg.mode : null,
                  maxRetries: typeof reg.maxRetries === 'number' ? reg.maxRetries : null,
                  initialDelayMs: typeof reg.initialDelayMs === 'number' ? reg.initialDelayMs : null,
                  maxDelayMs: typeof reg.maxDelayMs === 'number' ? reg.maxDelayMs : null,
                  retryableCodes: Array.isArray(reg.retryableCodes) ? reg.retryableCodes.map(String) : []
                };
              }
            } catch (e) {
              policy = { error: String(e && e.message ? e.message : e) };
            }
            return { id: id, name: info.name !== undefined ? String(info.name) : id, retryPolicy: policy };
          });
        } catch (e) {
          registeredRoutes = [{ error: String(e && e.message ? e.message : e) }];
        }
      }
      return {
        ok: true,
        providers: listProviders(),
        registeredRoutes: registeredRoutes,
        uaPatch: uaPatchState(),
        bodyPatch: bodyPatchState(),
        variantPatch: variantPatchState(),
        // What body masquerade would advertise to the model: read-only tools,
        // named here so the cost is visible without reading the patch.
        sentinelTools: FINGERPRINT.sentinelTools.map((tool) => tool.name)
      };
    }
    if (action === 'patch') {
      return applyPatches();
    }
    if (action === 'unpatch') {
      return revertPatches();
    }
    if (action === 'on') {
      const providerId = args && args.provider ? String(args.provider) : '';
      const presetId = args && args.preset ? String(args.preset) : '';
      const headersJson = args && args.headersJson ? String(args.headersJson) : undefined;
      if (!providerId) return { ok: false, error: 'provider is required' };
      if (!presetId) return { ok: false, error: 'preset is required (claude-code | codex | custom)' };
      try {
        const applied = await applyPreset(providerId, presetId, headersJson);
        return { ok: true, message: 'provider "' + providerId + '" now masquerades as ' + presetId, applied: applied };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    if (action === 'off') {
      const providerId = args && args.provider ? String(args.provider) : '';
      if (!providerId) return { ok: false, error: 'provider is required' };
      try {
        const cleared = await clearSpoof(providerId);
        return { ok: true, message: 'provider "' + providerId + '" disguise cleared', applied: cleared };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    if (action === 'test') {
      const providerId = args && args.provider ? String(args.provider) : '';
      const modelId = args && args.model ? String(args.model) : '';
      if (!providerId) return { ok: false, error: 'provider is required' };
      try {
        return await runTest(providerId, modelId, signal);
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    if (action === 'queue') {
      const providerId = args && args.provider ? String(args.provider) : '';
      if (!providerId) return { ok: false, error: 'provider is required' };
      const state = args && args.state ? String(args.state) : 'on';
      const override = {};
      if (args && args.retries !== undefined && args.retries !== null && String(args.retries) !== '') {
        const n = Number(args.retries);
        override.retries = Number.isFinite(n) && n >= 0 ? n : undefined;
      }
      if (args && args.maxdelay !== undefined && args.maxdelay !== null && String(args.maxdelay) !== '') {
        const n = Number(args.maxdelay);
        override.maxdelay = Number.isFinite(n) && n > 0 ? n : undefined;
      }
      try {
        if (state === 'off') {
          const cleared = await setQueuePolicy(providerId, false, undefined);
          return { ok: true, message: 'provider "' + providerId + '" queue policy cleared; retries fall back to the harness default', applied: cleared };
        }
        if (state !== 'on') return { ok: false, error: 'state must be on or off' };
        const applied = await setQueuePolicy(providerId, true, override);
        return { ok: true, message: 'provider "' + providerId + '" queue policy enabled: agent turns now retry 429/503 with backoff (maxRetries=' + applied.retryPolicy.maxRetries + ', maxDelay=' + applied.retryPolicy.backoff.maxDelayMs + 'ms)', applied: applied };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    if (action === 'body') {
      const providerId = args && args.provider ? String(args.provider) : '';
      if (!providerId) return { ok: false, error: 'provider is required' };
      const state = args && args.state ? String(args.state) : 'on';
      if (state !== 'on' && state !== 'off') return { ok: false, error: 'state must be on or off' };
      try {
        const applied = await setBodyMasquerade(providerId, state === 'on');
        if (state === 'off') {
          return { ok: true, message: 'provider "' + providerId + '" body masquerade cleared; requests carry DSH\'s own body shape again', applied: applied };
        }
        const restartNote = applied.restartRequired
          ? ' The pi-ai body patch is NOT applied yet, so this has no effect on the wire — run mask_client action=patch and restart dsh web.'
          : '';
        return {
          ok: true,
          message: 'provider "' + providerId + '" now masquerades at the body level: JSON metadata.user_id (device ' + applied.deviceId +
            '), a client-identity system block, and the sentinel tools ' + applied.sentinelTools.join('/') +
            ' are injected into each request. Those sentinels are advertised to the model but not implemented by DSH; they are read-only, so a stray call fails the step rather than doing anything.' + restartNote,
          applied: applied
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    return { ok: false, error: 'unknown action "' + action + '"' };
  };

  // Model tool (same schema as the dynamic variant, registered natively).
  const tools = ctx.get('tools');
  if (tools !== undefined) {
    const { defineTool } = await import('@deepseek-ai/dsh-tools');
    ctx.effect(() => tools.register(defineTool({
      name: 'mask_client',
      description: 'Make one llm-pi-ai provider route masquerade as a known client (claude-code, codex), clear the disguise, enable request-body masquerade, or enable queue-adaptation. Two levels exist because relays gate at two levels: HEADER spoofing (action=on) satisfies User-Agent fingerprinting, while anyrouter-family relays gate on the request BODY — they require a JSON metadata.user_id (session_id UUID-shaped), a client-identity system block, and verbatim Glob/Grep/Read tool definitions, and answer a bare 429/503 to anything else. That 429/503 is indistinguishable from a busy channel pool, so a route failing this check is easily misread as queueing; action=body state=on injects what the check wants (its sentinel tools are advertised to the model but unimplemented — read-only, so a stray call fails the step and does nothing). list shows routes, all patch states, current disguise (stale=true means an older preset that should be re-applied), bodyMasquerade per route, whether the queue policy is on, and registrationRetryPolicy — the policy the agent loop ACTUALLY executes; test makes one real streaming call, rides the queue with exponential backoff (up to ~2-3 min, abortable) and classifies the rejection using that route\'s body state; queue on/off writes/removes the provider retryPolicy dsh-llm-retry executes on failed agent steps; patch/unpatch apply or revert ALL patches — pi-ai user-agent, pi-ai request-body, and the dsh-vision-toolkit variant retry-forwarding (variant is skipped when vision-toolkit is not installed; restart required).',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'on', 'off', 'test', 'body', 'queue', 'patch', 'unpatch'], description: 'list = show routes + all patch states; on = apply a header disguise; off = clear the disguise (body masquerade included); test = make one real call (rides the queue); body = enable/disable request-body masquerade (state=on|off) for relays that fingerprint the body; queue = enable/disable queue-adaptation (state=on|off); patch = apply all patches (pi-ai user-agent + pi-ai request-body + vision-toolkit variant retry-forwarding; restart required); unpatch = revert all' },
        provider: { type: 'string', description: 'pi-ai provider route id (required for on/off/test/body/queue)' },
        preset: { type: 'string', enum: ['claude-code', 'codex', 'custom'], description: 'disguise profile (required for on)' },
        state: { type: 'string', enum: ['on', 'off'], description: 'on/off state (required for action=body and action=queue; default on)' },
        retries: { type: 'string', description: 'queue policy maxRetries override (action=queue state=on)' },
        maxdelay: { type: 'string', description: 'queue policy backoff.maxDelayMs override in ms (action=queue state=on)' },
        model: { type: 'string', description: "model id to test (defaults to the provider's first configured model)" },
        headersJson: { type: 'string', description: 'optional JSON object of extra headers to merge (custom preset, or to override preset values)' }
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
      async execute(args, exec) {
        return run(args, exec && exec.signal);
      }
    })));
  }

  // Panel RPC: the browser panel POSTs JSON to this route.
  const webServer = ctx.get('webServer');
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: API_PATH,
      handler: async (req, res) => {
        if (!isLocalHost(req.headers.host)) return send(res, 403, { ok: false, error: 'forbidden' });
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
        let args;
        try {
          args = await readBody(req);
        } catch (e) {
          return send(res, 400, { ok: false, error: String(e && e.message ? e.message : e) });
        }
        try {
          const result = await run(args, undefined);
          send(res, 200, result);
        } catch (e) {
          send(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
        }
      }
    }));
  }

  console.log(NAME + ' ready: llm-pi-ai spoof controller active');
}

module.exports = {
  name: NAME,
  inject: ['settings', 'tools', 'llm', 'webServer'],
  apply
};
