# PRD — dsh 通道注册与 connection 行 patch 的调研

> 子任务，父任务 `.trellis/tasks/09-15-trellis-statusline`。
> 父任务的功能已真机验收通过；**本任务不改进功能，只把几轮里暴露的平台级疑点查清并做决策**。
> 创建时用 `--no-start`，会话指针仍留在父任务。

## 目标与用户价值

`dsh-plugin-trellis-statusline` 现在**能用**（192 条自检 + 用户重启目视通过），但它依赖一条
**覆盖式 patch**（改写 dsh 自带的 `connection` 行）。用户在连续两轮追问里指出的核心问题是：

> "connection 只能覆盖修改，不能增量修改。"

这是真的（见 F5），它带来一个**组合脆弱点**：任何需要同样能力的插件都得把 shipped 行整个重述一遍，
两个插件写的列表不同就会互相顶掉，且**输的那一方静默失去能力**（症状只是"不显示"，没有报错）。

所以本任务要回答的是：**这条覆盖是必需的吗？如果不是，用什么代价更小的方式替掉它。**

## 已确证的事实（全部实测，含出处）

### F1. `connection` 行是 dsh 自带 bundle，`inject` 是"能力声明"而非服务清单

```
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject:
    - webRuntime                 # 出厂值只有这个
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
```

Cordis 会拦截未声明的读取，错误原文（本机实测）：
`service "webServer" is not injected. Declare it: inject: ['webServer', …]`。
**服务存在 ≠ 能用；`inject` 是那一行被允许读哪些服务。**

### F2. 插件注册 RPC 通道时，`webServer` 必须落在 **connection 那一行** 上

`dsh-client-connection/lib/index.js`：

```js
get rpc() { const owner = this.ctx; return { handle: (channel, handler) => this.register(owner, channel, handler) } }
register(owner, channel, handler) { …; return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`) }   // ≈:618
```

**实测（活的 dsh，动态 host 探针）**：一个只声明 `inject: ['connection']` 的插件

| 观测 | 结果 |
|---|---|
| `ctx.webServer` 直接读 | `THROWS: service "webServer" is not injected…` |
| `ctx.connection.rpc.handle('/trellis-probe-live', h)` | **成功，且路由真的活着**（HTTP 探针 → 401 = 走了鉴权栅栏） |

"自己读不到 `webServer` 却能注册成功" ⇒ **`owner` 不是调用方的 ctx，而是 connection 行自己的 ctx**。
故那一行必须能读 `webServer`。

**旁证（解释了为什么出厂代码没踩到）**：`dsh-client-connection` 自己发布共享 `/api` 通道时，
是**另外取一个有 `webServer` 的 context** 来注册的：

```js
const fetchHandler = connection.createSharedFetchHandler(API_PATH)
webCtx.effect(() => webCtx.webServer.register(route), "client-connection: /api route")   // ≈:781
```

即：**只有"第三方插件注册自己的通道"这条路径会踩到 `owner.webServer`**，出厂代码自己不会。

**直接证据（2026-09-16，F7 实验）**：插件行**自己**声明 `webServer` 也没用 —— 把 `connection` 行窄化后，
两个已在自己行里声明 `webServer` 的插件仍然抛 `cannot get property "webServer" without inject`。
即 route 注册用的 ctx 是 **connection 行的 ctx**，不是读服务那一方的 ctx。

### F3. `webServer` 是 dsh 原生服务（不是本插件定义的）：HTTP 载体 / 路由注册器

Inspect 权威契约（provider = dsh 自有 `dsh-host-webserver`）：

> "The browser HTTP carrier service. Activation listens immediately. Route registration order does not affect
> requests because configured named routes must be distinct, and the fallback handler answers anything not yet
> claimed during startup with 404 until its owner registers."

`register(route: WebRoute): () => void`、`registerUpgrade`、`registerFallback`、`tapIndex`、`applyIndexTaps`、
`collectIndexInjections`、`renderIndex`；`WebRoute = { kind: 'exact' | 'prefix', path, handler(req, res) }`。
访问方式：可选 `ctx.get('webServer')`（需 undefined 检查）或硬依赖 `inject: ['webServer']`。

**本插件没有定义任何服务**，只声明了要读它。

### F4. `webRuntime` 无法替代：它没有注册路由的能力

provider = dsh 自有 `dsh-web-app`，其源码注释与定义：

```js
/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = "webRuntime"
/** Services required before the web runtime can mount. */
const inject = ["webServer"]
const Config = z.object({ openBrowser, printUrl, surfaceContext, trustedHosts })
```

- 它是**就绪闸门 + 配置载体**（等绑定相关值解析完才放行依赖它的行，并携带 `trustedHosts`），
  **没有 `register`**；
- 它甚至不在服务目录里：Inspect 查 `webRuntime` → `no catalogued Service named "webRuntime"`。

所以那一行注入 `webRuntime` 与我们需要的 `webServer` **用途不同、不是二选一**：

| 服务 | 作用 |
|---|---|
| `webRuntime`（出厂就有） | **何时**可以挂载（时序）+ 读 `trustedHosts` |
| `webServer`（本插件 patch 补的） | **怎么**发布一条路由（`register`） |

### F5. patch 是**按字段浅覆盖**，没有追加操作符

- 官方文档（publish 指南）：*"a patch replaces a row's entire `config` value rather than deep-merging keys"*；
- loader 侧合并是 `Object.assign(target, source)` 那一档（`cordis-plugin-loader/lib/index.js` ≈:332）；
- **没写的字段保留，写了的字段整块替换** —— `inject` 这类列表同理，**没有"追加"形式**。

后果：任何需要拓宽这一行的插件都必须**完整重述** `[webRuntime, webServer]`。

| 情况 | 结果 |
|---|---|
| 两个插件写**同一个列表** | 谁赢都一样 → 幂等 |
| 两个插件写**不同列表** | 后应用的那层整行胜出，输的一方**静默**失去能力（症状：不显示、无报错） |

**更本质的一点**：真正"组合友好"的位置是 **profile patch**（`~/.dsh/profiles/web/cordis.patch.yml`，
其文件头自述 "Your patch layer for this dsh profile" —— **单一所有者**），而不是让每个 bundle 各写一遍。
bundle 自带 patch 换来的是**开箱即用**，代价就是上面这张表。

### F6. 本机现状（实测，用于判断风险有多大）

- profile 下共 **47 个** `cordis.patch.yml`（`find -L` 扫，否则会漏 link 安装的包）；**2 个**碰 `connection`：
  `dsh-plugin-ollama-usage` 与 `dsh-plugin-trellis-statusline`，写的值**完全相同**（`[webRuntime, webServer]`）；
  （旧记录写「25 个里只有 1 个」，漏了 ollama-usage；证据见 `research/f7-parallel-probe.md`）
- 合并结果 `connection.inject = [webRuntime, webServer]`（本插件 patch 的产物）；
- `/trellis-statusline` 与 `dsh-llm-ollama` 的 `/ollama-cloud` 路由**都活着**（401）；
- `dsh-llm-ollama` **也注册通道**，但只注入 `['connection']`、也**不** patch 那一行，且**没有 try/catch**：

  ```js
  ctx.inject(["connection"], (connectionCtx) => {
    connectionCtx.effect(() => connectionCtx.connection.rpc.handle(OLLAMA_RPC_CHANNEL, handler), "llm-ollama: RPC channel")
  })
  ```

  ⇒ 按 F2，**它的通道现在能工作，是因为那一行被拓宽了**（拓宽者是上面两个插件里的任意一个）。
  **已实测**（`research/f7-parallel-probe.md`）：那一行还原成 `[webRuntime]` 后，`/ollama-cloud` → **404**，
  且它**一行日志都没有**（无 try/catch）。
  **更正**：只卸载本插件**不会**让那一行退回窄值 —— `dsh-plugin-ollama-usage` 的 patch 同样写宽值，
  只有两个都卸载才会退回。

### F7. 决定性实验：**已执行**（2026-09-16）→ 覆盖**必需**

做法换成**并行实例**，因此不再需要重启（重启会结束 agent 自身进程）：新起一个 `dsh --profile web`，
用 `--patch` 叠加层把 `connection.inject` 写回出厂 `[webRuntime]`，再探同一批路由。
完整命令、原始日志、局限见 `research/f7-parallel-probe.md`。

| 路由 | 对照：活实例（行 = 宽值） | 实验：新实例（行 = 出厂窄值） |
|---|---|---|
| `/trellis-statusline` | 401 | **404** |
| `/ollama-usage` | 401 | **404** |
| `/ollama-cloud` | 401 | **404** |
| `/api`（出厂共享路由） | 401 | 401 |

boot log 两行：`[ollama-usage] RPC channel unavailable: cannot get property "webServer" without inject`、
`[trellis-statusline] …`（原文同）。

⇒ **覆盖必需**：pill 依赖的通道在窄值下根本不存在（通道死 ⇒ pill 必然不显示），
二分问题由通道层证据取代。R2 的选项因此收敛为「保留 + 文档化 / 挪到 profile patch / 采用 F8 方案」。
顺带确认：**插件自己那行声明 `webServer` 对通道注册无效**（两个插件都声明了，窄值下照样抛错）——
变量只落在 `connection` 那一行上。

### F8. 两条"零覆盖"的候选方案（代价已实测/已界定）

| 方案 | 是否还需改 `connection` 行 | 代价（实测） |
|---|---|---|
| **现状**：走 `connection.rpc` 私有通道 | 需要 | 覆盖语义带来的组合脆弱（当前实测**零冲突**） |
| **(b) host 直接用 `ctx.webServer.register()` 开自己的路由** | **不需要**（本插件已注入 `webServer`） | **（2026-09-16 更正）** 栅栏**可直接调用**：host 半边的 `ctx.connection.requestRejection(req) → 401/403/undefined` 是**公开接口**，其 JSDoc 原文即 *“Apply Connection's Host/Origin checks and browser authentication to another Web route”*；shipped `dsh-host-open-in-app` 的三条路由每条都先问它。⇒ 旧代价「自己开路由 = 绕开栅栏，除非自己实现」**作废**；剩下的代价只是自造信封 + 方法/JSON 校验（我们本来就有 `{ok, value}`）。**这条就是官方模式** |
| **(c) 客户端改用 `ctx.remote.workspaceFiles` 直接读 `.trellis/`** | **不需要**（不开任何路由） | 调用形状抄自 shipped `dsh-client-ui-sidebar-files`：`await remote.workspaceFiles.list(sessionId, path, signal)` → `{ok, value}`（另有 `read`/`stat`/`readAll`/`changes`）。代价：每轮 **1 次调用 → N+1 次**（1 次 list + 每个 `task.json` 一次 read）；Trellis 解析与建树（约 120 行）连同 host harness 的断言一起搬到浏览器半边；依赖一个"工作区文件浏览"语义的 Remote，而 profile 里有一行 `fs-observation-policy` —— **Remote 读是否受其管辖未验证** |

> 注（2026-09-16）：F8 的 (b) 之所以可行，是因为**插件行自己**的 `inject` 让它能**直接**读 `ctx.webServer`；
> 这与 F2/F7 的「route 注册用 connection 行的 ctx」是两件事：直接调用 vs 经 `connection.rpc` 转手。
>
> 网络调研补充（见 `research/webserver-official-usage.md`）：(b) 已升级为**路径① = 官方模式**；
> 上游 shipped 代码里 `connection.rpc.handle` **0 用户**（只有 `dsh-api-gateway` 用独占的 `rpc.intercept`）；
> 上游 Discussions #3186 / #4364 都在讨论「webServer 缺请求级 seam」，属**已登记的已知缺口**。

### F9. 同一批轮次里的其它未决事项

- **README 重构未提交**：改成用户优先（安装在第三节）+ 新增 `docs/design-notes.md` + `files` 纳入 `docs`；
  三处改动都在**子模块**里，未 commit（`AGENTS.md` 要求提交需明确同意）。
- **仓库与子模块**：`https://github.com/CJ-SH/dsh-plugin-trellis-statusline`（public，已推 `90cf9e3`）；
  meta-repo 已注册为子模块（`b6105cf`）；`.gitmodules` 用的是 HTTPS URL，与 `dsh-plugin-ollama-usage`
  的相对路径写法不一致，用户尚未表态。
- **npm 未发布**：元数据已齐（`repository`/`keywords`/`license`/`files`）；`npm whoami` → `ENEEDAUTH`。
  已记录的判断：**只有需要"按名安装"时才必须发 npm**；市场发现走各自 catalog，发布不等于被收录。
- **可选未做**：README 截图（已留注释形式的图片块）、`README.zh.md`、`.github/workflows/test.yml`。
- **安全**：两个 PAT 曾以明文出现在会话里（`github_pat_…` fine-grained、`ghp_…` classic 带 `repo` scope）
  —— **两个都应 revoke**。
- **spec 已删**：`minimumReleaseAge` 那条历史教训（实测 `pnpm config get minimumReleaseAge` → `undefined`，
  前提不成立）。`09-14-ollama-usage-entry/research.md`（归档任务）里的同名记录未动。

### F10. 平台契约的官方出处与同类用法（2026-09-16 网络调研）

详细调研与全部链接：`research/webserver-official-usage.md`（官方文档 / 上游 master 源码 JSDoc / shipped 包 / 社区插件 / Discussions）。

- **webServer 官方定位**：浏览器 HTTP 载体，"not a capability seam"，**自己不做鉴权**；原文「另一个插件注册每一条功能路由」。
  栅栏的公开接口是 host 半边的 `requestRejection(req) → 401 | 403 | undefined`（JSDoc 明说用于 *another Web route*）。
  `dsh-host-webserver` 自身"owns no TLS, authentication, or Origin policy"。
- **同场景的官方模式（路径①）**：自己的行 inject `['webServer', 'connection']` → 自己 `ctx.webServer.register` →
  每请求先 `requestRejection`。shipped `dsh-host-open-in-app` 三条路由就是这么写的，**零 patch**。
- **路径③（我们走的 `connection.rpc.handle`）**：上游 JSDoc 是 "Register one authenticated absolute channel prefix"，
  接口形状 `(channel, handler)`，**无 caller-ctx 参数**；实现里 `owner = this.ctx`（= connection 行的 ctx）。
  shipped 包 **0 用户**；社区同类 `filestab` 连 `cordis.patch.yml` 都不带（`ctx.get` 软取 + try/catch 静默降级）。
- **"只能整行重述"是官方语义**：publish 指南原文「patch 会替换目标行的整个 config 值，而不是深度合并各键……必须重述该行
  需要的每一个键」，并点名 `dsh-web-app` 覆盖 `dsh-base` 就是这样；`packages/bundle/web-app/cordis.patch.yml` 头注释同款。
  `insert:` 只能增量加「行」；「行内列表字段追加」在上游无操作符、也无提案。
- 社区经验帖 #3472 与本次实测吻合：仓库外插件必须自带 `dsh.bundle.patch`（否则不激活层）；module 级 `inject` 必须是数组；
  「读即拒」在 `inject` 之外无法防御性探测。

## 更正记录

- 2026-09-16：F6「25 个 patch 文件里只有 1 个碰 `connection`」→ 实测 **47 个里 2 个**，且两个写的值相同。
- 2026-09-16：F6「卸载本插件会让那一行退回 `[webRuntime]`」→ **只有两个都卸载才会**。
- 2026-09-16：F6「llm-ollama 的依赖未实测」→ **已实测**：窄值下 `/ollama-cloud` 404 且无日志。
- 2026-09-16：F2 补充直接证据 —— 插件行**自己**声明 `webServer` 对通道注册**无效**。
- 2026-09-16：F7 由「尚未执行」→ **已执行**（并行实例探针），结论：覆盖**必需**。
- 2026-09-16：F8 补注 —— (b) 的可行性来自插件行自己的 `inject`（直接读），与 F2/F7 的转手路径不同。
- 2026-09-16：**F8 的 (b) 代价作废** —— `connection.requestRejection` 是公开接口（shipped `dsh-host-open-in-app` 在用），
  自己开路由**不会**绕开栅栏；该方案因此升格为官方模式。
- 2026-09-16：R2 决策 = ③ 并已实现：`npm test` **197/197**；`dsh --profile web --dump-config` 实测 `connection` 行的
  patch 归属**只剩** `dsh-plugin-ollama-usage`（本插件不再碰它，宽值因此不变，llm-ollama 不受影响）。
- 2026-09-16：R6 完成后**上一条的推论作废** —— 两个插件都不再拓宽，`connection` 行回到出厂
  `inject: [webRuntime]`（dump-config 实测）。并行实例实测：第三方 `dsh-llm-ollama` 的 `/ollama-cloud` → **404**
  （它同样把通道注册在那一行上，且没有 try/catch、连日志都没有）；我们的两条新路由不受影响（401）。
  缓解与出处：把拓宽写进 **profile patch**（`~/.dsh/profiles/web/cordis.patch.yml`，单一所有者 = 官方层级顺序里的
  用户层），一行即可 —— 是否采用见 Q7。
- 2026-09-16：新增 F10（官方出处 + 同类用法 + 上游 Discussions #3186/#4364/#3472 + publish 指南的整行覆盖语义）。

## 需求

- **R1** ~~执行 F7 的决定性实验~~ **已完成（2026-09-16）**：改用并行实例 + `--patch` 探针，
  命令、原始日志、对照表见 `research/f7-parallel-probe.md`；浏览器目视未做（通道层已断言 pill 必不显示）。
- **R2** 依实验结果决策。F7 已排除「删除覆盖」，候选为：
  ① **保留 + 文档化**（现状，代价：跨插件隐式耦合）；
  ② **把拓宽挪到 profile patch**（零覆盖但需用户手动一行，单所有者）；
  ③ **(b) 改走官方模式**：自己 `ctx.webServer.register` + 每请求 `connection.requestRejection`（零覆盖，需改 host+client 两半）；
  ④ **(c) 客户端改用 `remote.workspaceFiles`**（不开路由，需实测 `fs-observation-policy`）。
  **决策（2026-09-16，用户确认）：选 ③**（接受「自造信封 + 方法/JSON 校验」的代价）。
  **已实现**：先写 `design.md`（取舍表）与 `implement.md`（清单），再改子模块 `dsh-plugin-trellis-statusline`：
  host 自开 `exact` 路由 + 每请求 `requestRejection`（该 seam 缺失则 503 fail-closed）、client 改 `fetch`、
  `cordis.patch.yml` 删除 `connection` 覆盖。
- **R3** ~~把 F2–F5 的平台契约写进 spec~~ **已完成（2026-09-16）**：`halves-contract.md` 新增
  「Channel or own route」小节（两条路径对照 + 本轮实测证据 + 上游出处），并更正原来「`webServer` 是间接需要」
  的说法 —— 插件**自己**的声明不足以让 `connection.rpc` 通道生效。
- **R4** **未选 ④，故不做**（将来若改走 `remote.workspaceFiles`，先实测 `fs-observation-policy` 是否拦 Remote 读）。
- **R5** 对 F9 里的未决事项给出取舍（或明确列为范围外）。
- **R6（用户新增 2026-09-16）** ~~`dsh-plugin-ollama-usage` 要不要做同样改造？~~ **已完成**：
  host 半边自开 `prefix` 路由 `POST /ollama-usage/<endpoint>` + 每请求 `requestRejection`（缺 seam 则 503），
  端点仍在路径里、请求体走 JSON（`405`/`415`/`400` 校验齐备）；client 半边改 `fetch` 并去掉 `connection`；
  `cordis.patch.yml` 删除 `connection` 覆盖。自检 **87/87**（host 44 · client 27 · card 10 · hero 6），README 同步。

## 验收标准

- **AC1** ✅ F7 的证据（命令 + 观测 + boot log 原文）在 `research/f7-parallel-probe.md` 与 `research/evidence/`。
- **AC2** ✅ `npm test` **197/197**（原 192；新增栅栏 / 方法 / 校验断言），README 的 override 小节已改写成
  「No other bundle’s row is touched」，`docs/design-notes.md` §4 已改成路由 + 栅栏契约。
- **AC3** ✅ `design.md` §2 取舍表（①–④ 与被否理由）落盘在前，代码改动在后。
- **AC4** ✅ spec 增补全部来自本轮实测 / 上游原文；旧结论错误处已就地更正。
- **AC5（新增 · 真机目视）** ⏳ 待用户重启 dsh 后确认 pill 仍在 —— 本次上线唯一未做的端到端验证。
- **AC6（R6）** ✅ 两个插件都不再 patch 别人的行；`dsh --profile web --dump-config` 实测 `connection` 行回到出厂
  `inject: [webRuntime]`。并行实例实测（无任何 `--patch`）：`GET /trellis-statusline/task/read` → **401**、
  `POST /ollama-usage/config/read` → **401**、`GET /api` → 401、`GET /no-such-route` → 404。

## 范围外

- 改 statusline 的功能/UI（父任务已验收通过）。
- 改 dsh 或 Trellis 上游。
- 发布到 npm（独立决策，需 `npm login`）。
- 清理 `09-14-ollama-usage-entry/research.md` 里的归档记录。

## 阻塞性待决问题（已收敛，2026-09-16）

- ~~**Q1** 先跑 F7 还是直接换方案？~~ → 已跑（并行实例探针，无需重启）。
- ~~**Q2** 保留 bundle 自带 patch 还是挪到 profile patch？~~ → 两条都不选，改走路径 ③（不再需要覆盖）。
- ~~**Q3** (b) 能否接受未鉴权的本机路由？~~ → 前提有误：`requestRejection` 可直接调用，(b) 即官方模式。
- ~~**Q4** (c) 是否值得？~~ → (c) 未选，问题消失。
- ~~**Q5** `dsh-plugin-ollama-usage` 要不要做同样改造？~~ → 用户已决定「一起改」，见 R6（已完成）。
- **Q7（新）** `dsh-llm-ollama` 的 `/ollama-cloud` 通道随窄值一起失效（实测 404），要不要在
  `~/.dsh/profiles/web/cordis.patch.yml` 保留一行拓宽（该插件的设置 / 模型发现界面依赖它）？
- **Q6（新）** 本次改动未提交（`AGENTS.md`：提交需用户明确同意）；父任务 README 重构等未提交改动也仍在。
## 发布与仓库收尾（2026-09-16 本轮）

- **README review**：两个插件的 README 都已按「用户优先」复核并修完 —— statusline 修正断言数（192 → 197）与
  一段排版；ollama-usage 整篇重写（一句话简介 + 示例、要求、安装/卸载、两种凭据模式、取数口径、
  「不碰别人的行」、数据保留、结构/自检、故障排查、License），断言数与实现同步（87/87）。
- **发布元数据**：ollama-usage 补 `LICENSE`、`author`、`keywords`、`repository`、`files`（含 LICENSE），
  并**删掉 `private: true`**（它会直接阻止 npm 发布）；`npm pack --dry-run` 两个包都通过（7 / 6 个文件）。
- **GitHub**：新建 `CJ-SH/dsh-plugin-ollama-usage`（public，默认分支 main）并推送 `65fc19f`；
  `CJ-SH/dsh-plugin-trellis-statusline` 推送 `90a4aa1`；两个仓库都加了 topics，README 匿名可读。
- **meta 仓库**：`.gitmodules` 把 ollama-usage 的 URL 从相对路径改为 HTTPS（与另一个一致）；
  新增 `.gitignore`（忽略 `.scratch/`）；子模块指针与任务/spec 记录一起提交 `997a8c6`（meta 仓库无 remote，故不推送）。
- **npm 仍未发布**：本机没有 npm 凭据（`npm whoami` → ENEEDAUTH，`~/.npmrc` 无 token），`npm publish --dry-run` 明确要求先登录。
  两个包已发布就绪，发布只差一步（二选一）：
  `npm login` 后跑 `cd <pkg> && npm publish --access public`，或给一个 npm automation token 由我发布。
- **安全**：本轮使用的 GitHub PAT（classic，`repo` 等 scope）已出现在会话里 —— 用完请 revoke；
  连同 F9 记录的两个旧 PAT 一起处理。
