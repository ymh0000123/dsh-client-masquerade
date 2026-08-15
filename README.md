# dsh-client-masquerade

**DeepSeek Harness 动态插件：让自定义模型伪装成 Claude Code / Codex 客户端**
**A DeepSeek Harness dynamic plugin: make a custom model masquerade as a Claude Code / Codex client.**

一些网关（如 agentrouter、claude-code-router 类代理）按请求头识别客户端并据此路由或放行。本插件把伪造的客户端身份头写入你的 `llm-pi-ai` provider 配置，随每次请求真实发到上游网关——一键开启/关闭/切换，带中英文设置页。

---

## 它能做什么 / What it does

- 为任意已配置的 `llm-pi-ai` provider 一键应用/清除/切换伪装：**Claude Code**、**Codex**、或自定义请求头。
- 伪装头写入 provider 配置的 `headers` 字段（`settings.yaml` 中 `llm-pi-ai.providers.<id>.headers`），由 pi-ai 适配器在**每次请求**（Anthropic Messages 与 OpenAI 兼容协议均覆盖）原样发送。
- 三个入口：**设置页**（Settings → Client Masquerade）、**Run 卡片面板**、**模型工具 `mask_client`**（list / on / off / test）。
- 界面中英双语，跟随 Harness 语言设置实时切换。
- `test` 动作会真实发起一次最小流式调用，报告网关实际收到的请求头与模型回复/报错。

## 工作原理 / How it works

pi-ai 适配器（`dsh-llm-pi-ai`）的 provider 配置原生支持 `headers` 字典，并会在线路上发送它们；唯一例外是**归属标头 `user-agent`**：DSH 强制保留为 `deepseek-harness/...`，profile 里配置的 `user-agent` 会被适配器剥离并覆盖（这是设计约束，插件无法绕过）。因此预设使用网关真正识别的非保留身份头：

| 预设 | 写入的请求头 |
| --- | --- |
| `claude-code` | `anthropic-client: claude-code/2.0.0`、`x-app: claude-code` |
| `codex` | `openai-client: codex/0.48.0`、`x-stainless-package-version/os/arch/runtime/runtime-version` |
| `custom` | 任意（通过 `headersJson` 传入） |

> 若你的网关按 `user-agent` 识别客户端，该头无法被覆盖——这是 DeepSeek Harness 归属机制的设计约束。

## 安装 / Install

插件以「动态插件（Dynamic Cordis Plugin）」方式运行，无需改 profile 配置：

1. 在对话中创建动态插件（`cordis_define`），或直接在运行界面粘贴代码；
2. **code.host** ← 粘贴 [`host.body.js`](host.body.js) 全文；
3. **code.client** ← 粘贴 [`client.body.js`](client.body.js) 全文；
4. 运行插件并批准。完成。

也可以通过 [`plugin.js`](plugin.js) 以编程方式加载两个代码体（它会剥离文件头的注释块）。

前提：先在 **Settings → Models** 配置好你的自定义 provider（`llm-pi-ai` 路由），插件才能列出并写入。

## 使用 / Usage

**设置页 / Run 卡片**：选择 provider → 点 **Claude Code / Codex / Off**，或 **Test call** 验证伪装是否生效。

**模型工具 `mask_client`**：

```text
mask_client action=list
mask_client action=on provider=agen-openai preset=codex
mask_client action=on provider=agen-openai preset=custom headersJson={"originator":"codex-tui"}
mask_client action=off provider=agen-openai
mask_client action=test provider=agen-openai
```

- `on` 采用合并语义：保留你原有的其他请求头，仅覆盖预设拥有的键；`headersJson` 可追加/覆盖任意头。
- `off` 只删除预设拥有的键，你手工配置的头会保留。
- `test` 通过 `ctx.llm.stream` 真实调用该路由（默认用 provider 的第一个模型，可用 `model=` 指定），返回 `effectiveWireHeaders`（线上实际收到的头）、模型首段输出或网关报错。

## 限制 / Limitations

- 仅作用于 **`llm-pi-ai` 自定义 provider**；内置 `deepseek-official` 适配器没有请求头钩子，无法用此方式伪装。
- `user-agent` 不可覆盖（见上文）。
- 伪装头会真实写入设置文档并持久化；停用插件不会自动撤销，需要执行 `off` 或清除 provider 的 `headers` 字段。
- 动态插件为进程级：重启后需重新加载（本仓库就是用来快速重新加载的）。

## License

[MIT](LICENSE)
