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
				subtitle: 'Per-route client identity for llm-pi-ai providers: spoofed identity headers, an opt-in request-body fingerprint, and the queue policy the agent loop executes.',
				route: 'Route',
				refresh: 'Refresh',
				refreshing: 'refreshing…',
				noProviders: 'No llm-pi-ai provider route is configured, so there is nothing to disguise.',
				close: 'Close',
				dash: '—',
				on: 'On',
				off: 'Off',
				stale: 'stale',
				statDisguise: 'Disguise',
				statBody: 'Body',
				statQueue: 'Queue',
				statPatch: 'Patches',
				patchMixed: 'partial',
				cardIdentity: 'Identity disguise',
				identityHelp: 'Writes spoofed client-identity headers into the selected provider profile; they are sent on every request to that route. The reserved attribution user-agent cannot be overridden, and the headers only reach the wire once the User-Agent patch below is applied.',
				staleNote: 'These headers were written by an older plugin version and claim an outdated client version. Click the same preset again to refresh them.',
				testCall: 'Test call',
				runningTest: 'running test call…',
				testOk: 'test call ok: {text}',
				noText: 'no text',
				gatewayFault: 'Gateway rejected it, but not because of the disguise: {hint}',
				requestFailed: 'request failed',
				applied: 'Applied disguise to {provider}',
				cleared: 'Cleared disguise for {provider}',
				'preset.claude-code': 'Claude Code',
				'preset.codex': 'Codex',
				'preset.custom': 'Custom',
				cardBody: 'Request-body masquerade',
				bodyEnable: 'Turn on',
				bodyDisable: 'Turn off',
				bodyBusy: 'updating…',
				bodyHelp: 'For relays that fingerprint the request body (anyrouter family): they answer a bare 429/503 — indistinguishable from a busy channel pool — unless the body carries a JSON metadata.user_id, a client-identity system block and verbatim tool definitions.',
				sentinel: 'Sentinel tools',
				sentinelHelp: 'Advertised to the model but not implemented here. They are read-only, so a stray call just fails that step.',
				bodyEnabledMsg: 'Body masquerade enabled for {provider} — requests now carry the Claude Code body fingerprint.',
				bodyDisabledMsg: 'Body masquerade cleared for {provider}.',
				bodyNeedsPatch: 'The request-body patch is not applied, so this switch does not change the wire yet. Apply the patches below and restart dsh web.',
				cardQueue: 'Queue adaptation',
				queueEnable: 'Turn on',
				queueDisable: 'Turn off',
				queueBusy: 'updating…',
				queueHelp: 'Relays that queue while their channels are busy reject every shot with 429/503. This writes the provider retryPolicy dsh-llm-retry executes on failed agent steps, so a turn outwaits the queue with backoff instead of failing after the default ~30s.',
				queueEnabledMsg: 'Queue policy enabled for {provider} — agent turns now outwait 429/503 with backoff.',
				queueDisabledMsg: 'Queue policy cleared for {provider}.',
				queueNoPolicy: 'No retry policy on this route; a failed step gives up immediately.',
				kMode: 'Mode',
				kRetries: 'Max retries',
				kInitial: 'Initial delay',
				kMaxDelay: 'Max delay',
				kCodes: 'Retryable',
				kLive: 'Live in agent loop',
				liveYes: 'yes',
				liveNo: 'no (restart or re-save settings)',
				cardPatches: 'Runtime patches',
				patchesApplyAll: 'Apply all',
				patchesRevertAll: 'Revert all',
				patchApplying: 'applying…',
				patchReverting: 'reverting…',
				patchUa: 'pi-ai User-Agent',
				patchUaWhat: 'lets a profile user-agent reach the wire',
				patchBody: 'pi-ai request body',
				patchBodyWhat: 'performs the body fingerprint above',
				patchVariant: 'vision-toolkit variant',
				patchVariantWhat: 'wrapper routes inherit the upstream queue policy',
				pApplied: 'applied',
				pNotApplied: 'not applied',
				pSkipped: 'not installed',
				pUnknown: 'unknown',
				restartHint: 'Patch writes take effect only after a dsh web restart — the running code is already in memory.',
				patchesAppliedMsg: 'Patches written — restart dsh web to take effect.',
				patchesAlready: 'Patches already applied.',
				patchesRevertedMsg: 'Patches reverted — restart dsh web to take effect.',
				patchesAlreadyStock: 'Patches already reverted.',
				uaUnsupported: 'Not available here — run node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs manually, then restart dsh web.',
				cardHeaders: 'Wire headers',
				headersCount: '{n}',
				noHeaders: 'no extra headers on this route'
			},
			zh: {
				title: '客户端伪装',
				subtitle: '为每条 llm-pi-ai 路由配置客户端身份：伪造的身份请求头、可选的请求体指纹，以及 agent 循环真正执行的排队策略。',
				route: '路由',
				refresh: '刷新',
				refreshing: '刷新中…',
				noProviders: '没有配置任何 llm-pi-ai 路由，暂无可伪装的对象。',
				close: '关闭',
				dash: '—',
				on: '已开启',
				off: '关闭',
				stale: '已过期',
				statDisguise: '身份伪装',
				statBody: '请求体',
				statQueue: '排队',
				statPatch: '补丁',
				patchMixed: '部分应用',
				cardIdentity: '身份伪装',
				identityHelp: '把伪造的客户端身份头写入所选 provider 配置，该路由的每次请求都会携带。保留的归属 user-agent 无法覆盖；只有应用下方的 User-Agent 补丁后，这些头才会真正上线。',
				staleNote: '这些请求头由旧版插件写入，声明的客户端版本已过期。再点一次同一个预设即可刷新。',
				testCall: '测试调用',
				runningTest: '正在发起测试调用…',
				testOk: '测试调用成功：{text}',
				noText: '（无文本）',
				gatewayFault: '网关拒绝了请求，但与伪装无关：{hint}',
				requestFailed: '请求失败',
				applied: '已对 {provider} 应用伪装',
				cleared: '已清除 {provider} 的伪装',
				'preset.claude-code': 'Claude Code',
				'preset.codex': 'Codex',
				'preset.custom': '自定义',
				cardBody: '请求体伪装',
				bodyEnable: '开启',
				bodyDisable: '关闭',
				bodyBusy: '更新中…',
				bodyHelp: '用于按请求体识别客户端的中转站（anyrouter 系）：请求体若不带 JSON 格式的 metadata.user_id、客户端身份 system 块和逐字的工具定义，它们只回一个裸的 429/503——与渠道池繁忙完全无法区分。',
				sentinel: '哨兵工具',
				sentinelHelp: '会告知模型但本地并未实现。它们都是只读工具，模型误调至多让那一步失败。',
				bodyEnabledMsg: '已为 {provider} 开启请求体伪装——请求将携带 Claude Code 的请求体指纹。',
				bodyDisabledMsg: '已清除 {provider} 的请求体伪装。',
				bodyNeedsPatch: '请求体补丁尚未应用，此开关暂不会改变线上请求。请先应用下方补丁并重启 dsh web。',
				cardQueue: '排队适配',
				queueEnable: '开启',
				queueDisable: '关闭',
				queueBusy: '更新中…',
				queueHelp: '渠道繁忙时排队的中转站会用 429/503 拒绝每一次尝试。开启后会写入 provider 的 retryPolicy，由 dsh-llm-retry 在失败步骤上执行退避重试，让请求等到渠道空闲，而不是在默认约 30 秒后就失败。',
				queueEnabledMsg: '已为 {provider} 开启排队策略——agent 请求将带退避重试，等待 429/503 渠道空闲。',
				queueDisabledMsg: '已清除 {provider} 的排队策略。',
				queueNoPolicy: '该路由没有重试策略，步骤失败会立即放弃。',
				kMode: '模式',
				kRetries: '最大重试',
				kInitial: '初始延迟',
				kMaxDelay: '最长延迟',
				kCodes: '可重试状态',
				kLive: 'agent 循环已生效',
				liveYes: '是',
				liveNo: '否（需重启或重新保存设置）',
				cardPatches: '运行时补丁',
				patchesApplyAll: '全部应用',
				patchesRevertAll: '全部还原',
				patchApplying: '正在应用…',
				patchReverting: '正在还原…',
				patchUa: 'pi-ai User-Agent',
				patchUaWhat: '让配置的 user-agent 真正上线',
				patchBody: 'pi-ai 请求体',
				patchBodyWhat: '执行上面的请求体指纹注入',
				patchVariant: 'vision-toolkit 变体',
				patchVariantWhat: '让包装路由继承上游的排队策略',
				pApplied: '已应用',
				pNotApplied: '未应用',
				pSkipped: '未安装',
				pUnknown: '未知',
				restartHint: '补丁写入后需重启 dsh web 才生效——当前运行的代码已在内存中。',
				patchesAppliedMsg: '补丁已写入，重启 dsh web 后生效。',
				patchesAlready: '补丁均已应用。',
				patchesRevertedMsg: '补丁已还原，重启 dsh web 后生效。',
				patchesAlreadyStock: '补丁已是原状。',
				uaUnsupported: '此处不可用——请手动执行 node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs，然后重启 dsh web。',
				cardHeaders: '当前请求头',
				headersCount: '{n}',
				noHeaders: '该路由无额外请求头'
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

		// Theme every control with the GUI's design tokens (dsw alias variables),
		// following the shell's own injected-<style> pattern (data-plugin-css).
		const MASK_CSS = [
			'.cmq-root{display:flex;flex-direction:column;gap:13px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary)}',
			'.cmq-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}',
			'.cmq-head-l{min-width:200px;flex:1}',
			'.cmq-title{font-size:15px;font-weight:600}',
			'.cmq-sub{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
			'.cmq-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}',
			'.cmq-stat{display:flex;flex-direction:column;gap:2px;padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}',
			'.cmq-stat-l{font-size:11px;color:var(--dsw-alias-label-secondary)}',
			'.cmq-stat-v{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.cmq-t-on{color:var(--dsw-alias-state-success-primary)}',
			'.cmq-t-off{color:var(--dsw-alias-label-secondary)}',
			'.cmq-t-warn{color:var(--dsw-alias-state-warn-primary)}',
			'.cmq-t-err{color:var(--dsw-alias-state-error-primary)}',
			'.cmq-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
			'.cmq-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}',
			'.cmq-card-t{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;min-width:0}',
			'.cmq-card-a{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
			'.cmq-card-body{padding:11px 13px;display:flex;flex-direction:column;gap:9px}',
			'.cmq-help{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.65}',
			'.cmq-badge{font-size:11px;font-weight:500;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
			'.cmq-b-on{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 42%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}',
			'.cmq-b-warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 46%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}',
			'.cmq-b-err{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 44%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}',
			'.cmq-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}',
			'.cmq-select{box-sizing:border-box;flex:1;min-width:180px;max-width:340px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:20px;padding:5px 9px}',
			'.cmq-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
			'.cmq-btn{box-sizing:border-box;cursor:pointer;padding:5px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:20px;white-space:nowrap;transition:border-color 120ms ease,background 120ms ease}',
			'.cmq-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
			'.cmq-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.cmq-btn:disabled{opacity:.5;cursor:default;border-color:var(--dsw-alias-border-l1)}',
			'.cmq-btn-sm{padding:3px 10px;font-size:11px;line-height:18px}',
			'.cmq-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);font-weight:600}',
			'.cmq-btn-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent);color:var(--dsw-alias-state-error-primary)}',
			'.cmq-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
			'.cmq-seg-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 13px;border:none;border-right:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer}',
			'.cmq-seg-btn:last-child{border-right:none}',
			'.cmq-seg-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
			'.cmq-seg-btn:disabled{opacity:.5;cursor:default}',
			'.cmq-seg-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary)}',
			'.cmq-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;font-size:11px;align-items:baseline}',
			'.cmq-k{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
			'.cmq-v{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary);word-break:break-all}',
			'.cmq-plist{display:flex;flex-direction:column;gap:8px}',
			'.cmq-prow{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}',
			'.cmq-pname{font-size:12px}',
			'.cmq-pwhat{font-size:11px;color:var(--dsw-alias-label-secondary);flex:1;min-width:120px}',
			'.cmq-hdrs{display:flex;flex-direction:column;gap:3px}',
			'.cmq-hdr{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;line-height:1.6}',
			'.cmq-hdr-n{color:var(--dsw-alias-label-primary)}',
			'.cmq-chips{display:flex;gap:5px;flex-wrap:wrap}',
			'.cmq-chip{font-size:10px;padding:1px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}',
			'.cmq-banner{display:flex;align-items:flex-start;gap:9px;padding:9px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;line-height:1.65}',
			'.cmq-banner-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 7%,transparent)}',
			'.cmq-banner-err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}',
			'.cmq-banner-d{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}',
			'.cmq-banner-err .cmq-banner-d{color:var(--dsw-alias-state-error-primary)}',
			'.cmq-x{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;line-height:1;padding:0 2px;flex:none;font-family:inherit}',
			'.cmq-spin{width:12px;height:12px;flex:none;border-radius:50%;border:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent);border-top-color:var(--dsw-alias-brand-primary);animation:cmq-rot .7s linear infinite;box-sizing:border-box;margin-top:2px}',
			'@keyframes cmq-rot{to{transform:rotate(360deg)}}',
			'.cmq-note{font-size:11px;line-height:1.65;padding:8px 10px;border-radius:9px;border:1px dashed color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,transparent);color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent)}',
			'.cmq-empty{padding:18px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}'
		].join('');
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

			/** One patch row's display state, normalized across the three patches. */
			const patchTone = (p) => {
				if (p === null || p === undefined) return { label: t('pUnknown'), cls: '', title: '' };
				if (p.patched === true) return { label: t('pApplied'), cls: 'cmq-b-on', title: p.target || '' };
				if (p.patched === false) return { label: t('pNotApplied'), cls: 'cmq-b-warn', title: p.target || '' };
				// patched === null: either the package is absent (nothing to patch)
				// or this mode cannot inspect it; the error text says which.
				return { label: p.supported === false && p.error ? t('pSkipped') : t('pUnknown'), cls: '', title: p.error || '' };
			};

			function Badge(props) {
				return el('span', { className: 'cmq-badge' + (props.cls ? ' ' + props.cls : ''), title: props.title || '' }, props.children);
			}

			function Banner(props) {
				return el('div', { className: 'cmq-banner ' + (props.tone === 'err' ? 'cmq-banner-err' : 'cmq-banner-ok') },
					props.busy ? el('span', { className: 'cmq-spin' }) : null,
					el('span', { className: 'cmq-banner-d' }, props.text),
					props.onClose ? el('button', { className: 'cmq-x', onClick: props.onClose, title: t('close') }, '\u00d7') : null
				);
			}

			function MaskPanel() {
				const [state, setState] = React.useState({ providers: [], selected: '', busy: false, message: '', error: '', uaPatch: null, variantPatch: null, bodyPatch: null, sentinelTools: [], patchBusy: false, patchMsg: '', patchError: '', queueBusy: false, bodyBusy: false, testing: false });
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
								const vp = res.variantPatch;
								const allAlready = res.uaPatch && res.uaPatch.alreadyPatched === true
									&& (!vp || vp.skipped === true || vp.alreadyPatched === true);
								setState((s) => Object.assign({}, s, {
									patchBusy: false,
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
								const vp = res.variantPatch;
								const allStock = res.uaPatch && res.uaPatch.alreadyStock === true
									&& (!vp || vp.skipped === true || vp.alreadyStock === true);
								setState((s) => Object.assign({}, s, {
									patchBusy: false,
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

				const label = () => {
					const info = state.providers.find((p) => p.id === state.selected);
					return info && info.displayName ? info.displayName : state.selected;
				};

				const toggleBody = (enabled) => {
					if (!state.selected) return;
					setState((s) => Object.assign({}, s, { bodyBusy: true, error: '', message: '' }));
					call({ action: 'body', provider: state.selected, state: enabled ? 'on' : 'off' })
						.then((res) => {
							if (res && res.ok) {
								setState((s) => Object.assign({}, s, {
									bodyBusy: false,
									message: enabled ? t('bodyEnabledMsg', { provider: label() }) : t('bodyDisabledMsg', { provider: label() })
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
								setState((s) => Object.assign({}, s, {
									queueBusy: false,
									message: enabled ? t('queueEnabledMsg', { provider: label() }) : t('queueDisabledMsg', { provider: label() })
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
					setState((s) => Object.assign({}, s, { busy: true, error: '', message: '' }));
					call(preset === 'off' ? { action: 'off', provider: state.selected } : { action: 'on', provider: state.selected, preset: preset })
						.then((res) => {
							if (res && res.ok) {
								setState((s) => Object.assign({}, s, { busy: false, message: preset === 'off' ? t('cleared', { provider: label() }) : t('applied', { provider: label(), preset: t('preset.' + preset) }) }));
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
					setState((s) => Object.assign({}, s, { testing: true, error: '', message: t('runningTest') }));
					call({ action: 'test', provider: state.selected })
						.then((res) => {
							if (res && res.ok) {
								setState((s) => Object.assign({}, s, { testing: false, message: t('testOk', { text: res.firstText || t('noText') }) }));
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
								setState((s) => Object.assign({}, s, { testing: false, error: '', message: t('gatewayFault', { hint: hint || raw }) }));
								return;
							}
							setState((s) => Object.assign({}, s, { testing: false, message: '', error: raw }));
						})
						.catch((err) => {
							setState((s) => Object.assign({}, s, { testing: false, message: '', error: String(err && err.message ? err.message : err) }));
						});
				};

				const info = state.providers.find((p) => p.id === state.selected);
				const anyBusy = state.busy || state.testing || state.bodyBusy || state.queueBusy || state.patchBusy;
				const bodyOn = !!(info && info.bodyMasquerade);
				const queueOn = !!(info && info.queue);
				const bodyPatched = state.bodyPatch === null ? null : state.bodyPatch.patched;

				const header = el('div', { className: 'cmq-head' },
					el('div', { className: 'cmq-head-l' },
						el('div', { className: 'cmq-title' }, t('title')),
						el('div', { className: 'cmq-sub' }, t('subtitle'))
					),
					el('button', { className: 'cmq-btn', onClick: () => refresh(), disabled: anyBusy }, state.busy ? t('refreshing') : t('refresh'))
				);

				if (!state.busy && state.providers.length === 0) {
					return el('div', { className: 'cmq-root' },
						header,
						el('div', { className: 'cmq-empty' }, t('noProviders')),
						state.error ? el(Banner, { tone: 'err', text: state.error, onClose: () => setState((s) => Object.assign({}, s, { error: '' })) }) : null
					);
				}

				// The four-tile strip answers "what is live on this route?" without
				// opening a single card.
				const patchStates = [state.uaPatch, state.bodyPatch, state.variantPatch].filter((p) => p !== null && p !== undefined && p.patched !== null);
				const patchApplied = patchStates.filter((p) => p.patched === true).length;
				const patchSummary = patchStates.length === 0
					? { text: t('dash'), cls: 'cmq-t-off' }
					: (patchApplied === patchStates.length
						? { text: patchApplied + '/' + patchStates.length, cls: 'cmq-t-on' }
						: (patchApplied === 0
							? { text: patchApplied + '/' + patchStates.length, cls: 'cmq-t-warn' }
							: { text: patchApplied + '/' + patchStates.length + ' ' + t('patchMixed'), cls: 'cmq-t-warn' }));

				const stats = el('div', { className: 'cmq-stats' },
					el('div', { className: 'cmq-stat', key: 'd' },
						el('div', { className: 'cmq-stat-l' }, t('statDisguise')),
						el('div', { className: 'cmq-stat-v ' + (info && info.active ? 'cmq-t-on' : 'cmq-t-off') },
							info && info.active ? t('preset.' + info.active) : t('off'))
					),
					el('div', { className: 'cmq-stat', key: 'b' },
						el('div', { className: 'cmq-stat-l' }, t('statBody')),
						el('div', { className: 'cmq-stat-v ' + (bodyOn ? (bodyPatched === false ? 'cmq-t-warn' : 'cmq-t-on') : 'cmq-t-off') }, bodyOn ? t('on') : t('off'))
					),
					el('div', { className: 'cmq-stat', key: 'q' },
						el('div', { className: 'cmq-stat-l' }, t('statQueue')),
						el('div', { className: 'cmq-stat-v ' + (queueOn ? 'cmq-t-on' : 'cmq-t-off') }, queueOn ? t('on') : t('off'))
					),
					el('div', { className: 'cmq-stat', key: 'p' },
						el('div', { className: 'cmq-stat-l' }, t('statPatch')),
						el('div', { className: 'cmq-stat-v ' + patchSummary.cls }, patchSummary.text)
					)
				);

				const routeCard = el('div', { className: 'cmq-card' },
					el('div', { className: 'cmq-card-body' },
						el('div', { className: 'cmq-row' },
							el('span', { className: 'cmq-k' }, t('route')),
							el('select', {
								value: state.selected,
								disabled: anyBusy,
								onChange: (e) => setState((s) => Object.assign({}, s, { selected: e.target.value, message: '', error: '' })),
								className: 'cmq-select'
							}, state.providers.map((p) => el('option', { key: p.id, value: p.id }, p.displayName + ' (' + p.id + ')')))
						)
					)
				);

				const activePreset = info && info.active ? info.active : 'off';
				const presetOptions = [
					{ key: 'claude-code', label: t('preset.claude-code') },
					{ key: 'codex', label: t('preset.codex') },
					{ key: 'off', label: t('off') }
				];
				// `custom` is detected, never selectable: it means headers this plugin
				// did not write, so show it as a badge instead of a phantom segment.
				const identityCard = el('div', { className: 'cmq-card' },
					el('div', { className: 'cmq-card-head' },
						el('div', { className: 'cmq-card-t' },
							t('cardIdentity'),
							info && info.active
								? el(Badge, { cls: info.stale ? 'cmq-b-warn' : 'cmq-b-on' }, t('preset.' + info.active) + (info.stale ? ' \u00b7 ' + t('stale') : ''))
								: el(Badge, {}, t('off'))
						),
						el('div', { className: 'cmq-card-a' },
							el('button', { className: 'cmq-btn cmq-btn-sm', disabled: anyBusy || !state.selected, onClick: () => test() }, state.testing ? t('runningTest') : t('testCall'))
						)
					),
					el('div', { className: 'cmq-card-body' },
						el('div', { className: 'cmq-seg' }, presetOptions.map((o) => el('button', {
							key: o.key,
							className: 'cmq-seg-btn' + (activePreset === o.key ? ' cmq-seg-on' : ''),
							disabled: anyBusy || !state.selected,
							onClick: () => act(o.key)
						}, o.label))),
						el('div', { className: 'cmq-help' }, t('identityHelp')),
						info && info.stale ? el('div', { className: 'cmq-note' }, t('staleNote')) : null
					)
				);

				const sentinel = state.sentinelTools.length > 0 ? state.sentinelTools : [];
				const bodyCard = el('div', { className: 'cmq-card' },
					el('div', { className: 'cmq-card-head' },
						el('div', { className: 'cmq-card-t' },
							t('cardBody'),
							el(Badge, { cls: bodyOn ? (bodyPatched === false ? 'cmq-b-warn' : 'cmq-b-on') : '' }, bodyOn ? t('on') : t('off'))
						),
						el('div', { className: 'cmq-card-a' },
							el('button', {
								className: 'cmq-btn cmq-btn-sm' + (bodyOn ? ' cmq-btn-warn' : ' cmq-btn-primary'),
								disabled: anyBusy || !state.selected,
								onClick: () => toggleBody(!bodyOn)
							}, state.bodyBusy ? t('bodyBusy') : (bodyOn ? t('bodyDisable') : t('bodyEnable')))
						)
					),
					el('div', { className: 'cmq-card-body' },
						el('div', { className: 'cmq-help' }, t('bodyHelp')),
						sentinel.length > 0 ? el('div', { className: 'cmq-kv' },
							el('span', { className: 'cmq-k' }, t('sentinel')),
							el('div', { className: 'cmq-chips' }, sentinel.map((n) => el('span', { className: 'cmq-chip', key: n }, n)))
						) : null,
						sentinel.length > 0 ? el('div', { className: 'cmq-help' }, t('sentinelHelp')) : null,
						// Settings look right but the wire does not change: the one
						// silent-failure case worth shouting about.
						bodyOn && bodyPatched === false ? el('div', { className: 'cmq-note' }, t('bodyNeedsPatch')) : null
					)
				);

				const policy = info && info.registrationRetryPolicy && !info.registrationRetryPolicy.error
					? info.registrationRetryPolicy
					: (info && info.retryPolicy ? info.retryPolicy : null);
				const live = info && info.registrationRetryPolicy && !info.registrationRetryPolicy.error;
				const num = (v) => (typeof v === 'number' ? String(v) : t('dash'));
				const queueCard = el('div', { className: 'cmq-card' },
					el('div', { className: 'cmq-card-head' },
						el('div', { className: 'cmq-card-t' },
							t('cardQueue'),
							el(Badge, { cls: queueOn ? 'cmq-b-on' : '' }, queueOn ? t('on') : t('off'))
						),
						el('div', { className: 'cmq-card-a' },
							el('button', {
								className: 'cmq-btn cmq-btn-sm' + (queueOn ? ' cmq-btn-warn' : ' cmq-btn-primary'),
								disabled: anyBusy || !state.selected,
								onClick: () => toggleQueue(!queueOn)
							}, state.queueBusy ? t('queueBusy') : (queueOn ? t('queueDisable') : t('queueEnable')))
						)
					),
					el('div', { className: 'cmq-card-body' },
						el('div', { className: 'cmq-help' }, t('queueHelp')),
						policy === null
							? el('div', { className: 'cmq-help' }, t('queueNoPolicy'))
							: el('div', { className: 'cmq-kv' },
								el('span', { className: 'cmq-k', key: 'k1' }, t('kMode')),
								el('span', { className: 'cmq-v', key: 'v1' }, policy.mode || t('dash')),
								el('span', { className: 'cmq-k', key: 'k2' }, t('kRetries')),
								el('span', { className: 'cmq-v', key: 'v2' }, num(policy.maxRetries)),
								...(typeof policy.initialDelayMs === 'number' ? [
									el('span', { className: 'cmq-k', key: 'k3' }, t('kInitial')),
									el('span', { className: 'cmq-v', key: 'v3' }, policy.initialDelayMs + 'ms')
								] : []),
								el('span', { className: 'cmq-k', key: 'k4' }, t('kMaxDelay')),
								el('span', { className: 'cmq-v', key: 'v4' }, typeof policy.maxDelayMs === 'number' ? policy.maxDelayMs + 'ms' : t('dash')),
								el('span', { className: 'cmq-k', key: 'k5' }, t('kCodes')),
								el('span', { className: 'cmq-v', key: 'v5' }, Array.isArray(policy.retryableCodes) && policy.retryableCodes.length > 0 ? policy.retryableCodes.join(' ') : t('dash')),
								el('span', { className: 'cmq-k', key: 'k6' }, t('kLive')),
								el('span', { className: 'cmq-v ' + (live ? 'cmq-t-on' : 'cmq-t-warn'), key: 'v6' }, live ? t('liveYes') : t('liveNo'))
							)
					)
				);

				const patchRows = [
					{ key: 'ua', name: t('patchUa'), what: t('patchUaWhat'), st: state.uaPatch },
					{ key: 'body', name: t('patchBody'), what: t('patchBodyWhat'), st: state.bodyPatch },
					{ key: 'variant', name: t('patchVariant'), what: t('patchVariantWhat'), st: state.variantPatch }
				];
				const uaSupported = state.uaPatch !== null && state.uaPatch.supported === true;
				const patchesCard = el('div', { className: 'cmq-card' },
					el('div', { className: 'cmq-card-head' },
						el('div', { className: 'cmq-card-t' },
							t('cardPatches'),
							el(Badge, { cls: patchSummary.cls === 'cmq-t-on' ? 'cmq-b-on' : (patchSummary.cls === 'cmq-t-warn' ? 'cmq-b-warn' : '') }, patchSummary.text)
						),
						uaSupported ? el('div', { className: 'cmq-card-a' },
							el('button', { className: 'cmq-btn cmq-btn-sm cmq-btn-primary', disabled: state.patchBusy || anyBusy, onClick: () => applyPatch() }, state.patchBusy ? t('patchApplying') : t('patchesApplyAll')),
							el('button', { className: 'cmq-btn cmq-btn-sm cmq-btn-warn', disabled: state.patchBusy || anyBusy, onClick: () => unpatch() }, state.patchBusy ? t('patchReverting') : t('patchesRevertAll'))
						) : null
					),
					el('div', { className: 'cmq-card-body' },
						el('div', { className: 'cmq-plist' }, patchRows.map((r) => {
							const tone = patchTone(r.st);
							return el('div', { className: 'cmq-prow', key: r.key },
								el('span', { className: 'cmq-pname' }, r.name),
								el(Badge, { cls: tone.cls, title: tone.title }, tone.label),
								el('span', { className: 'cmq-pwhat' }, r.what)
							);
						})),
						uaSupported
							? el('div', { className: 'cmq-help' }, t('restartHint'))
							: el('div', { className: 'cmq-note' }, t('uaUnsupported'))
					)
				);

				const headers = info && Array.isArray(info.headers) ? info.headers : [];
				const headersCard = el('details', { className: 'cmq-card' },
					el('summary', { className: 'cmq-card-head', style: { cursor: 'pointer' } },
						el('div', { className: 'cmq-card-t' },
							t('cardHeaders'),
							el(Badge, {}, headers.length > 0 ? t('headersCount', { n: headers.length }) : t('dash'))
						)
					),
					el('div', { className: 'cmq-card-body' },
						headers.length > 0
							? el('div', { className: 'cmq-hdrs' }, headers.map((h) => el('div', { className: 'cmq-hdr', key: h.name },
								el('span', { className: 'cmq-hdr-n' }, h.name + ': '), h.value)))
							: el('div', { className: 'cmq-help' }, t('noHeaders'))
					)
				);

				return el('div', { className: 'cmq-root' },
					header,
					stats,
					routeCard,
					identityCard,
					bodyCard,
					queueCard,
					patchesCard,
					headersCard,
					state.patchMsg ? el(Banner, { key: 'pm', tone: 'ok', text: state.patchMsg, onClose: () => setState((s) => Object.assign({}, s, { patchMsg: '' })) }) : null,
					state.patchError ? el(Banner, { key: 'pe', tone: 'err', text: state.patchError, onClose: () => setState((s) => Object.assign({}, s, { patchError: '' })) }) : null,
					state.message ? el(Banner, { key: 'msg', tone: 'ok', busy: state.testing, text: state.message, onClose: state.testing ? null : () => setState((s) => Object.assign({}, s, { message: '' })) }) : null,
					state.error ? el(Banner, { key: 'err', tone: 'err', text: state.error, onClose: () => setState((s) => Object.assign({}, s, { error: '' })) }) : null
				);
			}

			// Installed (static) mode has no dynamic run card, so only the
			// settings page is registered (tool.view.cordis stays dynamic-only).
			slots.inject('settings.section', () => slots.register(
				{ name: 'settings.section', id: 'client-masquerade', order: 40, label: () => t('title') },
				() => el('div', { style: { maxWidth: '720px' } }, el(MaskPanel))
			));
		}

		exports.name = NAME;
		exports.apply = apply;
		return module.exports;
	}
});
