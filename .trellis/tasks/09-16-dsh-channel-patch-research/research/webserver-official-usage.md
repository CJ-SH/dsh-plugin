# webServer 官方定义与用法调研（2026-09-16，网络 + 上游源码）

> 目的：回答「这么重要的能力为何要插件自己 patch、且只能整行覆盖；我们的用法是不是错的 / 非最佳实践」。
> 结论均带出处：官方文档 / 上游源码 / shipped 包 / 社区插件 / 上游 Discussions。

## 1. webServer 的官方定义

**官方文档**：https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-server
（源码 `packages/host/webserver/src/index.ts`；本机副本 `$DSH/node_modules/@deepseek-ai/dsh-host-webserver`）

- 定位：the browser HTTP carrier for the GUI host … **It is not part of the agent loop and not a capability seam**;
  it knows no harness concepts, and **another plugin registers every feature route**, including the `/api` bridge,
  plugin bundles, and the HMR event stream.
- 服务面：`register(route) → disposer`、`registerUpgrade`、单一所有者的 `registerFallback`、
  `tapIndex` / `renderIndex` / `collectIndexInjections`、`port`、gzip。
- 匹配顺序：exact 表 → 最长 prefix → fallback；**同名 `(kind, path)` 重复注册直接抛错**；
  fallback 席位 one owner only, a second registration throws。
- **它自己不提供任何鉴权**（原文）：The carrier itself owns no TLS, authentication, or Origin policy, so a
  non-loopback bind exposes the server unless the composition supplies those controls. … **its Connection plugin
  supplies Host/Origin checks plus browser-session authentication for every Host API route and stream.**

**栅栏的官方接口（关键）**：`dsh-client-connection` host 半边公开
`requestRejection(request) → 403 | 401 | undefined`；上游 master `packages/client/connection/src/rpc.ts` 的 JSDoc
写的就是给这个场景用的：

> Apply Connection’s Host/Origin checks and browser authentication to **another Web route**.
> @returns rejection status, or undefined when the route may accept the request.

（同一接口面还有 `fetch.register`（exact Fetch 路由）、`rpc.handle`、`rpc.intercept`、`createSharedFetchHandler`、
`authorizeIndex`、`authenticatedUrl`。）

## 2. 上游 / 社区实际怎么用（三条路径）

| 路径 | 谁在用 | 是否要 patch 别人的行 | 栅栏 |
|---|---|---|---|
| **① 自己的行 + 自己 `ctx.webServer.register` 路由 + 每请求 `connection.requestRejection`** | **shipped**：`dsh-host-open-in-app`（3 条路由）、`dsh-host-directory-picker-auto`、`dsh-host-frontend-static`（fallback 席位）、`dsh-webhook-github`（自验签，不用栅栏）；社区：@linxin666 全家桶（自己写 access 判定，多数**不**注入 connection） | **不需要** | 调 `requestRejection` 即与官方一致 |
| **② Typert Remote（`@Remote`）+ API Gateway `/api/remote.mux`** | shipped 的 `dsh-api-*` 业务包（如 workspace-files） | **不需要** | 网关自带（共享 `/api` 通道） |
| **③ `connection.rpc.handle(channel, handler)`** | shipped：**0 个**（只有 `dsh-api-gateway` 用独占的 `rpc.intercept(/api)`）；社区：`filestab`、`dsh-llm-ollama`、**本仓库两个插件** | **需要**（物理路由落在 connection 行的 ctx 上） | 自动（`register()` 内先过 `requestRejection`） |

`rpc.handle` 的上游 JSDoc（master `HostConnectionRpc`）：**Register one authenticated absolute channel prefix.**
接口形状是 `(channel, handler)`，**没有 caller-ctx 参数**；实现里 `const owner = this.ctx` → 注册语境固定在 connection 那一行。

**同类社区插件（`filestab`，npm）的处理方式与我们的差别**：

- `const inject = []` —— No hard `inject`. The code reads connection / sessions / sandboxPolicy lazily.
  connection is absent in tui/headless profiles, so the surface no-ops there.
- 用 `ctx.get(connection)` 软取 + **try/catch 静默降级**，并用 `ctx.on(internal/service, …)` 等 connection 后到；
- **不 ship `cordis.patch.yml`**（npm 包里没有该文件）⇒ 在窄值 profile 上它会静默失败（与 F7 实验一致）。
  （版本提醒：filestab 传了第三个参数 `{}` 并注释 `register()` reads `options.authority`，而本机 0.1.5-rc.2 的 `handle` 只吃两个参数，
  它面向的可能不是这一版；对比只作参考。）

## 3. 上游 Discussions（论坛）

- **#3186「webServer middleware layer (ctx.webServer.use): a request-level seam so plugins can guard /api」**
  https://github.com/deepseek-ai/deepseek-harness/discussions/3186
  原文要点：**Third-party plugins currently cannot apply any request-level policy on the shared `/api` channel.
  Three paths, all closed**：① `register({kind:prefix, path:/api})` 重复注册抛错（connection 已占）；
  ② `connection.rpc.intercept(/api, …)` 只收 `(endpoint, payload, signal)` —— **没有 headers / cookies / socket 事实**，
  且拦截器席位独占、WS upgrade 绕过；③ 用 exact 路由逐个遮蔽是 fail-open。
  实测事故：某社区插件的配对门（unpaired devices get 403 on every /api call）因上游从未 emit `api/gate` 而成死代码，
  在 `--trusted-host <tunnel-domain>` 部署下未配对浏览器拿到完整 200。⇒ 「栅栏不是鉴权层」是文档化的正确说法，但插件无处放鉴权层。
  提案：`ctx.webServer.use()` 中间件链。
- **#4364「Upstream proposal — draft」**（yyyq0325-ai，2026-08-24）
  https://github.com/deepseek-ai/deepseek-harness/discussions/4364
  原文要点：webServer exposes three composition seams: named routes (register), a single fallback seat (registerFallback),
  and index transforms (tapIndex). **All three are registration-time extension points. There is no request-time seam.**
  `/api` 已由 client-connection 以 named prefix route + `registerUpgrade` 占用（Route registration refuses duplicates by design,
  and longest-prefix-wins means shorter routes cannot shadow it — correctly so），并列出被否方案（monkey-patch 运行中的实例等）。
  提案：`webserver/request` waterfall 事件（等价中间件）。⇒ **「缺少请求级 seam」是上游已登记的已知缺口。**
- **#3472「Field notes from shipping a third-party plugin: dsh.bundle, the module table, and three ways I broke my own boot」**
  https://github.com/deepseek-ai/deepseek-harness/discussions/3472
  第一手经验，两条与本次直接相关：① 仓库外的插件**必须**自己 ship `dsh.bundle.patch`（否则只作为普通依赖安装，不激活任何层）；
  ② module 级 `inject` 必须是**数组**，对象形式会被当成服务名逐键读取（cannot get property … without inject），
  作者原话：**check whether the service exists is not something you can do defensively from outside inject** —— 与 F2 的「读即拒」一致。
- 社区指南 https://dshplugins.co/en/dsh-plugins-guide/：A running dsh is a plugin tree composed of patch layers applied in order.
  Understand the order and you can change any row — **including rows inside someone else’s plugin**.（改别人的行是被认可的做法，代价自负。）
- 社区补位者：https://github.com/kolawong/dsh-plugin-auth-webserver（给整个 Web 面加登录页 / 签名 cookie / Basic Auth + WS upgrade 覆盖）
  —— 「插件无处放鉴权层」这一缺口的第三方式答案。

## 4. 「只能整行重述、没有增量」—— 这是官方语义，不是我们写错

官方 publish 指南（https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish）原文：

> 后应用的层按行胜出，且 patch 会替换目标行的整个 `config` 值，而不是深度合并各键。这给组合包作者带来两个推论：
> 1. 你的 patch 可以按 id 覆盖前面各层的行——**就像 dsh-web-app 组合包覆盖 dsh-base 的行那样**——
>    但必须重述该行需要的每一个键，而不是只写改动的那个。
> 2. 用户可以在自己 profile 的 `cordis.patch.yml` 中覆盖你的行，无需改动你的包……

官方 bundle 自己也这么写（`packages/bundle/web-app/cordis.patch.yml` 头注释）：
**A patch replaces the targeted row’s whole `config`, so each row below restates every key it owns.**

层级顺序（官方）：profile 的 `dsh.profile.bundles` 各 bundle patch（按列表序）→ profile 自己的 `cordis.patch.yml`
→ `$DSH_HOME/cordis.patch.yml` → 各 `--patch` overlay（按 argv 序）。
**`insert:` 能增量加「行」；缺的只是「行内列表字段的追加操作符」**（上游既无该需求记录，也无相关提案）。

## 5. 结论：我们的写法错在哪、不错在哪

- **不算错**：整行重述是官方语义，shipped 的 `dsh-web-app` 覆盖 `dsh-base` 就是这么干的。
- **真正的选型问题是路径 ③**：`connection.rpc.handle` 把物理路由注册在**别人的行**（connection 行）上，于是
  「第三方插件能否注册通道」取决于那一行的 `inject`，而不是取决于插件自己 —— 这既制造跨插件隐式耦合（F5/F6/F7），
  又让我们的可用性绑在别人的 patch 上。上游 shipped 代码**无人**这么用；社区唯一的同类（filestab）选择「软取 + 静默降级 + 不带 patch」。
- **官方对本场景（host 插件 + 浏览器半边）的既定模式是路径 ①**：自己的行 inject `[webServer, connection]` →
  自己 `ctx.webServer.register` → 每个请求先 `ctx.connection.requestRejection(req)`（公开接口、有 JSDoc、shipped 包在用）。
  **零 patch**，栅栏与现在同源（401/403 完全一致），请求体 / 信封由自己定义（我们本来就有 `{ok, value}` 这套）。
- 因此 F8 的 (b) 代价被修正：**不需要自己实现鉴权**（`requestRejection` 可直接调用），它从「绕开栅栏」变成「官方模式」。
  路径 ②（Typert Remote）更「正统」但需要生成式 descriptor / codegen，与零依赖无构建的定位冲突；shipped open-in-app 明确记录过
  为何用 raw webServer 路由而不是 Typert Remote（二进制图标不适合 JSON RPC；`dsh-webhook-github` 已立 validated-raw-route 先例）。

## 6. 局限

- 上游 master 可能已变动：`HostConnectionRpc.handle` 的**接口形状未变**（仍无 caller-ctx 参数），但本机装的是 0.1.5-rc.2，
  所有实测结论按这一版记账；master 的 `get rpc()` 实现文件未取到（GitHub 匿名 API 限流 403），未做逐行 diff。
- 社区对比带版本不确定性（见 filestab 的第三参数注释）。
- `requestRejection` 在 `HostConnectionHandle` 接口上有 JSDoc，属公开面，但**不是**能力 seam 级契约（webServer 文档明说它不是 seam）。
