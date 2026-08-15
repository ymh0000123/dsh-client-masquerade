// dsh-client-masquerade — CLIENT (browser) half.
// Paste this entire file's content into the Dynamic Plugin dialog's code.client,
// or load it programmatically through plugin.js. It is the body of the async
// function the runner wraps; it must end with `return { apply(ctx) { ... } }`.
// Localized settings page (Settings -> Client Masquerade) + run-card panel.
const el = React.createElement;

const DICTS = {
  en: {
    title: 'Client Masquerade',
    description: 'Spoofed client-identity headers are written into the selected provider profile and sent on every request to that route. The reserved attribution user-agent cannot be overridden.',
    provider: 'Provider',
    status: 'Status',
    masquerading: 'masquerading as {preset}',
    none: 'no disguise',
    dash: '—',
    off: 'Off',
    testCall: 'Test call',
    currentHeaders: 'Current headers',
    noHeaders: 'no extra headers',
    runningTest: 'running test call…',
    testOk: 'test call ok: {text}',
    noText: 'no text',
    requestFailed: 'request failed',
    applied: 'Applied disguise to {provider}',
    cleared: 'Cleared disguise for {provider}',
    'preset.claude-code': 'Claude Code',
    'preset.codex': 'Codex',
    'preset.custom': 'Custom'
  },
  zh: {
    title: '客户端伪装',
    description: '将伪造的客户端身份头写入所选 provider 的配置，并随该路由的每次请求发送。保留的归属 user-agent 无法覆盖。',
    provider: 'Provider',
    status: '状态',
    masquerading: '伪装为 {preset}',
    none: '未伪装',
    dash: '—',
    off: '关闭',
    testCall: '测试调用',
    currentHeaders: '当前请求头',
    noHeaders: '无额外请求头',
    runningTest: '正在发起测试调用…',
    testOk: '测试调用成功：{text}',
    noText: '（无文本）',
    requestFailed: '请求失败',
    applied: '已对 {provider} 应用伪装',
    cleared: '已清除 {provider} 的伪装',
    'preset.claude-code': 'Claude Code',
    'preset.codex': 'Codex',
    'preset.custom': '自定义'
  }
};

function interpolate(str, params) {
  if (!params) return str;
  let out = str;
  for (const key of Object.keys(params)) {
    out = out.split('{' + key + '}').join(String(params[key]));
  }
  return out;
}

const row = (children, style) => el('div', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }, style || {}) }, children);

return {
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) return;
    const locale = ctx.get('locale');

    if (locale !== undefined) {
      ctx.effect(() => locale.register('client-masquerade', 'en', DICTS.en));
      ctx.effect(() => locale.register('client-masquerade', 'zh', DICTS.zh));
    }

    const t = locale !== undefined
      ? locale.bind('client-masquerade')
      : (key, params) => interpolate(DICTS.en[key] !== undefined ? DICTS.en[key] : key, params);

    function MaskPanel() {
      const [state, setState] = React.useState({ providers: [], selected: '', busy: false, message: '', error: '' });
      const [, setRev] = React.useState(0);

      React.useEffect(() => {
        if (locale === undefined) return;
        return locale.subscribe(() => setRev((r) => r + 1));
      }, []);

      const refresh = () => {
        setState((s) => Object.assign({}, s, { busy: true }));
        return host.call('mask-client-rpc', { action: 'list' }).then((res) => {
          const providers = res && Array.isArray(res.providers) ? res.providers : [];
          setState((s) => Object.assign({}, s, {
            providers: providers,
            selected: s.selected || (providers.length > 0 ? providers[0].id : ''),
            busy: false,
            message: '',
            error: ''
          }));
        }).catch((err) => {
          setState((s) => Object.assign({}, s, { busy: false, error: String(err && err.message ? err.message : err) }));
        });
      };

      React.useEffect(() => { refresh(); }, []);

      const act = (preset) => {
        if (!state.selected) return;
        const selectedInfo = state.providers.find((p) => p.id === state.selected);
        setState((s) => Object.assign({}, s, { busy: true, error: '', message: '' }));
        host.call('mask-client-rpc', preset === 'off' ? { action: 'off', provider: state.selected } : { action: 'on', provider: state.selected, preset: preset })
          .then((res) => {
            if (res && res.ok) {
              const label = selectedInfo ? selectedInfo.displayName : state.selected;
              setState((s) => Object.assign({}, s, { busy: false, message: preset === 'off' ? t('cleared', { provider: label }) : t('applied', { provider: label, preset: t('preset.' + preset) }) }));
              return refresh();
            }
            setState((s) => Object.assign({}, s, { busy: false, error: res && res.error ? res.error : t('requestFailed') }));
          })
          .catch((err) => {
            setState((s) => Object.assign({}, s, { busy: false, error: String(err && err.message ? err.message : err) }));
          });
      };

      const test = () => {
        if (!state.selected) return;
        setState((s) => Object.assign({}, s, { busy: true, error: '', message: t('runningTest') }));
        host.call('mask-client-rpc', { action: 'test', provider: state.selected })
          .then((res) => {
            if (res && res.ok) {
              setState((s) => Object.assign({}, s, { busy: false, message: t('testOk', { text: res.firstText || t('noText') }) }));
            } else {
              setState((s) => Object.assign({}, s, { busy: false, error: res && res.callError ? res.callError : (res && res.error ? res.error : t('requestFailed')) }));
            }
          })
          .catch((err) => {
            setState((s) => Object.assign({}, s, { busy: false, error: String(err && err.message ? err.message : err) }));
          });
      };

      const selectedInfo = state.providers.find((p) => p.id === state.selected);
      const statusText = selectedInfo
        ? (selectedInfo.active ? t('masquerading', { preset: t('preset.' + selectedInfo.active) }) : t('none'))
        : t('dash');
      const headerRows = selectedInfo && selectedInfo.headers.length > 0
        ? selectedInfo.headers.map((h) => el('div', { key: h.name, style: { fontSize: '11px', opacity: 0.75, fontFamily: 'monospace' } }, h.name + ': ' + h.value))
        : [el('div', { key: 'none', style: { fontSize: '11px', opacity: 0.6 } }, t('noHeaders'))];

      return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        el('div', { style: { fontWeight: 600, fontSize: '13px' } }, t('title')),
        el('div', { style: { fontSize: '12px', opacity: 0.8 } }, t('description')),
        row([
          el('label', { key: 'l', style: { fontSize: '12px' } }, t('provider')),
          el('select', {
            key: 's',
            value: state.selected,
            disabled: state.busy,
            onChange: (e) => setState((s) => Object.assign({}, s, { selected: e.target.value })),
            style: { fontSize: '12px', maxWidth: '240px' }
          }, state.providers.map((p) => el('option', { key: p.id, value: p.id }, p.displayName + ' (' + p.id + ')')))
        ]),
        el('div', { key: 'status', style: { fontSize: '12px' } }, t('status') + ': ' + statusText),
        row([
          el('button', { key: 'cc', disabled: state.busy || !state.selected, onClick: () => act('claude-code'), style: { fontSize: '12px' } }, t('preset.claude-code')),
          el('button', { key: 'cx', disabled: state.busy || !state.selected, onClick: () => act('codex'), style: { fontSize: '12px' } }, t('preset.codex')),
          el('button', { key: 'off', disabled: state.busy || !state.selected, onClick: () => act('off'), style: { fontSize: '12px' } }, t('off')),
          el('button', { key: 't', disabled: state.busy || !state.selected, onClick: () => test(), style: { fontSize: '12px' } }, t('testCall'))
        ]),
        el('div', { key: 'headersLabel', style: { fontSize: '12px', fontWeight: 600 } }, t('currentHeaders')),
        el('div', { key: 'headers', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, headerRows),
        state.message ? el('div', { key: 'msg', style: { fontSize: '12px', color: '#2e7d32' } }, state.message) : null,
        state.error ? el('div', { key: 'err', style: { fontSize: '12px', color: '#c62828' } }, state.error) : null
      );
    }

    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => el(MaskPanel)
    ));

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'client-masquerade', order: 40, label: () => t('title') },
      () => el('div', { style: { maxWidth: '560px' } }, el(MaskPanel))
    ));
  }
};
