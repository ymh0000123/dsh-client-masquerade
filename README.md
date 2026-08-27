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

**然后应用补丁（必做）**——否则伪装头里的 `user-agent` 会被 pi-ai 适配器的归属机制剥掉并覆盖为 `deepseek-harness/...`，按 User-Agent 识别客户端的网关（agentrouter、claude-code-router 类）会拒绝请求（**401 UNAUTHENTICATED**）。最省事的方式是在设置页点 **User-Agent 补丁 → 应用**（一次写入全部三个补丁），或用模型工具：

```text
mask_client action=patch
```

也可以在你的 profile 目录（含 `node_modules` 的那个）逐个执行：

```bash
node node_modules/dsh-client-masquerade/patches/apply-pi-ai-useragent-patch.mjs   # user-agent
node node_modules/dsh-client-masquerade/patches/apply-pi-ai-body-patch.mjs        # 请求体（按请求体识别的网关需要）
node node_modules/dsh-client-masquerade/patches/apply-variant-retry-patch.mjs     # vision-toolkit 变体
```

> 注意：`node_modules` 是相对路径，请先在 profile 目录（含 `node_modules` 的那个）里执行。不记得目录或不在该目录时，直接用**绝对路径**调用脚本即可，脚本会自动定位本 profile 里安装的目标包：
>
> ```bash
> node "C:\Users\你的用户名\.dsh\profiles\web\node_modules\dsh-client-masquerade\patches\apply-pi-ai-useragent-patch.mjs"
> ```

补丁幂等，可重复执行；`pnpm install` 或升级被打补丁的包后需重新应用一次。插件启动时也会自检：未打 UA 补丁会在日志打醒目的 `[client-masquerade] dsh-llm-pi-ai is NOT user-agent patched` 警告；若某条线路开了请求体伪装而请求体补丁没生效，也会单独警告——这个组合的失败表现和"网关繁忙"一模一样，不警告很难发现。

> 兼容旧版：若 `dsh-llm-pi-ai` 的补丁是**旧版插件**（<1.2.0）写入的（requestHeaders 块是另一种等价写法），`还原` 也能正确识别并还原为原始版本；`应用` 会把它升级为当前版本的补丁形态。不再出现 "neither the stock nor the patched requestHeaders block found"。

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
| 补丁应用（全部三个） | 设置页 **User-Agent 补丁 → 应用**，或 `mask_client action=patch`（重启 `dsh web` 生效） |
| 补丁还原（全部三个） | 设置页 **User-Agent 补丁 → 还原**，或 `mask_client action=unpatch`（重启 `dsh web` 生效） |
| 单独应用请求体补丁 | `node node_modules/dsh-client-masquerade/patches/apply-pi-ai-body-patch.mjs`（`--revert` 还原） |
| 清除伪装头 | 设置页点 **Off**，或 `mask_client action=off provider=<id>`（连同请求体伪装开关一并清除） |

一共三个补丁，都是改已安装的第三方包，都需要重启 `dsh web` 生效，都幂等：

| 补丁 | 目标文件 | 作用 | 不打会怎样 |
| --- | --- | --- | --- |
| User-Agent | `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | 让 profile 显式配置的 `user-agent` 原样上线 | 按 UA 识别的网关回 401 |
| 请求体 | `@earendil-works/pi-ai/dist/api/anthropic-messages.js` | 按需注入 Claude Code 的请求体指纹 | 按请求体识别的网关回 429/503（**看起来像排队**） |
| Vision-toolkit 变体 | `@anionex/dsh-vision-toolkit/lib/image-input-variants.js` | `vision-toolkit-*` 包装路由继承上游重试策略 | 排队策略到不了 agent 实际走的路由 |

> **卸载后残留说明**：① 三个补丁都是改在别的包的文件上，**卸载插件不会自动还原**——不用了就 `mask_client action=unpatch`（不动也基本无害：UA 补丁仅在 provider 显式配 `user-agent` 时生效，请求体补丁在没有开关头时完全惰性）；② 已写入 provider 的伪装 `headers` 会保留在设置文档里，需要逐个执行 `off` 或手动清除。

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
- **请求体伪装**：按需给 Anthropic 协议的请求体注入 Claude Code 的指纹（`metadata.user_id`、身份 system 块、哨兵工具定义），过 anyrouter 系网关的客户端校验——**这是仅靠请求头过不去的那一关**。
- 三个入口：**设置页**（Settings → Client Masquerade）、**模型工具 `mask_client`**（list / on / off / test / body / queue）、动态模式下另有 Run 卡片面板。
- 界面中英双语，跟随 Harness 语言设置实时切换。
- `test` 动作会真实发起一次最小流式调用，报告网关实际收到的请求头与模型回复/报错，并按该路线的伪装状态给出可执行的判断。

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

这是本插件最容易被误判的一点，而且**误判的方向和直觉相反**。

中转网关（new-api / one-api 系，anyrouter、agentrouter 等）在拒绝请求时，很多情况下只回一个裸的 **429/503 `Service Unavailable`**。这一个状态码同时对应两种完全不同的原因：

1. **上游渠道真的全忙** —— 等一等就好，重试有意义；
2. **网关的 Claude Code 校验拒绝了你的请求体** —— 重试一万次也不会好。

两者在状态码和响应体上**完全一样**。早期版本把它一律判成「排队」，于是建议「配 15 次重试、等 7-8 分钟」——对第 2 种情况，这只是把失败拖长。

`mask_client action=test` 现在按**该路线自身的状态**来区分，给出 `classification` 与 `disguiseImplicated`：

| classification | 触发条件 | 含义与处置 |
| --- | --- | --- |
| `auth` (401/403) | — | 凭证或客户端身份被拒：检查 Key；确认 pi-ai user-agent 补丁已应用并重启 |
| `policy-gate` (400 + `请启用 1m 上下文`) | — | 缺 beta 声明头：重新应用新版 `claude-code` 预设（已内置完整 `anthropic-beta`） |
| `body-fingerprint` (429/503) | **未开请求体伪装** | 网关可能在按请求体识别客户端——仅靠请求头满足不了。开启**请求体伪装**（见下节）后再判断 |
| `body-fingerprint` (429/503) | 已开伪装但**补丁未生效** | 开关写进了设置，但执行注入的补丁没加载，请求体仍是 DSH 的形状。`mask_client action=patch` 后重启 |
| `queued` (429/503) | 伪装**已生效**仍失败 | 此时才是渠道池真忙（真实 Claude Code CLI 同样会被拒）。开启**排队适配**让 agent 等得起 |

> 交叉验证的可靠办法：把**同一个 Key** 填进 Claude Code（`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`）跑一次。**注意这个验证只能证伪不能证实**：Claude Code 能用、DSH 不能用，恰恰是请求体指纹校验的典型表现（真实 CLI 的请求体天然合格），并不说明 Key 有问题。

## 请求体指纹：anyrouter 系网关真正在校验什么

anyrouter 这类网关**不看请求头，看请求体**。下面每一条都是拿真实 `claude-cli 2.1.241` 的原始请求做消融实验测出来的——先逐字节重放拿到 200，再逐项删改：

| 改动 | 结果 |
| --- | --- |
| 逐字节重放真实请求 | **200** |
| 删掉 `metadata` | 503 |
| `metadata.user_id` 改成普通字符串（非 JSON） | 503 |
| `session_id` 为空 / 非 UUID 格式（`dsh-session-…`、无连字符的 32hex） | 503 |
| 删掉 system 里的客户端身份块 | 503 |
| 把哨兵工具改名 | 429 |
| 27 个自造工具、体量拉到 104KB | 429 |
| 16 个冷门真实工具（不含 Glob/Grep/Read） | 429 |
| **只留 Glob + Grep + Read** | **200** |
| 在此基础上追加 DSH 自己的工具 / 改工具顺序 / 缩短 messages / 追加 system 文本 | **200** |

三个条件缺一不可：

1. `metadata.user_id` 是 JSON 字符串，`device_id` 非空（值不校验）、`session_id` **必须是 UUID 格式**；
2. `system` 含客户端身份块；
3. `tools` 含 **Glob / Grep / Read** 这三个工具名。

> 工具**描述**不参与校验（换成等长填充仍返回 200），所以 Claude Code 改文案不会让伪装失效；只有它**改名或删掉**这三个工具才需要重新抓取指纹。指纹数据在 `patches/claude-code-fingerprint.js`。

### 开启请求体伪装

```text
mask_client action=body provider=anyrouter state=on     # 开启
mask_client action=patch                                # 应用补丁（含请求体补丁）
# 重启 dsh web
mask_client action=body provider=anyrouter state=off    # 关闭
```

设置页也有 **请求体伪装** 开关。开关写入 provider 的 `x-dsh-body-masquerade: claude-code:<deviceId>` 头——这是**内部标记**，打了补丁的 pi-ai 会在发送前把它剥掉，不会上线。`deviceId` 在开启时生成一次并存进设置，让网关看到一个稳定的设备。

**代价**：三个哨兵工具会**告知模型但 DSH 并未实现**。少于三个过不了校验，换成冷门工具（CronCreate 之类）同样过不了，所以这是最小可行集。

注入时它们的**描述会被替换成「不可用，请勿调用」**——因为实测网关只校验工具**名字**，描述可以自由改写。这一点很关键：若按抓包原样注入描述，模型会把它们当成真能力去调用，而 DSH 没有实现、返回不了结果，于是模型明明已经回复完、界面却一直显示「工作中」。改写描述后模型不再调用（已实测对照），网关照样放行。

> 若某天网关开始校验描述，`test/body-fingerprint-probe.mjs` 会报出来：它的 “sentinel descriptions wiped” 那一项会从 200 变成 429。

补丁本身是**惰性**的：只有配了开关头的 provider 才会被注入，其余路线完全不受影响。

## 排队适配（渠道真的忙时）

确认请求体伪装已生效、仍然 429/503，才轮到排队适配。这类网关**不直接拒绝，而是排队**：上游渠道全忙时对每个请求都回 429/503，真实 Claude Code 靠带退避重试数分钟挺过去。

DSH 侧已内置 `dsh-llm-retry` 插件：它在 agent 请求失败时按 **provider 的 `retryPolicy`** 决定是否重试。默认策略只重试 5 次、退避到 10s（总窗口约 30s），远不够排一个长队。本插件新增 `queue` 动作，把 provider 的 `retryPolicy` 改成排队策略：

```text
mask_client action=queue provider=anyrouter state=on            # 开启排队适配
mask_client action=queue provider=anyrouter state=on retries=15 maxdelay=60000   # 自定义
mask_client action=queue provider=anyrouter state=off           # 关闭，回落到默认策略
```

- 默认策略：`maxRetries=10`、退避 1s→30s（指数 + 抖动）、可重试码覆盖 `RATE_LIMIT`（429）与 `SERVER`（5xx）等，累计等待约 2-3 分钟——足以排过典型的长队，又不至于让真正死掉的线路挂住不报错。
- `list` 会显示每个 provider 的排队状态（`queue: true/false` + 策略摘要）以及 **`registrationRetryPolicy`**——这是 **agent 循环实际执行**的策略（llm 注册表里捕获、经 `prepareCall` 交给 `agent/request-error` 由 `dsh-llm-retry` 消费）。它跟着 settings 变更**实时**更新（pi-ai 在 onChange 时重新注册路由），所以看到 `registrationRetryPolicy.maxRetries == 10 / maxDelayMs == 30000` 即证明排队机制已生效，无需猜测。
- 设置页也有 **排队适配** 开关。
- `test` 动作同样会**带退避骑队列**（最多约 2-3 分钟，可被调用方中断），而不是试两三次就报失败；最终仍失败时，若该路线的请求体伪装已生效，返回 `classification: queued`、`disguiseImplicated: false`；否则返回 `classification: body-fingerprint`，提示先去过请求体那一关。

> ⚠️ **先过请求体校验，再谈排队。** 若网关是按请求体识别客户端的（anyrouter 系），没开请求体伪装时无论配多少次重试都不会成功——重试只会把失败拖长。判断顺序：`test` 的 `classification` 说 `body-fingerprint` 就先开请求体伪装，说 `queued` 才是该调排队策略。

> 验证"排队机制是否真的在跑"：
> 1. `mask_client action=list provider=anyrouter` → 确认 `queue: true` 且 `registrationRetryPolicy` 与 `retryPolicy` 一致（maxRetries=10、maxDelayMs=30000）。一致即代表 agent 循环会用排队策略。
> 2. `mask_client action=test provider=anyrouter` → 观察 `attempts`（会到 10）与 `classification: queued`，说明测试在带退避骑队列。
> 3. 用 anyrouter 作为模型发一条真实消息：失败时会看到 agent 带退避重试约 2-3 分钟（会话里会出现 `llm/retry` 事件，policyKey 含 maxRetries=10 / maxDelayMs=30000），而不是 30 秒就放弃。
>
> 若第 1 步显示 `registrationRetryPolicy` 与 settings 不一致（例如仍是 maxRetries=5 / maxDelayMs=10000 的默认值），说明运行中的进程还没完成注册更新——重启 `dsh web` 后必然一致（策略写入 settings 后实时传播；插件代码升级本身也需要重启加载）。
>
> 注意：策略写入的是设置文档，pi-ai 适配器每次请求都会重新读取 profile，因此**无需重启**即可对下一次 agent 请求生效（插件本体升级仍需重启 `dsh web`）。

### ⚠️ 重要：agent 实际用的路由可能是 vision-toolkit 变体

排查"还是只重试 5 次"时发现一个隐蔽坑：**你的 agent 默认模型**（`settings.yaml` 的 `agent-default-model`）可能指向 **`vision-toolkit-anyrouter`** 而不是 `anyrouter`。`@anionex/dsh-vision-toolkit` 会给每个纯文本上游路由注册一个 `vision-toolkit-<上游>` **包装变体**（为了支持粘贴图片），你的消息走的是这个包装路由。

而 vision-toolkit 的包装适配器**没有实现 `providerRetryPolicy`**（它自己的注释说"上游路由拥有重试"，但漏了转发），所以 `vision-toolkit-anyrouter` 的注册策略永远是**默认 5 次**——无论上游 `anyrouter` 配了什么排队策略，都到不了它头上。

本插件 1.5.0 解决了这个问题：

1. **转发补丁**（`patches/`）：给已安装的 `dsh-vision-toolkit/lib/image-input-variants.js` 加上 `providerRetryPolicy()` 转发方法，让包装路由**继承上游的排队策略**。用 `mask_client action=patch`（或设置页的补丁按钮）一并写入，也可手动执行：
   ```bash
   node node_modules/dsh-client-masquerade/patches/apply-variant-retry-patch.mjs
   ```
   然后重启 `dsh web`。补丁状态在插件启动时自检，并显示在设置页与 `list` 输出里。
2. **`queue` 动作支持变体路由**：`mask_client action=queue provider=vision-toolkit-anyrouter state=on` 会自动映射到上游 `anyrouter` 写策略（返回里带 `upstream` 字段）。
3. **`list` 输出 `registeredRoutes`**：列出**所有**已注册路由（含 `vision-toolkit-*` 变体）及其 `registrationRetryPolicy`——一眼就能确认 `vision-toolkit-anyrouter` 是否已继承排队策略（应显示 maxRetries=10 / maxDelayMs=30000）。

> 诊断时用 `mask_client action=list` 看 `registeredRoutes` 里 `vision-toolkit-anyrouter` 的策略；若仍是 maxRetries=5，说明转发补丁还没生效（重启后生效）。

## 使用 / Usage

**设置页**：选择 provider → 点 **Claude Code / Codex / Off**，或 **Test call** 验证伪装是否生效；**排队适配**开关控制该 provider 的排队重试策略。

**模型工具 `mask_client`**：

```text
mask_client action=list
mask_client action=on provider=agen-openai preset=codex
mask_client action=on provider=agen-openai preset=custom headersJson={"originator":"codex-tui"}
mask_client action=off provider=agen-openai
mask_client action=test provider=agen-openai
mask_client action=body provider=anyrouter state=on
mask_client action=body provider=anyrouter state=off
mask_client action=queue provider=anyrouter state=on
mask_client action=queue provider=anyrouter state=off
```

- `on` 采用合并语义：保留你原有的其他请求头，仅覆盖预设拥有的键；`headersJson` 可追加/覆盖任意头。切换预设**不会**关掉请求体伪装。
- `off` 删除预设拥有的键**和**请求体伪装开关（"这条线路不再伪装"），你手工配置的头会保留。
- `test` 通过 `ctx.llm.stream` 真实调用该路由（默认用 provider 的第一个模型，可用 `model=` 指定），返回 `effectiveWireHeaders`（线上实际收到的头）、`bodyMasquerade` / `bodyMasqueradeLive`、模型首段输出或网关报错；会带退避重试以骑过排队窗口，并附上 `classification` / `disguiseImplicated`（见上文）。
- `body` 写/删 provider 的请求体伪装开关（`state=on|off`）。
- `queue` 写/删 provider 的 `retryPolicy`（`state=on|off`，可选 `retries=`、`maxdelay=` 覆盖）。

**诊断某个网关是否按请求体识别客户端**（换网关、或怀疑指纹过期时）：

```bash
node test/body-fingerprint-probe.mjs --host anyrouter.top --key-env ANYROUTER_API_KEY [--proxy 127.0.0.1:7890]
```

它手工构造请求、逐项消融、轮转发送，并在首尾各发一次对照请求——对照结果不一致就判定本轮不可信并要求重跑，而不是把网关的状态漂移当成结论。输出会直接告诉你该网关卡在哪一项，以及当前指纹还能不能通过。

## 仓库结构 / Repository layout

| 文件 | 用途 |
| --- | --- |
| `index.js` | 安装模式 Host 插件（cordis 主入口：`name` + `apply`） |
| `client.js` | 安装模式 Web 客户端 bundle（`__ModuleLoader__` 格式，设置页） |
| `cordis.patch.yml` | bundle patch：`dsh plugin add` 后自动挂载的插件行 |
| `host.body.js` / `client.body.js` | 动态插件模式的 paste-ready 代码体 |
| `plugin.js` | 动态代码体编程加载器（剥离注释头） |
| `patches/patch-lib.js` | 三个补丁的文本与 apply/revert 逻辑（Host 插件与 CLI 共用，避免漂移） |
| `patches/claude-code-fingerprint.js` | 抓包得到的 Claude Code 请求体指纹（身份 system 块 + 哨兵工具定义） |
| `patches/apply-*.mjs` | 三个补丁各自的手动 CLI（均支持 `--revert` / `--target`） |
| `test/body-fingerprint-probe.mjs` | 消融诊断：判断某网关是否按请求体识别客户端、当前指纹是否还有效 |
| `test/*.test.js` | 单元测试（`npm test`） |

## 限制 / Limitations

- 仅作用于 **`llm-pi-ai` 自定义 provider**；内置 `deepseek-official` 适配器没有请求头钩子，无法用此方式伪装。
- 预设现在包含 `user-agent`；未打 `patches/` 补丁时，`user-agent` 仍会被归属机制覆盖（其余身份头不受影响）。此时 `test` 会额外返回 `warning`，明确告知伪装 UA 实际没有上线。
- 伪装头会真实写入设置文档并持久化；停用插件不会自动撤销，需要执行 `off` 或清除 provider 的 `headers` 字段。
- **请求体伪装的哨兵工具是"告知但未实现"的**：模型看得到 Glob/Grep/Read，DSH 执行不了。它们都是只读工具，误调只会让那一步失败，但这确实是真实代价——只在需要它的线路上开。
- **请求体伪装只针对 Anthropic 协议**（`api: anthropic-messages`）。补丁改的是 pi-ai 构造 Anthropic 请求体的地方，OpenAI 兼容协议的路线不受影响，也不需要。
- **指纹会过期**。当前指纹认的是工具名 Glob/Grep/Read（描述不参与校验）。Claude Code 若给这几个工具改名，伪装会失效，且失败表现和"网关繁忙"一模一样——用 `test/body-fingerprint-probe.mjs` 判断是哪种。
- **排队不等于失败**：上游渠道耗尽时的 429/503 对真实 Claude Code 同样返回。但反过来不成立——先确认请求体伪装已生效，再把 429/503 当成排队。

## License

[MIT](LICENSE)
