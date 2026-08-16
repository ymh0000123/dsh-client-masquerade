window.__ModuleLoader__.load({
	id: "dsh-client-masquerade",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");

		const NAME = "dsh-client-masquerade";
		const API_PATH = "/dsh-client-masquerade/api";

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
				'preset.custom': 'Custom',
				uaPatch: 'User-Agent patch',
				uaPatched: 'applied',
				uaNotPatched: 'not applied',
				uaApply: 'Apply',
				uaApplying: 'applying…',
				uaAppliedMsg: 'Patch written — restart dsh web to take effect.',
				uaAlready: 'Patch already applied.',
				uaUnsupported: 'not supported in dynamic mode — run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs manually'
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
				'preset.custom': '自定义',
				uaPatch: 'User-Agent 补丁',
				uaPatched: '已应用',
				uaNotPatched: '未应用',
				uaApply: '应用',
				uaApplying: '正在应用…',
				uaAppliedMsg: '补丁已写入，重启 dsh web 后生效。',
				uaAlready: '补丁已应用。',
				uaUnsupported: '动态模式不支持在线应用——请手动执行 node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs'
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

		const el = React.createElement;
		const row = (children, style) => el('div', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }, style || {}) }, children);

		// Theme the controls with the GUI's design tokens (dsw alias variables),
		// following the shell's own injected-<style> pattern (data-plugin-css).
		const MASK_CSS = '.dshcm-select{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:20px;padding:4px 8px;max-width:260px}.dshcm-btn{box-sizing:border-box;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:20px;padding:4px 12px;transition:background 120ms ease,border-color 120ms ease}.dshcm-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}.dshcm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dshcm-btn:disabled{opacity:.5;cursor:default}.dshcm-btn-off{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}';
		const MASK_STYLE_ID = 'dsh-client-masquerade/mask.css';
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(MASK_STYLE_ID) + ']') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-client-masquerade';
			tag.dataset.pluginCss = MASK_STYLE_ID;
			tag.textContent = MASK_CSS;
			document.head.appendChild(tag);
		}

		const call = (payload) => fetch(API_PATH, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		}).then((res) => res.json());

		function apply(ctx) {
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
				const [state, setState] = React.useState({ providers: [], selected: '', busy: false, message: '', error: '', uaPatch: null, patchBusy: false, patchMsg: '', patchError: '' });
				const [, setRev] = React.useState(0);

				React.useEffect(() => {
					if (locale === undefined) return;
					return locale.subscribe(() => setRev((r) => r + 1));
				}, []);

				const refresh = () => {
					setState((s) => Object.assign({}, s, { busy: true }));
					return call({ action: 'list' }).then((res) => {
						const providers = res && Array.isArray(res.providers) ? res.providers : [];
						setState((s) => Object.assign({}, s, {
							providers: providers,
							selected: s.selected || (providers.length > 0 ? providers[0].id : ''),
							busy: false,
							message: '',
							error: '',
							uaPatch: res && res.uaPatch ? res.uaPatch : null
						}));
					}).catch((err) => {
						setState((s) => Object.assign({}, s, { busy: false, error: String(err && err.message ? err.message : err) }));
					});
				};

				React.useEffect(() => { refresh(); }, []);

				const applyPatch = () => {
					setState((s) => Object.assign({}, s, { patchBusy: true, patchError: '', patchMsg: '' }));
					call({ action: 'patch' })
						.then((res) => {
							if (res && res.ok) {
								setState((s) => Object.assign({}, s, {
									patchBusy: false,
									uaPatch: res.alreadyPatched ? Object.assign({}, s.uaPatch, { patched: true }) : s.uaPatch,
									patchMsg: res.alreadyPatched ? t('uaAlready') : t('uaAppliedMsg')
								}));
								return refresh();
							}
							setState((s) => Object.assign({}, s, { patchBusy: false, patchError: res && res.error ? res.error : t('requestFailed') }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { patchBusy: false, patchError: String(err && err.message ? err.message : err) }));
						});
				};

				const act = (preset) => {
					if (!state.selected) return;
					const selectedInfo = state.providers.find((p) => p.id === state.selected);
					setState((s) => Object.assign({}, s, { busy: true, error: '', message: '' }));
					call(preset === 'off' ? { action: 'off', provider: state.selected } : { action: 'on', provider: state.selected, preset: preset })
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
					call({ action: 'test', provider: state.selected })
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
							className: 'dshcm-select'
						}, state.providers.map((p) => el('option', { key: p.id, value: p.id }, p.displayName + ' (' + p.id + ')')))
					]),
					el('div', { key: 'status', style: { fontSize: '12px' } }, t('status') + ': ' + statusText),
					row([
						el('span', { key: 'ual', style: { fontSize: '12px' } }, t('uaPatch') + ': ' + (
							state.uaPatch === null ? t('dash')
								: state.uaPatch.error !== undefined && state.uaPatch.error ? t('dash')
								: state.uaPatch.patched ? t('uaPatched') : t('uaNotPatched')
						)),
						state.uaPatch !== null && state.uaPatch.supported
							? el('button', {
								key: 'ub',
								className: 'dshcm-btn',
								disabled: state.patchBusy || (state.uaPatch && state.uaPatch.patched),
								onClick: () => applyPatch()
							}, state.patchBusy ? t('uaApplying') : t('uaApply'))
							: el('span', { key: 'un', style: { fontSize: '11px', opacity: 0.7 } }, t('uaUnsupported'))
					]),
					state.patchMsg ? el('div', { key: 'pm', style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, state.patchMsg) : null,
					state.patchError ? el('div', { key: 'pe', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, state.patchError) : null,
					row([
						el('button', { key: 'cc', className: 'dshcm-btn', disabled: state.busy || !state.selected, onClick: () => act('claude-code') }, t('preset.claude-code')),
						el('button', { key: 'cx', className: 'dshcm-btn', disabled: state.busy || !state.selected, onClick: () => act('codex') }, t('preset.codex')),
						el('button', { key: 'off', className: 'dshcm-btn dshcm-btn-off', disabled: state.busy || !state.selected, onClick: () => act('off') }, t('off')),
						el('button', { key: 't', className: 'dshcm-btn', disabled: state.busy || !state.selected, onClick: () => test() }, t('testCall'))
					]),
					el('div', { key: 'headersLabel', style: { fontSize: '12px', fontWeight: 600 } }, t('currentHeaders')),
					el('div', { key: 'headers', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, headerRows),
					state.message ? el('div', { key: 'msg', style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, state.message) : null,
					state.error ? el('div', { key: 'err', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, state.error) : null
				);
			}

			// Installed (static) mode has no dynamic run card, so only the
			// settings page is registered (tool.view.cordis stays dynamic-only).
			slots.inject('settings.section', () => slots.register(
				{ name: 'settings.section', id: 'client-masquerade', order: 40, label: () => t('title') },
				() => el('div', { style: { maxWidth: '560px' } }, el(MaskPanel))
			));
		}

		exports.name = NAME;
		exports.apply = apply;
		return module.exports;
	}
});
