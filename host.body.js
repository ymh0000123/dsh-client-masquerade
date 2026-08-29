// dsh-client-masquerade — HOST half.
// Paste this entire file's content into the Dynamic Plugin dialog's code.host,
// or load it programmatically through plugin.js. It is the body of the async
// function the runner wraps; it must end with `return { apply(ctx) { ... } }`.
const NS = 'llm-pi-ai';

/*
 * The claude-code preset mirrors a REAL Claude Code request, captured off the
 * wire from claude-cli 2.1.241 talking to an Anthropic-protocol relay:
 *
 *   POST /v1/messages?beta=true
 *   user-agent: claude-cli/2.1.241 (external, sdk-cli)
 *   x-stainless-package-version: 0.112.1
 *   anthropic-beta: claude-code-20250219,context-1m-2025-08-07,…,advisor-tool-2026-03-01,effort-2025-11-24
 *   anthropic-dangerous-direct-browser-access: true
 *
 * Relays of the "any"/"agent" router family gate on the claude-cli version, and
 * several hard-require the anthropic-beta opt-in before they route at all
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
 * Request-body masquerade switch, mirrored from patches/patch-lib.js (a pasted
 * dynamic plugin body cannot require the package).
 *
 * anyrouter-family relays gate /v1/messages on the request BODY, not its
 * headers: a JSON `metadata.user_id` (device_id non-empty, session_id
 * UUID-shaped), a client-identity `system` block, and verbatim Glob/Grep/Read
 * tool definitions. A body without them draws a bare 429/503 — the same answer
 * a busy channel pool gives, which is what makes this failure so easy to
 * misread. The injection lives in a patch to @earendil-works/pi-ai; this half
 * only writes the switch the patch reads, and strips it from the wire.
 */
const BODY_SWITCH_HEADER = 'x-dsh-body-masquerade';
/** The tools the patch injects. Read-only by choice: a stray call fails the step, nothing more. */
const SENTINEL_TOOL_NAMES = ['Glob', 'Grep', 'Read'];
/** A device id the relay sees as one stable device for this provider. */
const randomDeviceId = () => {
  let hex = '';
  while (hex.length < 32) hex += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return hex.slice(0, 32);
};

/**
 * Gateway statuses worth another attempt. Relays of the new-api family answer
 * 503/500 with `get_channel_failed` — and, confusingly, 429 with the SAME body
 * "Service Unavailable" — while their upstream pool has no free channel.
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
 * Values: 15 retries with exponential backoff 1s→45s, cumulative wait ~7-8
 * minutes — longer than a real Claude Code CLI's own window against the same
 * relay (measured ~10 attempts / ~3:45), so DSH outwaits any queue a stock
 * client can ride out.
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
 * Turn one gateway rejection into something actionable, and say whether the
 * disguise is even implicated.
 *
 * The hard case is the new-api family (anyrouter and friends), which answers
 * 429/503 with a bare "Service Unavailable" for TWO unrelated reasons: its
 * upstream channel pool is busy, or its Claude Code check rejected the request
 * body. The status line cannot tell them apart, and reading every one of them
 * as a queue is what made an earlier version advise "just wait" for a route
 * that would never come back — so the answer follows the route state instead.
 *
 * @param {string} callError - the error text captured from the stream.
 * @param {{ bodyMasquerade?: boolean, bodyPatched?: boolean|null }} [context] - route state.
 */
function classifyCallError(callError, context) {
  const text = String(callError || '');
  const ctxt = context === undefined || context === null ? {} : context;
  if (/\b(401|403)\b/.test(text) || /UNAUTHENTICATED/i.test(text)) {
    return {
      category: 'auth',
      disguiseImplicated: true,
      hint: 'gateway rejected the credential or client identity; check the API key and, for User-Agent-fingerprinting gateways, that the pi-ai user-agent patch is applied and dsh web restarted',
      hintZh: '网关拒绝了凭证或客户端身份：检查 API Key；若网关按 User-Agent 指纹识别，确认已应用 pi-ai user-agent 补丁并重启 dsh web'
    };
  }
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
      hint: 'gateway validated the Claude Code request body shape and rejected it; enable body masquerade for this provider (mask_client action=body state=on provider=…), then apply the pi-ai body patch manually and restart dsh web',
      hintZh: '网关校验了 Claude Code 请求体结构并拒绝；为该 provider 开启请求体伪装（mask_client action=body state=on provider=…），然后手动应用 pi-ai 请求体补丁并重启 dsh web'
    };
  }
  const relayBusyText = /get_channel_failed|无可用渠道|负载已经达到上限|当前分组.*(负载|无可用)|no available channel/i.test(text);
  if (relayBusyText || RETRYABLE_STATUS.test(text)) {
    // A bare 429/503 here means either "no free channel" or "your body did not
    // look like Claude Code". Answer from state this function CAN see.
    if (ctxt.bodyMasquerade === true && ctxt.bodyPatched === false) {
      return {
        category: 'body-fingerprint',
        disguiseImplicated: true,
        hint: 'this route asks for body masquerade but the pi-ai body patch is NOT applied, so the request body still looks like DSH — anyrouter-family relays answer exactly this 429/503 to a body that fails their Claude Code check. Apply patches/apply-pi-ai-body-patch.mjs and restart dsh web',
        hintZh: '该路线已开启请求体伪装，但 pi-ai 请求体补丁未生效，请求体仍是 DSH 的形状——anyrouter 系网关对通不过 Claude Code 校验的请求体正是回这个 429/503。请执行 patches/apply-pi-ai-body-patch.mjs 并重启 dsh web'
      };
    }
    if (ctxt.bodyMasquerade !== true) {
      return {
        category: 'body-fingerprint',
        disguiseImplicated: true,
        hint: 'a bare 429/503 from a new-api-family relay is ambiguous: either its channel pool is busy, or its Claude Code check rejected the request body. Header spoofing alone does not satisfy that check — these relays gate on metadata.user_id, a client-identity system block and verbatim tool definitions. Enable body masquerade (mask_client action=body state=on provider=…), apply the body patch, restart dsh web; if it still fails, the pool really is busy and the queue policy is what helps',
        hintZh: '这类 new-api 系网关的裸 429/503 有两种含义：渠道池真的忙，或者它的 Claude Code 校验拒绝了请求体。仅靠请求头伪装满足不了该校验——它们校验 metadata.user_id、客户端身份 system 块与逐字的工具定义。请开启请求体伪装（mask_client action=body state=on provider=…），应用请求体补丁并重启 dsh web；若之后仍失败，才是渠道池真忙，此时排队策略才有用'
      };
    }
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
 * Which preset a profile's headers express. A profile that belongs to a preset
 * FAMILY but no longer matches value-for-value is reported with stale:true —
 * that is what an older plugin version wrote, and gateways gate on the exact
 * client version, so the user must re-apply to pick up the refreshed values.
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
  if (ua.indexOf('claude-cli/') === 0 || (lower['anthropic-client'] || '').indexOf('claude-code/') === 0) {
    return { active: 'claude-code', stale: true };
  }
  if (ua.indexOf('codex-tui/') === 0 || (lower['openai-client'] || '').indexOf('codex/') === 0) {
    return { active: 'codex', stale: true };
  }
  return { active: Object.keys(headers).length > 0 ? 'custom' : null, stale: false };
}

function detectPreset(headers) {
  return detectPresetDetailed(headers).active;
}

return {
  apply(ctx) {
    const settings = ctx.get('settings');
    if (settings === undefined) {
      console.error('client-masquerade: settings service unavailable');
      return;
    }

    // Dynamic Host code runs in a separate node:vm realm, so object literals we
    // create have a different Object.prototype and host isPlainObject checks
    // reject them. Rebuild values on the prototype of a host-realm object
    // (settings.get returns one) so settings.mutate/update accept our writes.
    const hostProto = (() => {
      const base = settings.get(NS);
      return base !== undefined && base !== null && typeof base === 'object'
        ? Object.getPrototypeOf(base)
        : Object.prototype;
    })();
    const hostify = (value) => {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(hostify);
      const out = Object.create(hostProto);
      for (const key of Object.keys(value)) out[key] = hostify(value[key]);
      return out;
    };

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
        // registration at adapter (re)registration time and handed to
        // agent/request-error via prepareCall for dsh-llm-retry to consume.
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
          stale: detected.stale,
          // Whether this route asks for request-body masquerade. Dynamic mode
          // cannot verify the patch that performs it, so this reports intent.
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
      await settings.mutate(NS, [hostify({ op: 'set', path: ['providers', providerId, 'headers'], value: next })]);
      return { provider: providerId, preset: presetId, headers: next };
    };

    const clearSpoof = async (providerId) => {
      const map = providersMap();
      requireProvider(map, providerId);
      const current = headersOf(map[providerId]);
      const filtered = {};
      for (const name of Object.keys(current)) {
        // `off` means "not masquerading", so the body-masquerade switch goes
        // with the spoofed headers. Switching PRESETS keeps it.
        if (name.toLowerCase() === BODY_SWITCH_HEADER) continue;
        if (SPOOF_KEYS.some((key) => key.toLowerCase() === name.toLowerCase()) === false) filtered[name] = current[name];
      }
      if (!settings.writable) throw new Error('settings are not writable in this deployment');
      if (Object.keys(filtered).length === 0) {
        await settings.mutate(NS, [hostify({ op: 'unset', path: ['providers', providerId, 'headers'] })]);
        return { provider: providerId, preset: null, headers: {} };
      }
      await settings.mutate(NS, [hostify({ op: 'set', path: ['providers', providerId, 'headers'], value: filtered })]);
      return { provider: providerId, preset: null, headers: filtered };
    };

    /**
     * Turn request-body masquerade for a provider on or off.
     *
     * anyrouter-family relays gate /v1/messages on the request BODY: it needs a
     * JSON `metadata.user_id` (device_id non-empty, session_id UUID-shaped), a
     * client-identity `system` block, and verbatim Glob/Grep/Read tool
     * definitions. Anything else gets a bare 429/503 that looks exactly like a
     * busy channel pool.
     *
     * This half only writes the switch header; the injection itself lives in a
     * patch to @earendil-works/pi-ai, which dynamic mode cannot apply (no
     * filesystem writes). Run patches/apply-pi-ai-body-patch.mjs by hand and
     * restart, exactly as with the user-agent patch.
     *
     * Cost: the sentinel tools are advertised to the model but not implemented
     * by DSH. They are read-only by choice, so a stray call fails that step
     * rather than executing or editing anything.
     */
    const setBodyMasquerade = async (providerId, enabled) => {
      const map = providersMap();
      requireProvider(map, providerId);
      if (!settings.writable) throw new Error('settings are not writable in this deployment');
      const current = headersOf(map[providerId]);
      if (!enabled) {
        const filtered = {};
        for (const name of Object.keys(current)) {
          if (name.toLowerCase() !== BODY_SWITCH_HEADER) filtered[name] = current[name];
        }
        if (Object.keys(filtered).length === 0) {
          await settings.mutate(NS, [hostify({ op: 'unset', path: ['providers', providerId, 'headers'] })]);
        } else {
          await settings.mutate(NS, [hostify({ op: 'set', path: ['providers', providerId, 'headers'], value: filtered })]);
        }
        return { provider: providerId, bodyMasquerade: false, deviceId: null, sentinelTools: SENTINEL_TOOL_NAMES.slice(), patched: null, restartRequired: false };
      }
      // Reuse the device id already on file, so off-then-on does not present
      // the relay with a brand-new device.
      const existing = Object.keys(current).find((name) => name.toLowerCase() === BODY_SWITCH_HEADER);
      const existingId = existing === undefined ? '' : String(current[existing]).split(':').slice(1).join(':');
      const deviceId = existingId.length > 0 ? existingId : randomDeviceId();
      const next = {};
      for (const name of Object.keys(current)) {
        if (name.toLowerCase() !== BODY_SWITCH_HEADER) next[name] = current[name];
      }
      next[BODY_SWITCH_HEADER] = 'claude-code:' + deviceId;
      await settings.mutate(NS, [hostify({ op: 'set', path: ['providers', providerId, 'headers'], value: next })]);
      return {
        provider: providerId,
        bodyMasquerade: true,
        deviceId: deviceId,
        sentinelTools: SENTINEL_TOOL_NAMES.slice(),
        // Dynamic mode cannot inspect or apply the patch; say so rather than guess.
        patched: null,
        restartRequired: true
      };
    };

    /**
     * Turn the queue-adaptation policy for a provider on or off. The policy
     * lives in the provider profile (`retryPolicy`) and is executed by the
     * already-enabled dsh-llm-retry plugin on every failed agent step.
     *
     * A `vision-toolkit-<upstream>` wrapper route (the image-input variant the
     * agent may actually use) is mapped to its upstream provider: the wrapper
     * inherits the upstream's resolved policy via the dsh-vision-toolkit
     * retry-forwarding patch.
     */
    const setQueuePolicy = async (providerId, enabled, override) => {
      const map = providersMap();
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
        await settings.mutate(NS, [hostify({ op: 'unset', path: ['providers', upstream, 'retryPolicy'] })]);
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
      await settings.mutate(NS, [hostify({ op: 'set', path: ['providers', upstream, 'retryPolicy'], value: policy })]);
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
      // A delegating route (a vision-toolkit wrapper) can end its stream with a
      // finish chunk carrying no reason at all, so treat anything that is not
      // an object as "no reason reported" rather than reading through it.
      const hasReason = finishReason !== null && finishReason !== undefined && typeof finishReason === 'object';
      const badFinish = hasReason && (finishReason.kind === 'error' || finishReason.kind === 'aborted');
      if (callError === null && badFinish) {
        const failure = finishReason.failure;
        callError = String(failure && failure.message ? failure.message : 'finish reason: ' + String(finishReason.kind));
      }
      return { callError: callError, firstText: firstText, finishReason: finishReason, chunkCount: chunkCount };
    };

    const runTest = async (providerId, modelId, signal) => {
      const map = providersMap();
      requireProvider(map, providerId);
      const profile = map[providerId];
      const headers = headersOf(profile);
      const bodyMasquerade = bodyMasqueradeOf(profile);
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
      // Dynamic mode cannot read the patch state (no filesystem access), so the
      // classifier is told only what the profile asks for. That still separates
      // "never enabled body masquerade" from "enabled and still failing".
      const classification = callError === null ? null : classifyCallError(callError, {
        bodyMasquerade: bodyMasquerade,
        bodyPatched: null
      });
      return {
        ok: callError === null,
        provider: providerId,
        model: chosen,
        activePreset: detectPreset(headers),
        bodyMasquerade: bodyMasquerade,
        effectiveWireHeaders: effective,
        attempts: attempts,
        firstText: result.firstText,
        finishReason: result.finishReason !== null && result.finishReason !== undefined && typeof result.finishReason === 'object' ? result.finishReason.kind : null,
        chunkCount: result.chunkCount,
        callError: callError,
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
          uaPatch: { supported: false, patched: null, error: 'dynamic mode cannot inspect or apply the pi-ai user-agent patch; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs manually and restart' },
          bodyPatch: { supported: false, patched: null, error: 'dynamic mode cannot inspect or apply the pi-ai request-body patch; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-body-patch.mjs manually and restart' },
          variantPatch: { supported: false, patched: null, error: 'dynamic mode cannot inspect or apply the dsh-vision-toolkit variant patch; run node node_modules/dsh-client-masquerade/patches/apply-variant-retry-patch.mjs manually and restart' },
          // What body masquerade would advertise to the model, so the settings
          // card can name the cost without reading the patch.
          sentinelTools: SENTINEL_TOOL_NAMES.slice()
        };
      }
      if (action === 'patch') {
        return { ok: false, error: 'dynamic mode cannot apply the patches; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs and node node_modules/dsh-client-masquerade/patches/apply-variant-retry-patch.mjs manually and restart' };
      }
      if (action === 'unpatch') {
        return { ok: false, error: 'dynamic mode cannot revert the patches; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs --revert and node node_modules/dsh-client-masquerade/patches/apply-variant-retry-patch.mjs --revert manually and restart' };
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
          return {
            ok: true,
            message: 'provider "' + providerId + '" now masquerades at the body level: JSON metadata.user_id (device ' + applied.deviceId +
              '), a client-identity system block, and the sentinel tools ' + applied.sentinelTools.join('/') +
              ' are injected into each request. Those sentinels are advertised to the model but not implemented by DSH; they are read-only, so a stray call fails the step rather than doing anything. ' +
              'Dynamic mode cannot write the patch that performs the injection — run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-body-patch.mjs from your profile dir, then restart dsh web.',
            applied: applied
          };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      }
      return { ok: false, error: 'unknown action "' + action + '"' };
    };

    ctx.effect(() => harness.registerTool(ctx, harness.defineTool({
      name: 'mask_client',
      description: 'Make one llm-pi-ai provider route masquerade as a known client (claude-code, codex), clear the disguise, enable request-body masquerade, or enable queue-adaptation. Two levels exist because relays gate at two levels: HEADER spoofing (action=on) satisfies User-Agent fingerprinting, while anyrouter-family relays gate on the request BODY — they require a JSON metadata.user_id (session_id UUID-shaped), a client-identity system block, and verbatim Glob/Grep/Read tool definitions, and answer a bare 429/503 to anything else. That 429/503 is indistinguishable from a busy channel pool, so a route failing this check is easily misread as queueing; action=body state=on writes the switch (its sentinel tools are advertised to the model but unimplemented — read-only, so a stray call fails the step and does nothing), though dynamic mode cannot apply the patch that performs the injection: run patches/apply-pi-ai-body-patch.mjs by hand. list shows routes, current disguise (stale=true means an older preset that should be re-applied), bodyMasquerade per route, whether the queue policy is on, and registrationRetryPolicy — the policy the agent loop ACTUALLY executes; test makes one real streaming call, rides the queue with exponential backoff (up to ~2-3 min, abortable) and classifies the rejection using that route\'s body state; queue on/off writes/removes the provider retryPolicy dsh-llm-retry executes on failed agent steps; patch/unpatch defer to the manual scripts in dynamic mode.',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'on', 'off', 'test', 'body', 'queue', 'patch', 'unpatch'], description: 'list = show routes; on = apply a header disguise; off = clear the disguise (body masquerade included); test = make one real call (rides the queue); body = enable/disable request-body masquerade (state=on|off) for relays that fingerprint the body; queue = enable/disable queue-adaptation (state=on|off); patch/unpatch = defer to the manual patch scripts in dynamic mode' },
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

    ctx.effect(() => harness.handle('mask-client-rpc', async (args) => {
      return run(args && typeof args === 'object' ? args : {});
    }));

    console.log('client-masquerade ready: llm-pi-ai spoof controller active');
  }
};
