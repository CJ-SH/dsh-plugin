# Research / P8：Ollama Cloud 用量条目 —— 动态插件原型结论

> 记录人：AI（创造模式动态插件原型）
> 对应任务：`.trellis/tasks/09-14-ollama-usage-entry`
> 插件身份：`ollusa-1`（当前 `pkg-5`，run-5）
> 目的：作为「常驻包」任务的输入 —— 把本原型踩过的真实契约、硬约束与坑一次性交代清楚。

---

## 0. 交付形态

一个**动态 Cordis 插件**（进程内临时，Host + Client 两半）：

| Package | 内容 |
|---|---|
| `pkg-1` | Host：设置命名空间 + 凭据 + 取数（含临时自检工具 `ollama_usage_diag`） |
| `pkg-2` | Host：修复跨 realm patch、端点对齐 `{baseURL}/api/usage` |
| `pkg-3` | Host + Client：三处 UI 首版 |
| `pkg-4` | UI 大改：面板向上浮、标签改窗口用语、卡片折叠、**凭据双模式** |
| `pkg-5` | 样式对齐官方：dock 行几何、tip 面板样式、重置口径文案 |

Host RPC（`harness.handle` / `host.call`）：
`config/read`、`config/save`、`credential/describe`、`credential/set`、`credential/unset`、`usage/read`
Client 槽：
`conversation.composer.dock`(id `ollama-usage`, order 1)、`shell.overlay`(id `ollama-usage-hero`, order 1)、`settings.plugin.item`(key `ollama-usage`)

---

## 1. 沙箱 Builtins 实况（**决定架构的硬约束**）

以 `cordis_inspect_query` 实测 + 源码交叉核实（`dsh-cordis-host-runner/lib/types/sandbox.js`、`dsh-cordis-client-runner/lib/client.js`）：

### Host 半
可用：`ctx`、`harness`、`console`、`btoa`、`atob`、`TextEncoder`、`TextDecoder`。
**被 trap（调用即抛）**：`require`、`setTimeout`、`setInterval`、`setImmediate`、`clearTimeout`、`clearInterval`、**`fetch`**。
`process` / `Buffer` 为 `undefined`。新 vm realm **没有 `URL`**（只有标准内置）—— 校验 URL 只能用正则，不能用 `new URL`。

**推论 1**：Host 无 `fetch`；`ctx.web.fetch(WebFetchRequest)` 的请求体**只有 `url`**（`dsh-web-fetch-http` 自己写死 headers，不接受 Authorization）
⇒ **带 Bearer 的 HTTP 只能走 `ctx.subprocess`**：起 `node -e` 子进程，密钥只经**子进程环境变量**（不进 argv、不进日志），stdout 回 `{status, body}`。
（`ctx.get('sandboxPolicy').workspaceRoot` 提供绝对 cwd；`subprocess.resolveExecutable('node')` 解析可执行文件。）

### Client 半
可用：`ctx`、`React`、`host`、`styles`、`console`。
**被 trap**：`setTimeout`、`setInterval`、`clearTimeout`、`clearInterval`、`fetch`、`require`。
**没有 `react-dom`，也没有 `document`**（client closure 参数表里根本没有）。

**推论 2**：`createPortal(document.body)` **无法实现**；hero 浮层改用官方加性席位 **`shell.overlay`**（`kind:list` / `scope:root` / `replaceRisk:none`，"frame-wide floating layer … **click-through**，直接子元素自动 `pointer-events:auto`"，层级 `z-index:20`）。

### 两端一致
**timer 动词（`ctx.timeout` / `ctx.interval` …）必须先 `inject: ['timer']`**，否则 guard 直接拒（`denyRead('timer')`）。只读服务用 `ctx.get(name)` 即可，无需声明。

---

## 2. 契约实况（逐条实测）

### 2.1 `settings.register(ns, schema)` 需要"可调用 schema"
Host 沙箱**没有 schemastery `z`**。实测可行做法：传一个**函数**当作 schema —— `dsh-settings` 内部就是 `schema(mergeLayers(base, section))` 取返回值；再挂 `.toJSON()` 供 `describe()` 序列化（descriptor.schema 的 wire 类型是 `JsonValue`，任意 JSON 都能过）。

```js
function settingsSchema(value) { /* 归一化 + 兜默认值 */ }
settingsSchema.toJSON = () => ({ type:'object', dict:{…} })
ctx.get('settings').register('ollama-usage', settingsSchema)
```

### 2.2 ⚠️ `settings.update` 的 patch 必须是**宿主 realm** 的 plain object
`dsh-settings` 的 `isPlainObject` 比对的是**宿主 `Object.prototype`**（`proto === Object.prototype || proto === null`）。沙箱里写的字面量 `{…}` 属于 **vm realm**，会被拒：

```
settings update for "ollama-usage" must be a plain object
```

**对策**（本原型采用）：拿一个宿主 realm 对象取原型，再造 patch：
```js
const proto = isForeignPlainObject(sample) ? Object.getPrototypeOf(sample)
            : Object.getPrototypeOf(settings.describe()[0])   // describe 返回宿主对象
const patch = Object.create(proto)
patch.baseURL = …; patch.credentialMode = …; patch.apiKeyEnv = …
```
（`harness.handle` 与动态 Tool 收到的 `args` **本身已是宿主 realm**，实测 `patchOrigin: 'argument'`。）

注意：`subprocess.spawn(spec)` **接受 vm realm 对象**（实测可跑）；`harness.defineTool(options)` 由 guard 归一化 —— **只有 `settings.update/replace/mutate` 挑 realm**。

### 2.3 配置卡片如何被派发
`dsh-client-ui-settings-plugins` 的 `ConfigurablePluginsTabController`：
```js
namespaces = ctx.slots.entries("settings.plugin.item")
  .flatMap(e => e.options.key && served.has(e.options.key) ? [e.options.key] : [])
```
`served` = Host 已注册命名空间（来自 `settings.describe()` 镜像）。
⇒ **Host 注册命名空间 + Client 注册同 key 的卡片 = 卡片出现**，两边缺一不可。

### 2.4 ⚠️ 卡片排序**不可控**（动态插件恒在最前）
渲染顺序 = `ctx.slots.entries()` 顺序，而 **guard 对动态条目强制分配负优先级**：
```js
// dsh-cordis-client-runner: guardedSlots
if (spec === void 0 || spec.kind !== "chain") { priority = env.allocatePriority(); options.priority = priority }
```
传进去的 `priority` 会被覆盖（实测依次 -1/-2/-3…），而官方卡片是 `0`。
⇒ 动态卡片**恒定排在官方卡片之前**，插件侧无法调整。常驻包（普通安装插件）不受此限。

### 2.5 凭据 seam
`resolve(ref)`（每次操作重新解析，凭据轮换无需重启）、`describe(ref)`（回 `configured/writable/source`，**不回显值**）、`set(ref,value)`、`unset(ref)`。

**本原型的关键设计**：`credential/set` / `credential/unset` 这两个 RPC **不接受 ref 参数**，Host 侧写死插件专属引用 `OLLAMA_USAGE_API_KEY`。
⇒ 客户端即使被改坏，也**物理上无法覆盖**别的提供方共用的 `OLLAMA_API_KEY`。（起因：用户的自定义提供方与本插件曾共用同一引用，一旦本插件写入就会改写对方密钥。）

### 2.6 槽几何
- `conversation.composer.dock`：父容器 `uV2eYG_root` 是 **`flex-direction:column`** ⇒ 流式布局下**每个 dock 条目各占一行**。
  但**同排仍可实现**：把自己的条目做成 `height:0` 的定位盒子 + 绝对定位（见 §5.1 实测配方）。"复用官方 `stats` 单元格"是另一条路，但那等于替换内置条目。
  官方行几何（照抄目标，`.bOPqQW_root`）：
  `max-width:var(--dsh-chat-content-width); width:100%; padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0; display:flex; justify-content:center; gap:12px; margin:0 auto; font-size:var(--dsw-…secondary,13px)`
  官方胶囊（`.bOPqQW_pill`）：`border-radius:24px; padding:1px 8px; gap:6px; display:inline-flex; color:var(--dsw-alias-label-tertiary); font:inherit; font-variant-numeric:tabular-nums`，hover `--dsw-alias-interactive-bg-hover`。
- `shell.overlay`：`position:absolute; inset:0; z-index:20; pointer-events:none`，**直接子元素自动 `pointer-events:auto`** ⇒ 自己的根盒子必须**小到只覆盖 pill/面板**，否则会挡住应用。
- `conversation` 子树的 CSS 变量（`--dsh-composer-*`、`--dsh-chat-content-width` 等）设在 `wSkVaW_root` 上，**不会**传给 `shell.overlay`（不在同一子树）⇒ hero 浮层只能自定坐标。
- 官方 tip 面板样式（照抄目标）：`border:.5px solid var(--dsw-alias-border-l1)` + `background:var(--dsw-specific-tip)` + `border-radius:12px`，body `padding:6px 12px; gap:8px`。

---

## 3. 端点与数据（实录）

### 3.1 端点
- ✅ `GET https://ollama.com/api/usage`，`Authorization: Bearer <key>`，`accept: application/json`
- ❌ `GET https://ollama.com/usage` → **404**（PRD/design 里 `{baseURL}/usage` 的默认值 `https://ollama.com` 会打到 404）
  Ollama 原生 API base 是 `https://ollama.com/api`（`dsh-llm-ollama` 的 `OLLAMA_PUBLIC_BASE_URL` 即此）。
  **本原型对策**：`{baseURL}` 若不以 `/api` 结尾则补 `/api` 再拼 `/usage` —— `https://ollama.com` 与 `https://ollama.com/api` 两种填法都工作，同时保住 design 的"`{baseURL}/usage`"公式。
- `https://ollama.com/api/me` → 405（无用）

### 3.2 返回形状（2026-09-14 实测原文，已脱敏）
```json
{"activity":{"cost":"0.00000","period":{"type":"last_4_weeks","starting_at":"2026-08-24T00:00:00Z","ending_at":"…"},"models":[]},
 "limits":{
   "session":{"usage":0.259,"models":[{"name":"deepseek-v4.1-flash","request_count":505},{"name":"web search","request_count":3}]},
   "weekly":{"usage":0.057,"models":[…4 条…]}}}
```
- 当前账号只返回 `session` + `weekly`（**没有 `monthly`**，也没有 `activity.models`）⇒ 面板必须**只渲染实际存在的窗口**。
- **窗口内没有任何重置时间戳**（无 `resets_at` / `reset_at` / `reset` / `reset_after_seconds`），顶层只有 4 周计费周期。
- 窗口周期（来自 `dsh-llm-ollama` 常量）：`session = 5 小时滚动`、`weekly = 7 天`、`monthly = 30 天`。
⇒ 重置文案走**滚动口径**：「每 5 小时重置 / 每 7 天重置 / 每 30 天重置」（与官方 ollama 卡片同词）。代码保留绝对时间分支，端点将来返回时间戳会自动切换。
- `unsupported` 的判定：**HTTP 404** ⇒ 静默（自建端点常见）。

### 3.3 命名
按 Claude/Codex 中文界面的惯例（「滚动五小时窗口 / 每周窗口」「用量 / 使用限额」）：
- 窗口名：**5 小时窗口 / 每周窗口 / 每月窗口**
- pill：**`Ollama 窗口用量 {pct}%`** + `· 每 5 小时重置`；tooltip 写明"最紧窗口 + 重置口径"

---

## 4. 方案要点

- **相位判定（hero vs 活动会话）**：以 **dock 占位者是否挂载**为信号 —— dock 条目只在 `variant === "composer" && input !== undefined && sessionId !== undefined` 时渲染（`dsh-client-ui-conversation/lib/client.js:16259`），hero 相位 `variant === "hero"` 故不渲染。
  实现：模块级 `dockMounts` 计数 + 250ms 沉降（避免首帧闪），`hero = settled && dockMounts === 0`。
- **面板**：`position:absolute; bottom:calc(100% + 6px)` 向上浮出 ⇒ **不占布局**；`Esc` 关闭并把焦点还给 pill（ref holder 用 `useState(() => ({current:null}))` 实现，避免依赖未在 Builtins 列出的 `useRef`）。
- **数据流**：单一共享 store + `acquire/release` 引用计数（挂载一次 + 打开面板一次 + 5 分钟轮询，消费者归零即 `ctx.interval` 停止），`host.call('usage/read')` 失败一律 `phase='none'` ⇒ 三处都不渲染。

---

## 5. 坑清单（照抄即可避雷）

| 坑 | 症状 | 对策 |
|---|---|---|
| Host 无 `fetch`、`ctx.web.fetch` 不能带 header | 无法发 Bearer 请求 | `ctx.subprocess` + `node -e`，密钥走 env |
| `settings.update` 挑 realm | `must be a plain object` | `Object.create(宿主对象原型)` 造 patch |
| Host 无 schemastery | `register` 缺 schema | 传**函数**当 schema + `.toJSON()` |
| Client 无 `react-dom`/`document` | `createPortal` 不可用 | 用 `shell.overlay` 加性席位 |
| `shell.overlay` 直接子元素自动 `pointer-events:auto` | 浮层挡住整个应用 | 根盒子只包住 pill/面板 |
| dock 父容器是 column | 无法与内置胶囊同排 | 官方几何做"居中第二行"，或改用 `conversation.input.right` |
| 动态卡片优先级为负 | 卡片恒排第一，改不了 | 记为已知限制；常驻包可正常排序 |
| timer 动词未声明 | `cannot get property "timer" without inject` | `inject: ['timer']` |
| `{baseURL}/usage` 默认值打 404 | 永远 `unsupported` 静默 | base 补 `/api` |
| 子进程 `env` | 密钥泄漏风险 | 只走 env，绝不进 argv/日志；错误只报状态码 |
| 长客户端代码括号失衡 | define 时 `Unexpected token ','` | 先落盘 `node --check`（包 `(async()=>{…})()`）再 define |
| **`slots.register` 的 `name` 写成 id** | 客户端半边 `client-half-failed`：`slot "<我的id>" is not declared` | `name` 必须是**槽位键**（`shell.overlay`），`id`/`key` 才是自己的单元格标识。两者极易混 |
| 定位盒子随数据门控一起 `return null` | 测量永远拿不到 DOM → 永远走兜底 | 盒子/slot **常驻挂载**，只门控内容；测量 effect 依赖**数据相位** |
| 测量 effect 只依赖 `[]` | 数据到达后不再重测 | 依赖 `[phase, modeKey]`；模式切换后必须重测（盒位置随模式变） |
| 视口坐标与局部坐标混用 | 组件落在错误位置（本例：压在内置胶囊上） | `getBoundingClientRect()` 全是**视口坐标**；相对定位要减 `own.left/top` |
| 试图"官方簇+我"整体居中 | 必然与官方簇重叠 | 官方簇被它自己的 `justify-content:center` 钉住、动不了；只能贴其右缘 + gap |
| **重构把"定位外壳"上移，漏改使用点** | hero 浮层**元素在 DOM 里、屏幕上却看不到**（F12 可见） | `UsageSurface` 改成返回内层 div、外壳上移到 `DockEntry` 时，**忘了给 `HeroEntry` 也加外壳** → hero 根元素成了无 CSS 规则的普通 div，`placement:'hero'` 也无人使用。教训：包装层上移必须逐个使用点核对；**hero 路径不在日常视线，最容易漏**（潜伏了 pkg-9→pkg-13 共 5 版） |
| 无法从 `shell.overlay` 定位到 conversation 内的元素 | hero 浮层只能钉在窗口底部，离 hero 输入框很远 | 用**插槽系统自己的** `data-slot="<slotKey>"` 标记（渲染器给每个槽位出口都打了）定位出口元素，再用 `resolveBox` 穿透 `display:contents` 取真实盒子；`getComputedStyle(el).paddingBottom` 拿来避开容器底部留白 |

---

## 5.1 dock 与官方胶囊**同排**：实测可行方案

> 更正：中途我曾判断"槽位条目外层有 `display:contents` 包裹层导致测量失效"——**这个判断是错的**。
> 布局诊断实测 `node.previousElementSibling` 就是官方行 `DIV.bOPqQW_root`（无包裹层）。
> 真正的失败原因只有两个：**定位盒子未挂载** + **坐标空间混用**。穿透逻辑（`resolveBox`）留作防御，不是必需。

可行配方（已验证，实测数字见下）：

1. 我的 dock 条目**常驻挂载**一个 `height:0` 的定位盒子（不占行），`position:relative`；pill 放在其中的 slot 里，slot 默认 `position:absolute; transform:translateY(-50%)`。
2. `useLayoutEffect` 依赖 `[数据相位, 定位模式]`，测量：
   - `own = box.getBoundingClientRect()`（视口坐标）
   - 官方行 = `box.previousElementSibling`（防御：前后兄弟 + 父容器子元素扫描 + 单子元素穿透）
   - `metrics` = 官方行**子元素**的 min/max（left/right/top/bottom）→ 得到**胶囊簇**而非整行
3. 定位（视口→局部）：
   - `left = metrics.right - own.left + 12`（贴官方簇右缘、12px）
   - `top  = metrics.centerY - own.top`（配 `translateY(-50%)` 垂直同轴）
4. 用 `ResizeObserver` 观察父容器与官方行，重算。
5. 兜底：找不到官方行 / 量不到 → 退回"官方同几何的居中独立一行"。

**实测（本机，2026-09-14）**：
```json
{"mode":"inline","own":{"w":1214,"h":0,"left":296,"top":734},
 "metrics":{"left":715,"right":1091,"centerY":723},
 "computed":{"left":807,"top":-11}}
```
`left=1091-296+12=807` → 绝对 1103，官方簇止于 1091 → 间隔正好 12px；`top=723-734=-11` → 中心线 723 与官方一致。

**几何上无法两全**：无法让"官方簇 + 我"整体居中而同时不重叠 —— 官方簇被其容器 `justify-content:center` 钉在对话框中心，插件无法移动它（移动即改内置条目）。因此整行会相对对话框中心**偏右约半个自己的宽度**。若更在意"整体居中"，只能接受独立一行（官方同几何）。

**验证手段（可复用）**：客户端把测量结果经 `host.call('layout/report', …)` 上报，Host 用 `harness.handle` 存下并注册一个**临时动态 Tool** 返回它 —— 模型即可直读 UI 层的真实几何，不必靠截图或推断。诊断工具应在定稿 Package 中移除。

---

## 6. 常驻包建议（本任务范围外）

1. **迁移结构**：Host 模块 + Client 模块 + `dsh.client`(platform web) + 包清单 + `dsh plugin --profile web add <spec>`；RPC 入口从 `harness.handle/host.call` 换成包内 RPC。
2. **HTTP**：常驻包是**真实 Node 插件**（非沙箱），可直接 `fetch` 带 Authorization（参照 `dsh-llm-ollama` 的 `readOllamaUsage`），**不再需要子进程**。
3. **UI**：可用 `react-dom` 做真 portal；但 `shell.overlay` 仍是更合规的席位，建议保留。
4. **i18n**：改用客户端 `locale.register(ns, {zh,en})` + `bind(ns)`（本原型为省风险只按 active locale 选词表，不随切换实时更新）。
5. **卡片排序**：常驻包按正常优先级注册，可排在官方卡片之后。
6. **端点**：`resets_at` 之类字段若日后出现，已有绝对时间分支可用；`activity.cost/period` 目前未用（可考虑"计费周期"展示，但 PRD 明确不做金额换算）。
7. **配置**：本原型已把 `baseURL / credentialMode / apiKeyEnv` 写入用户 `settings.yaml` 的 `ollama-usage` 段；凭据模式下**不写任何凭据**。

---

## 7. 常驻包已落地（实测契约）

工程目录：`D:\project\dsh\dsh-plugin-ollama-usage`（Host + Client + 清单 + patch，**无构建步骤、运行时零外部依赖**）。

### 7.1 清单格式（照 `dsh-llm-ollama` 的真实包核实）

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // 安装即成为 profile 的一个 patch 层
    "client": { "platform": "web", "inject": ["<必须先加载的插件行>"] }
  }
}
```
`cordis.patch.yml`：`- insert: [ { id, name: '<包名>' } ]`。

### 7.2 客户端产物**必须**是 module-loader bundle

构建产物（`@deepseek-ai/dsh-client-modules` 的契约）不是普通 ESM，而是：

```js
window.__ModuleLoader__.load({
  id: '<包名>',                       // 必须等于 package name
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    const React = require('react');   // 平台基线，无需声明 external
    function apply(ctx) { /* ... */ }
    exports.apply = apply; exports.inject = inject;
    return module.exports;
  },
})
```
基线可 `require` 的键（实测）：`react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`。
**小插件完全可以手写这个包装**，从而免掉 tsdown/TS 工具链。

### 7.3 Host↔Client 私有 RPC（照 `dsh-llm-ollama` 核实）

```js
// Host
ctx.inject(['connection'], (c) => {
  c.effect(() => c.connection.rpc.handle('/my-channel', (endpoint, payload) => ({ ok: true, value })), 'label')
})
// Client（inject 里要有 'connection'）
const answered = await ctx.connection.rpc.call('/my-channel', endpoint, payload)
// answered.ok === true ? answered.value : answered.error.{code,message}
```

### 7.4 安装与验证

- 安装：`dsh plugin --profile web add <dir>`（转发 pnpm）→ 得到 `link:`/Junction，改代码重启即生效。
- **重启前预检**：`dsh --profile web --dump-config`，应出现 `- id: ollama-usage` 行。
- 生效需要**重启 dsh**。
- 坑：profile 若启用 `minimumReleaseAge` 供应链策略，可能因**既有**lockfile 条目而整体拒绝安装（与本次要装的包无关）。**不要**重建用户的 lockfile；用 `--config.minimumReleaseAge=0` 仅本次放宽。
- 零依赖策略：Host 半不 import 任何 `@deepseek-ai/*`（设置 schema 继续用"可调用对象 + `toJSON()`"），Client 半只 `require('react')`，因此不依赖 profile 的模块解析。

### 7.5 验证证据（重启前可拿到的全部）

| 检查 | 手段 | 结果 |
|---|---|---|
| 清单被合入 profile | `dsh --profile web --dump-config` | 出现 `- id: ollama-usage` 行 |
| 引导图含本插件 | 另起实例（端口 3099）读首页 HTML | `{"id":"dsh-plugin-ollama-usage","url":"/plugins/??…&rev=…","inject":[…]}` |
| 客户端 bundle 被服务 | GET 引导图里的原样 URL | HTTP 200 / `text/javascript` / 47849 B，含 `__ModuleLoader__.load` + `id` + 三处席位 |
| 引导无错 | 该实例 stdout | 仅 2 行、无 error |
| Host 半行为 | `test/host.test.mjs`（假 cordis ctx 挂载真实模块） | 24/24：命名空间、通道、schema、`config/read` 信封、**凭据边界**、四类空态、无密钥泄漏、零 `@deepseek-ai` import |
| Client 半席位与契约 | `test/client.test.mjs`（假 `window.__ModuleLoader__` + 假 ctx） | 27/27：三处席位（**槽名 vs id/key 分离**）、order、样式注入与回收、**跨半边 endpoint/通道/命名空间一致** |
| 持久数据未被污染 | 读 `settings.yaml` / `.credentials.yaml` | 段完好、无明文密钥、本包未写入任何凭据 |

`npm test` 一条命令跑两个 harness（共 61 条断言，无测试框架、无依赖）。

**唯一未完成**：`dsh web` 重启后，在**主实例**里目视确认三处 UI（活动会话 dock pill / 新会话锚定浮层 / 设置里的配置卡片）与配置延续。重启会终止当前 agent 进程，故须由用户执行。

---

## 8. 常驻包第二轮：四个真实契约坑（实测撞出，官方文档可查）

参考实现：本地已发布的 `dsh-llm-ollama`、`dsh-better-sidebar`。
文档：[Plugin Anatomy](https://deepseekdocs.com/en/docs/learn/core/plugin-anatomy)、[第一个插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)。

| # | 坑 | 症状 | 正解 |
|---|---|---|---|
| 1 | **没导出模块级 `inject`** | 插件照常挂载、什么都不注册、什么都不报：`ctx.get('settings')` 静默 undefined，访问 `ctx.name` 直接抛 `cannot get property "name" without inject` | `export const inject = [...]`。cordis 的 ctx 是**能力受限代理**——"未声明访问会被拒绝"；声明后 loader 会等依赖就绪再调 `apply`。**这条让前两轮所有"验证通过"都成了假阳性**：注册在、引导图在、bundle 被服务，但插件实际什么都没注册 |
| 2 | 把 `settings.register(...)` 包进 `ctx.effect` | `TypeError: Invalid effect`（它返回 scope，不是 disposer） | 直接调用（挂在自身 fiber 上随插件卸载）；只有返回 disposer 的（如 `connection.rpc.handle`）才包 `effect` |
| 3 | 以为给自己注入 `webServer` 就够 | `rpc.handle` 内部抛 `cannot get property "webServer" without inject` | `connection.rpc.handle` 把每个 channel 注册成 **web 路由**，且注册在"**读该服务的那个 ctx**"上（`get rpc(){ const owner = this.ctx; … owner.webServer.register(route) }`），而随包发行的 `connection` 行只有 `inject: [webRuntime]` |
| 4 | 无法用零依赖方式绕开 #3 | 同上 | 在自己的 bundle patch 里按 id 覆盖那一行：`- id: connection` + `inject: [webRuntime, webServer]`（**inject 是整值覆盖，必须照抄随包条目**）。已实测生效：`channel=registered` |

**最重要的运维结论**：插件行里 `apply` 抛错会**打挂整棵插件树**（`dsh: plugin tree failed to load: failed to apply loader entry …`，dsh 直接起不来）。
所以可选依赖的注册必须 `try/catch` 降级成"少一个 UI 面"，绝不能阻断启动。

**顺带发现的副作用**：`dsh-llm-ollama` 的 `/ollama-cloud` 通道用同样写法、却整行没有 `webServer`
—— 它的用量通道在这台机器上很可能**从未注册成功过**（这解释了其用量面板长期无数据）。

### 8.1 在浏览器之外端到端验证 RPC 通道（可复用）

`dsh-client-connection` 的通道就是一条普通 web 路由，帧格式（源码实测）：

```
POST {channel}/{endpoint}                  # 例：POST /ollama-usage/usage/read
content-type: application/json
body: { "type":"client-request", "rpcId":"<string>", "method":"<endpoint>", "payload":{…} }
resp: { "type":"server-response", "rpcId":"…", "result":{ "ok":true, "value":… } | { "ok":false, "error":{code,message} } }
```

鉴权：路由先过 `isTrustedApiRequest`（Host/Origin 围栏），再过 `browserAuth.isAuthenticated`。
用带 `?token=` 的首页请求换取 cookie，然后**同一 session** POST 即可 —— PowerShell 用 `-SessionVariable` / `-WebSession`。

实测（端口 3099）：
```
GET  /?token=…                        → 200，拿到 1 个 cookie
POST /ollama-usage/config/read        → 200 {"ok":true,"value":{"registered":true,…}}
POST /ollama-usage/usage/read         → 200 {"ok":true,"value":{"status":"ok","usage":{session 53.2%, weekly 10.6%}}}
```

这条方法不需要浏览器、不需要用户操作，可直接证明"Host 通道是否真的活着"——排查常驻插件时优先用它。

### 8.2 第五个坑（客户端）：信封缺字段

`request('config/read')` **漏传 payload**。线上信封 schema 是
`{ type:"client-request", rpcId, method, payload }`，四个字段缺一不可：

```
POST /ollama-usage/config/read  body 缺 payload
  → {"ok":false,"error":{"code":"gateway/bad-request","message":"invalid client-request message"}}
POST 同端点 body 带 "payload":{}
  → {"ok":true,"value":{"registered":true,…}}
```

客户端的 `request()` 在 `ok !== true` 时抛错 → 整条 promise 链 reject → 设置卡片永远停在"读取中…"，
其后的 `credential/describe` 永远没机会执行。**同一个 bug 只落在没传参的那一处**：
`usage/read` 当初写的是 `request('usage/read', {})`，所以 dock pill 是好的、卡片却卡住。

回归防护：`test/card.test.mjs` 的假 `rpc.call` 现在**强制校验 payload 存在**，缺了直接失败。

### 8.3 hero 浮层的真实结论

相位规则：`heroVisible() = settled && dockMounts === 0`（"当前没有 composer dock 在渲染"）。
`test/hero.test.mjs`（最小 hook 运行时驱动真实组件）4/4 证明：

| 断言 | 结果 |
|---|---|
| dock 在会话里渲染 pill | ✅ |
| dock 挂载时浮层被抑制 | ✅ |
| **dock 卸载后浮层接管并渲染 pill** | ✅ |

所以 **hero 浮层与 dock 是互斥的两半**：该 app 的"新对话"若仍渲染 composer（dock pill 可见），
浮层就按设计不出现，用量由 dock 那行承担；只有当 `variant === 'hero'`（dock 不渲染）时浮层才接手。
定位用 `[data-slot="conversation.composer.bar"]` 锚到输入卡下方，量不到时回退窗口底部居中。

### 8.4 交付状态（用户确认）

`npm test` = **76 条断言**（host 35 / client 27 / card 10 / hero 4）全绿；用户目视确认 dock pill、
新对话浮层与设置卡片三处均正常。临时诊断已全部移除（`lib/*.js` 无 `diag` 残留）。
