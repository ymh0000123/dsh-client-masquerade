# dsh-client-masquerade

**DeepSeek Harness 插件：让自定义模型伪装成 Claude Code / Codex 客户端**
**A DeepSeek Harness plugin: make a custom model masquerade as a Claude Code / Codex client.**

一些网关（如 agentrouter、claude-code-router 类代理）按请求头识别客户端并据此路由或放行。本插件把伪造的客户端身份头写入你的 `llm-pi-ai` provider 配置，随每次请求真实发到上游网关——一键开启/关闭/切换，带中英文设置页。

---

## 安装 / Install

### 方式一：官方命令安装（推荐）

```bash
dsh plugin --profile web add github:ymh0000123/dsh-client-masquerade
```

这条命令会在 profile 目录里执行 `pnpm add github:ymh0000123/dsh-client-masquerade`，然后自动把包（其 `dsh.bundle.patch` 声明）并入该 profile 的插件层栈——**不需要手动改任何配置文件**。

**然后应用 User-Agent 补丁（必做）**——否则伪装头里的 `user-agent` 会被 pi-ai 适配器的归属机制剥掉并覆盖为 `deepseek-harness/...`，按 User-Agent 识别客户端的网关（agentrouter、claude-code-router 类）会拒绝请求（**401 UNAUTHENTICATED**）。在你的 profile 目录（含 `node_modules` 的那个）执行：

```bash
node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs
```

> 注意：`node_modules` 是相对路径，请先在 profile 目录（含 `node_modules` 的那个）里执行。不记得目录或不在该目录时，直接用**绝对路径**调用脚本即可，脚本会自动定位本 profile 里安装的 `dsh-llm-pi-ai`：
>
> ```bash
> node "C:\Users\你的用户名\.dsh\profiles\web\node_modules\dsh-client-masquerade\patches\apply-pi-ai-useragent-patch.mjs"
> ```

补丁幂等，可重复执行；`pnpm install` 或升级 `dsh-llm-pi-ai` 后需重新应用一次。插件启动时也会自检：未打补丁会在日志打醒目的 `[client-masquerade] dsh-llm-pi-ai is NOT user-agent patched` 警告。

> 安装模式下也可以直接在网页设置页（Settings → Client Masquerade → **User-Agent 补丁 → 应用**）一键写入补丁，之后重启 `dsh web` 生效；动态模式无文件系统权限，仍需手动执行上面的命令。

之后重启：

```bash
dsh web
```

安装后：

- **Host 侧**：`mask_client` 模型工具自动注册；设置写入逻辑挂载。
- **Web 侧**：`dsh.client` 浏览器清单自动收录，Settings 里出现 **Client Masquerade / 客户端伪装** 设置页。

卸载：`dsh plugin --profile web remove dsh-client-masquerade`。插件可自由安装/卸载、重复安装无副作用；卸载后有两处残留需手动清理（见下）。

### 安装 / 卸载 / 清理速查

| 操作 | 命令 / 位置 |
| --- | --- |
| 安装 | `dsh plugin --profile web add github:ymh0000123/dsh-client-masquerade` |
| 卸载 | `dsh plugin --profile web remove dsh-client-masquerade` |
| 补丁应用 | 设置页 **User-Agent 补丁 → 应用**，或 `node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs`（重启 `dsh web` 生效） |
| 补丁还原 | 设置页 **User-Agent 补丁 → 还原**，或 `node .../apply-pi-ai-useragent-patch.mjs --revert`（重启 `dsh web` 生效） |
| 清除伪装头 | 设置页点 **Off**，或 `mask_client action=off provider=<id>`（可留空 `headers` 字段） |

> **卸载后残留说明**：① User-Agent 补丁是改在 `dsh-llm-pi-ai` 适配器文件上的，**卸载插件不会自动还原**——不用伪装了就用 `--revert` 还原（不动也无害，仅当 provider 显式配置 `user-agent` 时才影响线路）；② 已写入 provider 的伪装 `headers` 会保留在设置文档里，需要逐个执行 `off` 或手动清除。

> 注：若之前用「动态插件」方式运行过同一份代码，请先停用/删除动态版本，避免设置页入口重复注册。

### 方式二：动态插件（无需重启、进程级）

1. 创建动态插件（`cordis_define`），或直接在运行界面粘贴代码；
2. **code.host** ← 粘贴 [`host.body.js`](host.body.js) 全文（`exports["./host.body"]` 可编程读取）；
3. **code.client** ← 粘贴 [`client.body.js`](client.body.js) 全文；
4. 运行插件并批准。

两种方式功能等价（伪装开关、`mask_client`、设置页、测试调用），区别：方式一随 profile 持久安装，方式二为进程级临时加载。安装模式下设置页走 `webServer` HTTP 路由（`/dsh-client-masquerade/api`），动态模式下走包私有 RPC。

> 动态模式同样需要 pi-ai 补丁：在 profile 目录执行 `node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs`（或手动应用 `patches/` 里的改动）并重启，否则 `user-agent` 伪装无法上线。

前提：先在 **Settings → Models** 配置好你的自定义 provider（`llm-pi-ai` 路由），插件才能列出并写入。

## 它能做什么 / What it does

- 为任意已配置的 `llm-pi-ai` provider 一键应用/清除/切换伪装：**Claude Code**、**Codex**、或自定义请求头。
- 伪装头写入 provider 配置的 `headers` 字段（`settings.yaml` 中 `llm-pi-ai.providers.<id>.headers`），由 pi-ai 适配器在**每次请求**（Anthropic Messages 与 OpenAI 兼容协议均覆盖）原样发送。
- 三个入口：**设置页**（Settings → Client Masquerade）、**模型工具 `mask_client`**（list / on / off / test）、动态模式下另有 Run 卡片面板。
- 界面中英双语，跟随 Harness 语言设置实时切换。
- `test` 动作会真实发起一次最小流式调用，报告网关实际收到的请求头与模型回复/报错。

## 工作原理 / How it works

pi-ai 适配器（`dsh-llm-pi-ai`）的 provider 配置原生支持 `headers` 字典，并会在线路上发送它们。归属标头 `user-agent` 默认保留为 `deepseek-harness/...`，但配合适配器补丁（见 `patches/`）后，**profile 里显式配置的 `user-agent` 会原样发到线上**；未配置时仍回落到归属 User-Agent。预设因此同时写入网关真正识别的身份头与 User-Agent：

| 预设 | 写入的请求头 |
| --- | --- |
| `claude-code` | `user-agent: claude-cli/2.1.241 (external, cli)`、`anthropic-client: claude-code/2.1.241`、`anthropic-version`、`anthropic-beta`（含 `context-1m-2025-08-07` 等完整列表）、`anthropic-dangerous-direct-browser-access`、`x-app: cli`、`x-stainless-*` 系列 |
| `codex` | `user-agent: codex-tui/0.145.0 (...)`、`openai-client: codex/0.48.0`、`x-stainless-*` 系列 |
| `custom` | 任意（通过 `headersJson` 传入） |

> `claude-code` 预设的取值来自**实测抓包**：用本地反代把真实 `claude-cli 2.1.241` 的请求拦下来，逐个头比对后写入。网关普遍按 `claude-cli` 版本号放行，所以升级插件后建议**重新点一次 Claude Code** 让预设刷新（设置页会把旧预设标为「预设已过期」）。
> 按设计**不伪装** `x-claude-code-session-id`：它是每会话随机 UUID，写成固定值反而是更糟的指纹。

> 为什么需要补丁：原生 `dsh-llm-pi-ai` 会把 profile 的 `user-agent` 剥离并强制覆盖为 `deepseek-harness/...`，导致按 User-Agent 识别客户端的网关（如 agentrouter）拒绝请求（401 UNAUTHENTICATED）。`patches/apply-pi-ai-useragent-patch.mjs` 会把安装目录里 `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` 的 `requestHeaders` 改为：显式配置的 profile `user-agent` 优先上线，未配置时回落归属 User-Agent。重装/升级 `dsh-llm-pi-ai` 后需重新应用。

## 排错：分清「伪装没生效」和「网关自己不行」

这是本插件最容易被误判的一点。中转网关（new-api / one-api 系，anyrouter、agentrouter 等）在**上游渠道耗尽**时，会对**真实的 Claude Code CLI 也返回同样的错误**——此时无论怎么调请求头都不会好转。

`mask_client action=test` 会自动重试瞬时错误，并给出 `classification` 与 `disguiseImplicated` 两个字段，直接告诉你该往哪修：

| classification | disguiseImplicated | 含义与处置 |
| --- | --- | --- |
| `auth` (401/403) | `true` | 凭证或客户端身份被拒：检查 Key；确认 pi-ai 补丁已应用并重启 |
| `policy-gate` (400 + `请启用 1m 上下文`) | `true` | 缺 beta 声明头：重新应用新版 `claude-code` 预设（已内置完整 `anthropic-beta`） |
| `shape-validation` | `true` | 网关校验请求体结构：仅靠请求头无法满足，超出本插件范围 |
| `no-upstream-channel` / `upstream-saturated`（503、或 429 + `Service Unavailable`、`get_channel_failed`、`负载已经达到上限`） | **`false`** | **与伪装无关**：网关当前没有可用上游渠道。稍后重试、换模型或换线路 |

> 交叉验证的可靠办法：把**同一个 Key** 填进 Claude Code（`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`）跑一次。如果 Claude Code 同样报错，问题在网关侧，不在伪装。注意这类中转站常给不同 Key 分配不同渠道分组，**Claude Code 里能用的那个 Key，未必等于 DSH 里配置的那个**——先确认两边用的是同一个 Key。

## 使用 / Usage

**设置页**：选择 provider → 点 **Claude Code / Codex / Off**，或 **Test call** 验证伪装是否生效。

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
- `test` 通过 `ctx.llm.stream` 真实调用该路由（默认用 provider 的第一个模型，可用 `model=` 指定），返回 `effectiveWireHeaders`（线上实际收到的头）、模型首段输出或网关报错；瞬时 429/5xx 会自动重试若干次，并附上 `classification` / `disguiseImplicated`（见上一节）。

## 仓库结构 / Repository layout

| 文件 | 用途 |
| --- | --- |
| `index.js` | 安装模式 Host 插件（cordis 主入口：`name` + `apply`） |
| `client.js` | 安装模式 Web 客户端 bundle（`__ModuleLoader__` 格式，设置页） |
| `cordis.patch.yml` | bundle patch：`dsh plugin add` 后自动挂载的插件行 |
| `host.body.js` / `client.body.js` | 动态插件模式的 paste-ready 代码体 |
| `plugin.js` | 动态代码体编程加载器（剥离注释头） |

## 限制 / Limitations

- 仅作用于 **`llm-pi-ai` 自定义 provider**；内置 `deepseek-official` 适配器没有请求头钩子，无法用此方式伪装。
- 预设现在包含 `user-agent`；未打 `patches/` 补丁时，`user-agent` 仍会被归属机制覆盖（其余身份头不受影响）。此时 `test` 会额外返回 `warning`，明确告知伪装 UA 实际没有上线。
- 伪装头会真实写入设置文档并持久化；停用插件不会自动撤销，需要执行 `off` 或清除 provider 的 `headers` 字段。
- **只做请求头级伪装**。若网关校验请求体结构（system prompt 身份块、`metadata.user_id`、工具列表等），仅靠本插件不足以通过。
- **不能修复网关侧问题**。上游渠道耗尽、限流、欠费等状态对真实 Claude Code 同样报错；`disguiseImplicated: false` 即为此类，改请求头无用。

## License

[MIT](LICENSE)
