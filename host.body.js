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
 * Gateway statuses worth another attempt. Relays of the new-api family answer
 * 503/500 with `get_channel_failed` — and, confusingly, 429 with the SAME body
 * "Service Unavailable" — while their upstream pool has no free channel.
 */
const RETRYABLE_STATUS = /\b(429|500|502|503|504|520|521|522|523|524|529)\b/;
const TEST_ATTEMPTS = 3;
const TEST_RETRY_BASE_MS = 1500;

const sleep = (ms) => new Promise((resolve) => {
  if (typeof setTimeout === 'function') setTimeout(resolve, ms); else resolve();
});

/**
 * Turn one gateway rejection into something actionable, and say whether the
 * disguise is even implicated: a relay with no free upstream Claude channel
 * rejects a REAL Claude Code CLI exactly as it rejects us, so reporting that
 * as a masquerade failure sends the user tuning headers that were never wrong.
 */
function classifyCallError(callError) {
  const text = String(callError || '');
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
      hint: 'gateway validated the Claude Code request body shape and rejected it; header-only masquerade cannot satisfy this route (body-level mimicry is out of scope)',
      hintZh: '网关校验了 Claude Code 请求体结构并拒绝；仅靠请求头伪装不够，需要请求体级别的模拟（超出本插件范围）'
    };
  }
  const noChannel = /get_channel_failed|无可用渠道|负载已经达到上限|当前分组.*(负载|无可用)|no available channel/i.test(text);
  if (noChannel || RETRYABLE_STATUS.test(text)) {
    return {
      category: noChannel ? 'no-upstream-channel' : 'upstream-saturated',
      disguiseImplicated: false,
      hint: 'the gateway has no healthy upstream channel for this model right now (it answers a real Claude Code CLI the same way), so this is server-side state and NOT a disguise problem — retry later, or try another model/route; verify independently with the same key in Claude Code',
      hintZh: '网关当前对该模型没有可用的上游渠道（对真实 Claude Code CLI 也是同样结果），属服务端状态，与伪装无关——稍后重试或换模型/线路；可用同一个 Key 在 Claude Code 里交叉验证'
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

    const listProviders = () => {
      const map = providersMap();
      return Object.keys(map).map((id) => {
        const profile = map[id];
        const headers = headersOf(profile);
        const detected = detectPresetDetailed(headers);
        return {
          id: id,
          displayName: profile && typeof profile.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName : id,
          active: detected.active,
          stale: detected.stale,
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
      // A saturated relay answers a transient 5xx/429 to a single shot, so retry
      // with linear backoff before reporting anything about the disguise.
      let result = null;
      let attempts = 0;
      while (attempts < TEST_ATTEMPTS) {
        attempts += 1;
        result = await callOnce(providerId, chosen, signal);
        if (result.callError === null || !RETRYABLE_STATUS.test(result.callError)) break;
        if (signal && signal.aborted) break;
        if (attempts < TEST_ATTEMPTS) await sleep(TEST_RETRY_BASE_MS * attempts);
      }
      const callError = result.callError;
      const classification = callError === null ? null : classifyCallError(callError);
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
        return { ok: true, providers: listProviders(), uaPatch: { supported: false, patched: null, error: 'dynamic mode cannot inspect or apply the pi-ai user-agent patch; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs manually and restart' } };
      }
      if (action === 'patch') {
        return { ok: false, error: 'dynamic mode cannot apply the pi-ai user-agent patch; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs manually and restart' };
      }
      if (action === 'unpatch') {
        return { ok: false, error: 'dynamic mode cannot revert the pi-ai user-agent patch; run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs --revert manually and restart' };
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
      return { ok: false, error: 'unknown action "' + action + '"' };
    };

    ctx.effect(() => harness.registerTool(ctx, harness.defineTool({
      name: 'mask_client',
      description: 'Make one llm-pi-ai provider route masquerade as a known client (claude-code, codex) by writing spoofed request headers into its profile settings, or clear the disguise. Use list to see configured routes and their current disguise (stale=true means an older preset that should be re-applied); test makes one real streaming call, retries transient 429/5xx, and classifies the rejection — reporting disguiseImplicated=false when the gateway simply has no upstream channel (it would reject a real Claude Code CLI too); patch applies the pi-ai user-agent patch (restart required).',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'on', 'off', 'test', 'patch', 'unpatch'], description: 'list = show routes + patch state; on = apply a disguise; off = clear it; test = make one real call; patch = apply the pi-ai user-agent patch (restart required); unpatch = revert it' },
        provider: { type: 'string', description: 'pi-ai provider route id (required for on/off/test)' },
        preset: { type: 'string', enum: ['claude-code', 'codex', 'custom'], description: 'disguise profile (required for on)' },
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
