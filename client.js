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
				staleSuffix: ' (outdated preset — click it again to refresh)',
				gatewayFault: 'Gateway rejected it, but not because of the disguise: {hint}',
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
				uaUnsupported: 'not supported in dynamic mode — run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs manually',
				uaRevert: 'Revert',
				uaReverting: 'reverting…',
				uaRevertedMsg: 'Patch reverted — restart dsh web to take effect.',
				uaAlreadyStock: 'Patch already reverted.',
				variantPatch: 'Vision-toolkit patch',
				variantPatched: 'applied',
				variantNotPatched: 'not applied',
				variantSkipped: 'not installed',
				bodyPatch: 'Body patch',
				bodyPatched: 'applied',
				bodyNotPatched: 'not applied',
				patchesAppliedMsg: 'Patches written — restart dsh web to take effect.',
				patchesAlready: 'Patches already applied.',
				patchesRevertedMsg: 'Patches reverted — restart dsh web to take effect.',
				patchesAlreadyStock: 'Patches already reverted.',
				body: 'Body masquerade',
				bodyOn: 'On (injects {tools})',
				bodyOff: 'Off',
				bodyEnable: 'Body on',
				bodyDisable: 'Body off',
				bodyBusy: 'updating…',
				bodyHelp: 'For relays that fingerprint the request body (anyrouter family): they answer a bare 429/503 — which looks exactly like a busy channel pool — unless the body carries a JSON metadata.user_id, a client-identity system block and verbatim tool definitions. The sentinel tools are advertised to the model but not implemented here; they are read-only, so a stray call just fails that step.',
				bodyEnabledMsg: 'Body masquerade enabled for {provider} — requests now carry the Claude Code body fingerprint.',
				bodyDisabledMsg: 'Body masquerade cleared for {provider}.',
				bodyNeedsPatch: 'The body patch is not applied yet, so this has no effect on the wire — apply the patches above and restart dsh web.',
				queue: 'Queue adaptation',
				queueOn: 'Queued (retries {retries}×, up to {maxdelay}ms)',
				queueOff: 'Off',
				queueEnable: 'Queue on',
				queueDisable: 'Queue off',
				queueBusy: 'updating…',
				queueEnabledMsg: 'Queue policy enabled for {provider} — agent turns now outwait 429/503 with backoff.',
				queueDisabledMsg: 'Queue policy cleared for {provider}.'
			},
			zh: {
				title: '客户端伪装',
				description: '将伪造的客户端身份头写入所选 provider 的配置，并随该路由的每次请求发送。保留的归属 user-agent 无法覆盖。',
				provider: 'Provider',
				status: '状态',
				masquerading: '伪装为 {preset}',
				staleSuffix: '（预设已过期——再点一次以刷新）',
				gatewayFault: '网关拒绝了请求，但与伪装无关：{hint}',
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
				uaUnsupported: '动态模式不支持在线应用——请手动执行 node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs',
				uaRevert: '还原',
				uaReverting: '正在还原…',
				uaRevertedMsg: '补丁已还原，重启 dsh web 后生效。',
				uaAlreadyStock: '补丁已是原状。',
				variantPatch: 'Vision-toolkit 变体补丁',
				variantPatched: '已应用',
				variantNotPatched: '未应用',
				variantSkipped: '未安装',
				bodyPatch: '请求体补丁',
				bodyPatched: '已应用',
				bodyNotPatched: '未应用',
				patchesAppliedMsg: '补丁已写入，重启 dsh web 后生效。',
				patchesAlready: '补丁均已应用。',
				patchesRevertedMsg: '补丁已还原，重启 dsh web 后生效。',
				patchesAlreadyStock: '补丁已是原状。',
				body: '请求体伪装',
				bodyOn: '已开启（注入 {tools}）',
				bodyOff: '关闭',
				bodyEnable: '开启请求体伪装',
				bodyDisable: '关闭请求体伪装',
				bodyBusy: '更新中…',
				bodyHelp: '用于按请求体识别客户端的中转站（anyrouter 系）：请求体若不带 JSON 格式的 metadata.user_id、客户端身份 system 块和逐字的工具定义，它们只回一个裸的 429/503——看起来和渠道池繁忙一模一样。哨兵工具会告知模型但本地并未实现；它们都是只读工具，模型误调至多让那一步失败。',
				bodyEnabledMsg: '已为 {provider} 开启请求体伪装——请求将携带 Claude Code 的请求体指纹。',
				bodyDisabledMsg: '已清除 {provider} 的请求体伪装。',
				bodyNeedsPatch: '请求体补丁尚未应用，此开关暂不会影响线上请求——请先应用上方补丁并重启 dsh web。',
				queue: '排队适配',
				queueOn: '已开启（重试 {retries} 次，最长 {maxdelay}ms）',
				queueOff: '关闭',
				queueEnable: '开启排队',
				queueDisable: '关闭排队',
				queueBusy: '更新中…',
				queueEnabledMsg: '已为 {provider} 开启排队策略——agent 请求将带退避重试，等待 429/503 渠道空闲。',
				queueDisabledMsg: '已清除 {provider} 的排队策略。'
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
				const [state, setState] = React.useState({ providers: [], selected: '', busy: false, message: '', error: '', uaPatch: null, variantPatch: null, bodyPatch: null, sentinelTools: [], patchBusy: false, patchMsg: '', patchError: '', queueBusy: false, bodyBusy: false });
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
							uaPatch: res && res.uaPatch ? res.uaPatch : null,
							variantPatch: res && res.variantPatch ? res.variantPatch : null,
							bodyPatch: res && res.bodyPatch ? res.bodyPatch : null,
							sentinelTools: res && Array.isArray(res.sentinelTools) ? res.sentinelTools : []
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
								const uaOk = res.uaPatch && res.uaPatch.ok !== false;
								const vp = res.variantPatch;
								const vpOk = vp && vp.ok !== false;
								const allAlready = res.uaPatch && res.uaPatch.alreadyPatched === true
									&& (!vp || vp.skipped === true || vp.alreadyPatched === true);
								setState((s) => Object.assign({}, s, {
									patchBusy: false,
									uaPatch: uaOk ? Object.assign({}, s.uaPatch, { patched: true }) : s.uaPatch,
									variantPatch: vpOk ? Object.assign({}, s.variantPatch, { patched: vp.skipped ? null : true }) : s.variantPatch,
									patchMsg: allAlready ? t('patchesAlready') : t('patchesAppliedMsg')
								}));
								return refresh();
							}
							setState((s) => Object.assign({}, s, { patchBusy: false, patchError: res && res.error ? res.error : t('requestFailed') }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { patchBusy: false, patchError: String(err && err.message ? err.message : err) }));
						});
				};

				const unpatch = () => {
					setState((s) => Object.assign({}, s, { patchBusy: true, patchError: '', patchMsg: '' }));
					call({ action: 'unpatch' })
						.then((res) => {
							if (res && res.ok) {
								const uaOk = res.uaPatch && res.uaPatch.ok !== false;
								const vp = res.variantPatch;
								const vpOk = vp && vp.ok !== false;
								const allStock = res.uaPatch && res.uaPatch.alreadyStock === true
									&& (!vp || vp.skipped === true || vp.alreadyStock === true);
								setState((s) => Object.assign({}, s, {
									patchBusy: false,
									uaPatch: uaOk ? Object.assign({}, s.uaPatch, { patched: false }) : s.uaPatch,
									variantPatch: vpOk ? Object.assign({}, s.variantPatch, { patched: vp.skipped ? null : false }) : s.variantPatch,
									patchMsg: allStock ? t('patchesAlreadyStock') : t('patchesRevertedMsg')
								}));
								return refresh();
							}
							setState((s) => Object.assign({}, s, { patchBusy: false, patchError: res && res.error ? res.error : t('requestFailed') }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { patchBusy: false, patchError: String(err && err.message ? err.message : err) }));
						});
				};

				const toggleBody = (enabled) => {
					if (!state.selected) return;
					setState((s) => Object.assign({}, s, { bodyBusy: true, error: '', message: '' }));
					call({ action: 'body', provider: state.selected, state: enabled ? 'on' : 'off' })
						.then((res) => {
							if (res && res.ok) {
								const label = (state.providers.find((p) => p.id === state.selected) || {}).displayName || state.selected;
								// Turning it on while the patch is missing is the silent-failure
								// case: settings look right, the wire does not change. Say so.
								const needsPatch = enabled && res.applied && res.applied.patched === false;
								setState((s) => Object.assign({}, s, {
									bodyBusy: false,
									message: (enabled ? t('bodyEnabledMsg', { provider: label }) : t('bodyDisabledMsg', { provider: label }))
										+ (needsPatch ? ' ' + t('bodyNeedsPatch') : '')
								}));
								return refresh();
							}
							setState((s) => Object.assign({}, s, { bodyBusy: false, error: res && res.error ? res.error : t('requestFailed') }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { bodyBusy: false, error: String(err && err.message ? err.message : err) }));
						});
				};

				const toggleQueue = (enabled) => {
					if (!state.selected) return;
					setState((s) => Object.assign({}, s, { queueBusy: true, error: '', message: '' }));
					call({ action: 'queue', provider: state.selected, state: enabled ? 'on' : 'off' })
						.then((res) => {
							if (res && res.ok) {
								const label = (state.providers.find((p) => p.id === state.selected) || {}).displayName || state.selected;
								setState((s) => Object.assign({}, s, {
									queueBusy: false,
									message: enabled ? t('queueEnabledMsg', { provider: label }) : t('queueDisabledMsg', { provider: label })
								}));
								return refresh();
							}
							setState((s) => Object.assign({}, s, { queueBusy: false, error: res && res.error ? res.error : t('requestFailed') }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { queueBusy: false, error: String(err && err.message ? err.message : err) }));
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
								return;
							}
							// A saturated relay rejects a real Claude Code CLI the same way, so
							// don't let the user read this as a broken disguise.
							const raw = res && res.callError ? res.callError : (res && res.error ? res.error : t('requestFailed'));
							if (res && res.disguiseImplicated === false) {
								// Prefer the localized hint; the snapshot's `active` is the locale id.
								const snapshot = locale !== undefined ? locale.getLocale() : undefined;
								const activeId = snapshot && typeof snapshot.active === 'string' ? snapshot.active : '';
								const zh = activeId.toLowerCase().indexOf('zh') === 0;
								const hint = zh && res.hintZh ? res.hintZh : (res.hint || '');
								setState((s) => Object.assign({}, s, {
									busy: false,
									error: '',
									message: t('gatewayFault', { hint: hint || raw })
								}));
								return;
							}
							setState((s) => Object.assign({}, s, { busy: false, error: raw }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { busy: false, error: String(err && err.message ? err.message : err) }));
						});
				};

				const selectedInfo = state.providers.find((p) => p.id === state.selected);
				const statusText = selectedInfo
					? (selectedInfo.active
						? t('masquerading', { preset: t('preset.' + selectedInfo.active) }) + (selectedInfo.stale ? t('staleSuffix') : '')
						: t('none'))
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
						el('span', { key: 'vpl', style: { fontSize: '12px' } }, t('variantPatch') + ': ' + (
							state.variantPatch === null ? t('dash')
								: state.variantPatch.error !== undefined && state.variantPatch.error ? t('dash')
								: state.variantPatch.patched === null ? t('variantSkipped')
								: state.variantPatch.patched ? t('variantPatched') : t('variantNotPatched')
						)),
						el('span', { key: 'bpl', style: { fontSize: '12px' } }, t('bodyPatch') + ': ' + (
							state.bodyPatch === null ? t('dash')
								: state.bodyPatch.error !== undefined && state.bodyPatch.error ? t('dash')
								: state.bodyPatch.patched ? t('bodyPatched') : t('bodyNotPatched')
						)),
						state.uaPatch !== null && state.uaPatch.supported
							? (state.uaPatch && state.uaPatch.patched
								? el('button', {
									key: 'ur',
									className: 'dshcm-btn dshcm-btn-off',
									disabled: state.patchBusy,
									onClick: () => unpatch()
								}, state.patchBusy ? t('uaReverting') : t('uaRevert'))
								: el('button', {
									key: 'ub',
									className: 'dshcm-btn',
									disabled: state.patchBusy,
									onClick: () => applyPatch()
								}, state.patchBusy ? t('uaApplying') : t('uaApply')))
							: el('span', { key: 'un', style: { fontSize: '11px', opacity: 0.7 } }, t('uaUnsupported'))
					]),
					row([
						el('span', { key: 'bl', style: { fontSize: '12px' } }, t('body') + ': ' + (
							selectedInfo && selectedInfo.bodyMasquerade
								? t('bodyOn', { tools: (state.sentinelTools.length > 0 ? state.sentinelTools : ['Glob', 'Grep', 'Read']).join('/') })
								: t('bodyOff')
						)),
						el('button', {
							key: 'bb',
							className: 'dshcm-btn' + (selectedInfo && selectedInfo.bodyMasquerade ? ' dshcm-btn-off' : ''),
							disabled: state.bodyBusy || !state.selected,
							onClick: () => toggleBody(!(selectedInfo && selectedInfo.bodyMasquerade))
						}, state.bodyBusy
							? t('bodyBusy')
							: (selectedInfo && selectedInfo.bodyMasquerade ? t('bodyDisable') : t('bodyEnable')))
					]),
					el('div', { key: 'bh', style: { fontSize: '11px', opacity: 0.7, lineHeight: 1.5 } }, t('bodyHelp')),
					row([
						el('span', { key: 'ql', style: { fontSize: '12px' } }, t('queue') + ': ' + (
							selectedInfo && selectedInfo.queue
								? t('queueOn', {
									retries: (selectedInfo.retryPolicy && selectedInfo.retryPolicy.maxRetries) || '—',
									maxdelay: (selectedInfo.retryPolicy && selectedInfo.retryPolicy.maxDelayMs) || '—'
								})
								: t('queueOff')
						)),
						el('button', {
							key: 'qb',
							className: 'dshcm-btn' + (selectedInfo && selectedInfo.queue ? ' dshcm-btn-off' : ''),
							disabled: state.queueBusy || !state.selected,
							onClick: () => toggleQueue(!(selectedInfo && selectedInfo.queue))
						}, state.queueBusy
							? t('queueBusy')
							: (selectedInfo && selectedInfo.queue ? t('queueDisable') : t('queueEnable')))
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
