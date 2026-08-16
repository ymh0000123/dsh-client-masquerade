// dsh-client-masquerade — HOST half.
// Paste this entire file's content into the Dynamic Plugin dialog's code.host,
// or load it programmatically through plugin.js. It is the body of the async
// function the runner wraps; it must end with `return { apply(ctx) { ... } }`.
const NS = 'llm-pi-ai';

const PRESETS = {
  'claude-code': {
    'user-agent': 'claude-cli/2.0.0 (external, cli)',
    'anthropic-client': 'claude-code/2.0.0',
    'x-app': 'cli',
    'x-stainless-package-version': '0.94.0',
    'x-stainless-os': 'Windows',
    'x-stainless-arch': 'x64',
    'x-stainless-lang': 'js',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v26.3.0'
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

function detectPreset(headers) {
  if (headers === undefined || headers === null || typeof headers !== 'object') return null;
  for (const id of Object.keys(PRESETS)) {
    const target = PRESETS[id];
    let match = true;
    for (const name of Object.keys(target)) {
      if (headers[name] !== target[name]) { match = false; break; }
    }
    if (match) return id;
  }
  return Object.keys(headers).length > 0 ? 'custom' : null;
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
        return {
          id: id,
          displayName: profile && typeof profile.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName : id,
          active: detectPreset(headers),
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
        if (SPOOF_KEYS.indexOf(name) === -1) sanitized[name] = current[name];
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
        if (SPOOF_KEYS.indexOf(name) === -1) filtered[name] = current[name];
      }
      if (!settings.writable) throw new Error('settings are not writable in this deployment');
      if (Object.keys(filtered).length === 0) {
        await settings.mutate(NS, [hostify({ op: 'unset', path: ['providers', providerId, 'headers'] })]);
        return { provider: providerId, preset: null, headers: {} };
      }
      await settings.mutate(NS, [hostify({ op: 'set', path: ['providers', providerId, 'headers'], value: filtered })]);
      return { provider: providerId, preset: null, headers: filtered };
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
        effective['user-agent'] = 'deepseek-harness (attribution; profile user-agent is reserved) ' + (detectPreset(headers) || 'no-disguise');
      } else {
        effective['user-agent'] = String(headers[profileUA]);
      }
      const models = profile.models && Array.isArray(profile.models) ? profile.models : [];
      const chosen = modelId || (models.length > 0 && models[0] && models[0].id ? models[0].id : '');
      if (!chosen) return { ok: false, error: 'provider has no models configured; pass model explicitly' };
      const llm = ctx.get('llm');
      if (llm === undefined) return { ok: false, error: 'llm service unavailable' };
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
      return {
        ok: callError === null,
        provider: providerId,
        model: chosen,
        activePreset: detectPreset(headers),
        effectiveWireHeaders: effective,
        firstText: firstText,
        finishReason: finishReason === null ? null : finishReason.kind,
        chunkCount: chunkCount,
        callError: callError
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
      description: 'Make one llm-pi-ai provider route masquerade as a known client (claude-code, codex) by writing spoofed request headers into its profile settings, or clear the disguise. Use list to see configured routes and their current disguise; test makes one real streaming call through the route and reports what the gateway received; patch applies the pi-ai user-agent patch (restart required).',
      parameters: {
        action: { type: 'string', required: true, enum: ['list', 'on', 'off', 'test', 'patch'], description: 'list = show routes + patch state; on = apply a disguise; off = clear it; test = make one real call; patch = apply the pi-ai user-agent patch (restart required)' },
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
