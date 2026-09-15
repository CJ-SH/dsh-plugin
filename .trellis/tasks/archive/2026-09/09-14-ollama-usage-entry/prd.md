# PRD: Ollama Cloud 用量条目（对话框下方）

## Goal / 用户价值

在 Web 对话页把 **Ollama Cloud 账户用量**显示在输入框下方，与内置「会话统计」「Token 用量」并列：活动会话用 composer dock 条目，新会话（hero）用自绘浮层。配置由**本插件自己在 设置 → 插件 → 插件配置 里的卡片**一次性完成（baseURL + 凭据引用名，密钥经官方凭据 seam 保存）。先以创造模式动态插件试水，效果确认后再落成常驻包。

## Background / Confirmed Facts（含锚点）

1. 内置两个条目属于官方包 `@deepseek-ai/dsh-client-ui-chat`：`StatsPills`（容器标记 `data-composer-stats`），locale key `stats.dialog.title` = 会话统计、`stats.dialog.usageTitle` = Token 用量（`lib/client.js:2631-2632`）；注册进 `conversation.composer.dock`（`id: "stats"`, `order: 0`，`lib/client.js:8351-8356`）。
2. 槽契约：`conversation.composer.dock` = `kind: 'list'`, `scope: 'session'`，"Ambient entries below the composer card"（`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:197-201`）→ 可加性槽。
3. 渲染门（`dsh-client-ui-conversation/lib/client.js`）：
   - `conversation.composer.dock`：`variant === "composer" && input !== undefined && sessionId !== undefined`（:16259）→ 仅活动会话。
   - `conversation.input.dock` / `.overlay` / `.left` / `.right`：同样要求会话（:14869/:14927/:16060/:16076/:16178/:16183）。
   - hero 判定：`sessionId === void 0 || (shellPhase === "blank" && (openState === "open" || summaryBlank === true))`（:14868）；hero 阶段只有三个 **root 作用域单槽**（`hero.brand.mark` :14633 / `hero.workspace` :14886 / `hero.agentPreset` :14901），**没有 list 槽** → hero 只能自绘（已定）。
4. **配置卡片机制（本任务的配置面）**：
   - 槽 `settings.plugin.item` = `kind: 'keyed'`, `scope: 'root'`（`dsh-client-ui-settings-plugins/lib/types/client/slot-contract.d.ts:18-21`）；官方卡片按 `key: <namespace>` 注册（`settings-plugins/lib/client.js:1785-1800`）。
   - 派发规则：Plugins 设置区的 `Plugin configuration` 页签按 **Host 已注册的设置命名空间**逐个派发卡片（"namespace 与 card 两个 ledger 的交集"，见该包 README）。
   - Host 侧注册：`ctx.settings.register(ns, schema, { base?, applies?, validate? }) → SettingsScope<T>`（`dsh-settings/lib/types/index.d.ts:206-216`；descriptor 含 `ns/schema/value/revision`）。
   - 先例：第三方 `dsh-llm-ollama` 的卡片挂在 `settings.provider.item`（`key: llm-ollama`，其 `lib/client.js:3655-3661`）；本任务按官方 `settings.plugin.item` 走。
5. **凭据（密钥不进配置文件）**：`ctx.credentials` 提供 `resolve(ref) → { value, source } | undefined`（空值=未配置）、`describe(ref)`（可报告已配置/来源/可写，不回显值）、`set(ref, value)`、`unset(ref)`（`dsh-credentials/lib/types/index.d.ts:119-152`）。
6. 取数方式（参考 `dsh-llm-ollama`，但不共享运行时）：用已存 key 发 `GET <baseURL>/usage`，把 monthly / session / weekly 渲染成已用百分比 + 各模型请求数（`README.zh.md:43`）；其客户端解码形状 `{ status:'unsupported' } | { status:'ok', usage:{ fetchedAt, session?, weekly?, monthly? } }`，窗口 `{ usage:0..1, models:[{name,requestCount}], resetsAt? }`（`lib/client.js:122-182`），百分比 = `usage*100`（:2208），`resetsAt` 支持 ISO 串或 unix 秒（:325-331）。
7. 原型路径：随包 `cordis` preset（显示名「创造模式」）带 `dsh-tool-cordis` + `cordis-plugin-development` skill；动态插件进程内临时、支持 Host + Client 两半，用包内私有 JSON 方法通信（Host `harness.handle` / Client `host.call`）。

## Requirements

- **R1** 活动会话：输入框下方、内置两个 pill 之后（`order > 0`）增加 Ollama 用量条目；不替换、不遮挡内置条目。
- **R2** hero（新会话）：Client 侧 `createPortal` 到 `document.body` 的自绘浮层，仅 hero 相位可见，不注册任何 hero 单槽；相位判定优先用"dock 占位者是否已挂载"作信号。
- **R3** 自持配置：本插件注册自己的设置命名空间 `ollama-usage`（字段 `baseURL`，默认 `https://ollama.com`；字段 `apiKeyEnv`，默认 `OLLAMA_API_KEY`），并在 `settings.plugin.item`（`key: 'ollama-usage'`）注册配置卡片。**不读取、不依赖**任何第三方插件的配置形状或运行时 API。
- **R4** 密钥走官方凭据 seam：卡片输入的密钥经 Host 调 `ctx.credentials.set(ref, value)` 保存；取数时 `ctx.credentials.resolve(ref)` 解析；卡片只显示 `describe` 的"已配置/可写"状态，不回显明文；密钥不写入 `settings.yaml`。
- **R5** 空态/错误态：未配置 `baseURL`、凭据解析为空、HTTP 非 2xx、JSON 非法、端点无用量接口（`unsupported`）→ **不渲染**（不报错、不占位）。
- **R6** 显示条件（Key Decision，可否决）：只要"已配置且取数成功"就显示，与当前会话所用模型无关（账号用量与模型无关，配置是显式一次的）。
- **R7** 原型形态：创造模式动态插件（Host + Client 两半），可 run/stop/update，不改动 profile 文件、不写盘（配置本身经 settings/credentials 持久化，属运行期数据）。
- **R8** 视觉：pill/面板沿用内置主题 token 与布局（居中 flex、`gap: 12px`、`--dsw-alias-*`、tabular-nums）；卡片沿用设置页既有卡片外观约定（标题/描述/字段/保存-丢弃）。
- **R9** 显示内容与交互：pill 文案 = `Ollama {窗口} {pct}%`，窗口取三窗口中 `usage` 最大者（并列取 session > weekly > monthly）；点击展开面板：三窗口百分比、重置时间、该窗口各模型请求数。
- **R10** 安全：API key 只存在于 Host 进程内存与凭据存储；不下发浏览器、不入日志、不出现在错误信息；Client 只收解码后的数值与 `fetchedAt`。

## Acceptance Criteria（可观察）

- **AC1** Settings → Plugins → Plugin configuration 出现本插件卡片，可填 `baseURL`/`apiKeyEnv`、保存密钥、保存后**无需重启**生效；字段校验失败有提示。
- **AC2** 配置完成后：活动会话输入框下方出现用量条目，数值与 ollama.com/settings（或 providers 卡片）一致；内置「会话统计 / Token 用量」行为不变。
- **AC3** hero 阶段：浮层可见、不遮挡输入框与 hero 既有元素、不拦截指针交互；切入活动会话后浮层消失、dock 条目接手，切换不闪。
- **AC4** 未配置 / 凭据为空 / RPC 失败 / `unsupported` 时：条目与浮层都不渲染，Run 卡片无未处理异常。
- **AC5** 点击 pill 的面板显示三窗口百分比、重置时间与各模型请求数，与外部页面一致。
- **AC6** 停掉动态插件后条目与浮层消失、页面无残留（无孤儿 DOM/样式/定时器）；`cordis_undefine` 后彻底移除。
- **AC7** 浏览器侧（网络面板/页面状态）看不到 API key；插件日志与错误信息中无密钥；`settings.yaml` 中无明文密钥。
- **AC8** 页面刷新后可按 create-run 流程重新激活，且配置（settings + 凭据）仍在。

## Out of Scope

- 不读取 `llm-ollama` / `llm-pi-ai` 等第三方或被适配器拥有的设置命名空间；不调用 `dsh-llm-ollama` / `dsh-llm-providers-ui` 的任何服务/RPC；不按会话模型做路由推断。
- 不修改内置 `StatsPills`、不替换三个 hero 单槽。
- 不实现 Ollama 之外 provider 的用量；不做多账户、历史/趋势图、token→金额换算。
- 不做 host 侧缓存/持久化（除 settings + credentials 本身）。
- 常驻包（本地包/npm 包 + `dsh plugin --profile web add`）不在本任务实现，试水通过后另行立项。

## Technical Notes

- 刷新节奏（技术默认）：挂载一次 + 面板打开一次 + 约 5 分钟轮询；在飞请求随插件 dispose 取消。
- 端点风险：`GET {baseURL}/usage` 是 Ollama Cloud 的用量端点（与 ollama.com/settings 同源），属未公开契约；任何异常按 R5 处理。
- 待实现时用 Inspect 核实：Client 侧 `settings.plugin.item` 精确 props 与 Builtins（`react-dom` 可用性，否则 hero 浮层用纯 DOM）；Host 侧 `settings`（`register`/`describeAll`/owner `update`/`replace` 与 revision 语义）、`credentials`（`resolve/describe/set`）、Builtins 是否含 `fetch`（否则用官方 `dsh-web-fetch-http` 服务）。
- 代码形态"可移植"约束：仅 `React.createElement`（无 JSX）、不 import 用户模块、不触碰全局主题与页面其它 DOM。
