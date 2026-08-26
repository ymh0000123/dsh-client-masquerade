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

const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { applyPatch, revertPatch, MARKER: PATCH_MARKER, VARIANT_MARKER } = require('./patches/patch-lib.js');

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
 * whether the disguise is even implicated. The distinction matters because a
 * relay that has exhausted its upstream Claude channels rejects a REAL Claude
 * Code CLI exactly as it rejects us; blaming the masquerade for that sends the
 * user off tuning headers that were never the problem.
 *
 * @param {string} callError - the error text captured from the stream.
 * @returns {{category: string, disguiseImplicated: boolean, hint: string, hintZh: string}}
 */
function classifyCallError(callError) {
  const text = String(callError || '');
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
      hint: 'gateway validated the Claude Code request body shape and rejected it; header-only masquerade cannot satisfy this route (body-level mimicry is out of scope)',
      hintZh: '网关校验了 Claude Code 请求体结构并拒绝；仅靠请求头伪装不够，需要请求体级别的模拟（超出本插件范围）'
    };
  }
  // No upstream channel / model pool exhausted. anyrouter-style relays queue
  // instead of failing: while the channel pool is empty they answer 429 or 503
  // with a bare "Service Unavailable" (or the new-api "get_channel_failed" /
  // "负载已经达到上限" text), and a client that keeps retrying with backoff
  // eventually gets through. That is a queue, not a disguise problem.
  const queued = /get_channel_failed|无可用渠道|负载已经达到上限|当前分组.*(负载|无可用)|no available channel/i.test(text);
  if (queued || RETRYABLE_STATUS.test(text)) {
    return {
      category: 'queued',
      disguiseImplicated: false,
      hint: 'the gateway is queuing — its upstream Claude channels are all busy right now and it answers a real Claude Code CLI the same way. Retrying with backoff eventually gets through; enable the provider queue policy (mask_client action=queue state=on provider=…) so agent turns outwait the queue instead of failing after the default ~30s',
      hintZh: '网关正在排队——其上游 Claude 渠道当前全部繁忙（对真实 Claude Code CLI 也是同样结果）。带退避重试最终能通过；请为该 provider 开启排队适配（mask_client action=queue state=on provider=…），让 agent 请求能等到渠道空闲，而不是在默认约 30 秒后就失败'
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
        'Apply the variant retry patch (patches/patch-lib.js applyVariantRetryPatch on <vision-toolkit>/lib/image-input-variants.js) and restart dsh web.'
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

  const headersOf = (profile) => {
    if (profile === undefined || profile === null || typeof profile !== 'object') return {};
    const h = profile.headers;
    return h && typeof h === 'object' ? h : {};
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
    // Mirror the pi-ai adapter's requestHeaders: attribution names are used as
    // defaults, but an explicitly configured profile user-agent wins on the wire.
    const effective = {};
    for (const name of Object.keys(headers)) {
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
    const classification = callError === null ? null : classifyCallError(callError);
    const uaPatch = uaPatchState();
    // When the profile spoofs a user-agent but the adapter is unpatched, the
    // wire header is NOT what this report shows; say so rather than implying it.
    const uaSpoofIneffective = profileUA !== undefined && uaPatch.supported === true && uaPatch.patched === false;
    return {
      ok: callError === null,
      provider: providerId,
      model: chosen,
      activePreset: detectPreset(headers),
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
      return { ok: true, providers: listProviders(), registeredRoutes: registeredRoutes, uaPatch: uaPatchState() };
    }
    if (action === 'patch') {
      return applyUserAgentPatch();
    }
    if (action === 'unpatch') {
      return revertUserAgentPatch();
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
    return { ok: false, error: 'unknown action "' + action + '"' };
  };

  // Model tool (same schema as the dynamic variant, registered natively).
  const tools = ctx.get('tools');
  if (tools !== undefined) {
    const { defineTool } = await import('@deepseek-ai/dsh-tools');
    ctx.effect(() => tools.register(defineTool({
      name: 'mask_client',
      description: 'Make one llm-pi-ai provider route masquerade as a known client (claude-code, codex) by writing spoofed request headers into its profile settings, clear the disguise, or enable queue-adaptation. anyrouter-style relays queue while their upstream channels are busy (429/503 "Service Unavailable") and a client that keeps retrying with backoff eventually gets through; queue on/off writes/removes the provider retryPolicy that dsh-llm-retry executes on failed agent steps, so agent turns outwait the queue instead of failing after the default ~30s. list shows routes, the pi-ai user-agent patch state, current disguise (stale=true means an older preset that should be re-applied), whether the queue policy is on, and registrationRetryPolicy — the policy the agent loop ACTUALLY executes (the ground truth that settings changes reached the llm registration); test makes one real streaming call, rides the queue with exponential backoff (up to ~2-3 min, abortable) and classifies the rejection — disguiseImplicated=false means the gateway would reject a real Claude Code CLI too; patch/unpatch apply or revert the pi-ai user-agent patch (restart required).',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'on', 'off', 'test', 'queue', 'patch', 'unpatch'], description: 'list = show routes + patch state; on = apply a disguise; off = clear it; test = make one real call (rides the queue); queue = enable/disable queue-adaptation (state=on|off); patch = apply the pi-ai user-agent patch (restart required); unpatch = revert it' },
        provider: { type: 'string', description: 'pi-ai provider route id (required for on/off/test/queue)' },
        preset: { type: 'string', enum: ['claude-code', 'codex', 'custom'], description: 'disguise profile (required for on)' },
        state: { type: 'string', enum: ['on', 'off'], description: 'queue policy state (required for action=queue; default on)' },
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
