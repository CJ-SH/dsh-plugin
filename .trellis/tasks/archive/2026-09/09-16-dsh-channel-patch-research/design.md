# design.md — 去掉 connection 覆盖：改走官方「自开路由 + 栅栏」模式

> 决策与取舍（AC3 要求先落盘再改代码）。事实依据：`prd.md` F1–F10、`research/f7-parallel-probe.md`、
> `research/webserver-official-usage.md`。

## 1. 决策

把 `dsh-plugin-trellis-statusline` 的 host→client 私有通道，从 **`connection.rpc.handle`** 改为
**自己的 `ctx.webServer.register` 路由 + 每请求 `ctx.connection.requestRejection` 栅栏**，并**删除 `connection` 行的覆盖 patch**。
这条路径与 shipped `dsh-host-open-in-app` 完全同构（官方模式），**零覆盖**。

## 2. 取舍表（含被否理由）

| 方案 | 覆盖 `connection` 行 | 栅栏 | 否决 / 采纳理由 |
|---|---|---|---|
| ① 现状：`connection.rpc.handle` + bundle 覆盖 | 需要 | 自动（`register()` 内部调 `requestRejection`） | **否**：物理路由注册在 **connection 行的 ctx** 上（F2/F7 实测），于是"能不能注册通道"取决于那一行的 `inject`；组合语义下（F5）任何写回窄值的层都会让本条通道**静默失效**，且上游 shipped 代码 0 用户这么用（F10） |
| ② 把拓宽挪到 profile patch | 不再由我们写（用户手动一行） | 同 ① | **否**：仍是路径 ③ 的注册语义，问题只是从"插件写"挪到"用户写"；且用户漏写就静默失效 |
| ③ **自开路由 + `requestRejection`（本方案）** | **不需要** | **显式调用公开接口**（JSDoc：*apply … to another Web route*） | **采纳**：与 shipped `dsh-host-open-in-app` 同构；401/403 与 ①**同源**（同一个 `requestRejection`）；本插件在自己的 ctx 上注册，与任何插件的 patch 解耦 |
| ④ 客户端改 `remote.workspaceFiles`（不开路由） | 不需要 | 由 Remote 网关承担 | **否（暂）**：每轮 1 次调用 → N+1 次；Trellis 解析与建树（约 120 行）要搬进浏览器半边；且 `fs-observation-policy` 是否拦 Remote 读**未实测**（R4） |

采纳 ③ 的已知代价（用户已确认接受）：**自造信封 + 方法/请求体校验**（不再由 connection 代劳），外加一条自己的路由前缀要占。

## 3. 架构与数据流

```
browser (client half)                         host (host half)
  fetch(GET /trellis-statusline/task/read?sessionId=…)
        │  same-origin cookie
        ▼
  webServer 具名路由  ──►  requestRejection(req)  ── 401/403──► 结束
                                    │ undefined
                                    ▼
                          方法检查(405) → 查询校验(400) → readTask()
                                    ▼
                          200 {ok:true,value} | 200 {ok:false,error}
        ┌───────────────  JSON 解析（ok!==true ⇒ 无 pill）
        ▼
  pill / 无 pill（静默降级）
```

- host 半边新增两条依赖用法：`ctx.webServer.register`（注册路由）、`ctx.connection.requestRejection`（栅栏）。`sessions` 用途不变。
- client 半边**不再需要 `connection` 服务**（不再 `rpc.call`）→ 从 client 半边 `inject` 里移除；改用页面 origin 上的相对 `fetch`。

## 4. Wire 契约（新）

| 项 | 值 |
|---|---|
| 路由 | `{ kind: "exact", path: "/trellis-statusline/task/read" }`（唯一路由，唯一端点） |
| 方法 | 仅 `GET`（其他 → `405` + `Allow: GET`） |
| 入参 | 查询串 `sessionId`：非空字符串且 ≤ 128 字符（否则 `400`） |
| 出参 | `200 application/json; charset=utf-8`，body 沿用既有信封：`{ok:true,value}` / `{ok:false,error:{code,message}}`（**保留信封**：client 与两个 harness 的解码逻辑不变） |
| 响应头 | `cache-control: no-store`（会话/任务状态是实时事实） |
| 栅栏 | **第一步**调 `ctx.connection.requestRejection(req)`：`401` → body `unauthorized`，`403` → `forbidden`（与 connection 自身逐字一致） |
| 围栏不可用 | `requestRejection` 不是函数 ⇒ **fail closed**：`503` + 一行 `console.error`（绝不无鉴权放行） |
| 注册失败 | `register` 抛错（同 `(kind,path)` 重复）⇒ `try/catch` + 一行 `console.error`，插件其余部分照常加载（沿用"降级为无 UI，不阻断 boot"的既有原则） |

## 5. 改动清单（文件级）

| 文件 | 改动 |
|---|---|
| `lib/index.js` | 删 `rpc.handle`；新增路由常量、`routeHandler`、`sendJson`/`reject` 小工具；`inject` 注释重写（`connection` 的用途从"间接原因"变成"栅栏"）；`apply` 改为 `ctx.effect(() => ctx.webServer.register({…}))` |
| `lib/client.js` | `request()` 从 `rpc.call` 换成 `fetch`（含 `hostBase()` 助手，镜像 shipped `dsh-client-ui-open-in-app` 的写法）；client `inject` 去掉 `connection` |
| `cordis.patch.yml` | 删掉 `- id: connection` 覆盖块（连注释一起）；只留 `insert:` 自己的行 |
| `README.md` / `docs/design-notes.md` | 删掉"需要覆盖 connection 行"的小节，改述官方模式 |
| `test/host.test.mjs` | harness 改为假 `webServer.register` + 假 `requestRejection` + 假 `req/res`；新增栅栏/方法/校验/注册失败断言 |
| `test/client.test.mjs` | 桩从 `connection.rpc.call` 换成 `globalThis.fetch`；断言 URL/方法/头/非 200/坏 JSON |
| `test/integration.test.mjs` | 假 rpc 桥换成"捕获路由 + 假 fetch 打到该 handler"的端到端路径 |
| `.trellis/spec/.../halves-contract.md` | R3：写入 F2–F5 + 本次契约（含 file:line 锚点） |

## 6. 测试策略

- **host 层**：路由形状（kind/path）、栅栏最先（401 时不碰 `sessions`）、`405`/`Allow`、`400`（缺 `sessionId` / 超长）、`200` 信封、`no-store`、卸载时 disposer 被调用、注册抛错时只降级不抛出。
- **client 层**：请求形状（相对 URL、`accept: application/json`、同源凭据默认）、`res.ok=false` ⇒ 无 pill、`ok:false` ⇒ 无 pill、JSON 解析异常 ⇒ 无 pill、`ok:true` ⇒ 出 pill。
- **跨半契约（既有断言保留）**：client 调用的端点集合 == host 处理的端点集合。
- 全量命令：`npm test`（当前 192 条，必须全绿）。

## 7. 兼容性与回滚

- **对其它插件**：删掉我们的覆盖后，`connection` 行仍为宽值（`dsh-plugin-ollama-usage` 写同值，F6/F10 实测）——`dsh-llm-ollama` 与 `ollama-usage` 的通道**不受影响**；只有"两个插件都卸载"才回到窄值。
- **版本兼容**：`requestRejection` 在本机 0.1.5-rc.2 存在，且在上游 `HostConnectionHandle` 接口上有 JSDoc；契约变更时按 §4 的 fail-closed 处理（503 + 静默无 UI），不会降级成"无鉴权对外"。
- **回滚**：单次 revert 即回到方案 ①；回滚后本插件重新依赖"那一行是宽的"（今天成立）。

## 8. 风险与未验证

- `requestRejection` 不是能力 seam 级契约（webServer 文档明说不是 seam），属"公开但可能变"的面；fail-closed 兜底。
- 路由前缀冲突：`/trellis-statusline` 是我们的具名空间，`(kind,path)` 重复会抛错 —— 与任何 shipped 路由不冲突（shipped 用 `/api`、`/open-in-app`、`/git` 等）。
- 未做浏览器目视：改完后 pill 是否出现仍需真机确认（AC1 已由通道层证据替代为 F7 的结论，但本方案上线需一次重启目视）。

## 10. 追加：`dsh-plugin-ollama-usage` 的同款改造（R6，2026-09-16）

同一个决策落在另一个插件上，差异只在「一条路由怎么承载六个端点」：

| 项 | 取值 |
|---|---|
| 路由 | `{ kind: 'prefix', path: '/ollama-usage' }`，端点放路径里：`POST /ollama-usage/config/read` |
| 方法 | 仅 `POST`（含写端点，统一一种方法最省校验）→ 其他 `405` + `Allow: POST` |
| 媒体类型 | 必须 `application/json` → 否则 `415` |
| 请求体 | 有界 JSON 对象（64 KiB 上限）；缺失 / 超限 / 非 JSON 一律 `400 bad-request` |
| 端点白名单 | `ENDPOINTS` 六个，未知 → `404` + `unknown-endpoint` 信封 |
| 栅栏 | 与 statusline 相同：`requestRejection` 最先，缺 seam → `503` fail-closed |
| 响应 | `{ok,value}` / `{ok,error}` 信封不变 + `cache-control: no-store` |

client 半边：`rpc.call` → `fetch`（`POST` + JSON body），`inject` 去掉 `connection`。

**副作用（实测）**：两个插件都停止拓宽后，`connection` 行回到出厂 `inject: [webRuntime]`，第三方
`dsh-llm-ollama` 的 `/ollama-cloud` 通道随之 `404`（它仍走 `connection.rpc`，且无 try/catch、无日志）。
缓解是**官方层级顺序里的用户层**：`~/.dsh/profiles/web/cordis.patch.yml` 写一行 `- id: connection` +
`inject: [webRuntime, webServer]`（单一所有者；见 F5 / F10）。是否加由用户决定（PRD Q7）。

## 9. 明确不做（YAGNI）

- 不做前缀路由/多端点路由器（当前只有一个端点）。
- 不做 `POST`、不做请求体（读操作只用 `GET` + 查询串）。
- 不引入压缩、SSE、上传等（与 pill 无关）。
- 不改 `dsh-plugin-ollama-usage`（它自己的同类改造是另一个任务/仓库范围）。
