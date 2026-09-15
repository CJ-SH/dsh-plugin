# design.md — Trellis statusline（dsh web 插件）

> 技术设计。决策依据见 `prd.md`（D1 口径、D2 席位、证据清单）。

## 1. 架构与边界

两半插件，沿用本仓库既有形态（对照 `dsh-plugin-ollama-usage`）：

| 半边 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 只读文件系统：dsh 会话 → 工作区 → Trellis 任务；提供私有 RPC |
| Client | `lib/client.js` | module-loader bundle：注册 1 个 cell 到 `conversation.session.header.utilities`，渲染/轮询 |
| 清单 | `package.json` + `cordis.patch.yml` | loader 行插入、`dsh.client` 平台与注入 |

约束（来自仓库 spec 的硬约束）：`export const inject` 必须声明（host 至少
`['connection', 'webServer']`，client 至少 `['slots', 'connection', 'timer', 'locale']`）；
`apply` 绝不抛（可选面用 try/catch 降级为"少一个 UI"）；零依赖、无构建步骤；
bundle id = 包名；`slots.register` 的 `name` 是槽键、`id`/`key` 是自身单元格。

## 2. 数据流与契约

```
client cell (props: sessionId, t)
  └─ ctx.connection.rpc.call('/trellis-statusline', 'task/read', { sessionId })
       host: ① sessionId → cwd  ② 会话指针  ③ 工作区扫描  ④ 空
  ← { ok:true, value: { status:'ok', task:{ id,title,status,priority } } | { status:'none' } }
```

### 2.1 sessionId → cwd（步骤 0 实测结论，2026-09-15 复核）

> 三项复核全部通过，且结果**好于规划时的假设**：会话身份在四处是同一个值，
> host 侧 cwd 有两条同步可用路径，不需要 slug 反解。

**结论 A — `sessionId` 与磁盘目录名、Trellis 指针键完全相等。**
同一会话 `session-66d44746-abbf-4a3d-bd21-a9374eae2bd1` 在四处出现同一字符串：

| 位置 | 观测值 / 出处 |
|---|---|
| client 席位 prop | `standardProps` 含 `sessionId: SessionId`（`conversation.session.header.utilities` 契约） |
| 工具进程环境变量 | `DSH_SESSION_ID=session-66d44746-…`（本机 `pwsh` 实测）；`dsh-shell-env/lib/index.js:85` 由 `execution.agent.session.header.id` 赋值 |
| 磁盘会话目录 | `~/.dsh/sessions/--D-project-dsh-dsh-plugin--/session-66d44746-…/` |
| Trellis 运行时会话文件 | `.trellis/.runtime/sessions/dsh_session-66d44746-….json` |

`_sanitize_key`（`active_task.py:257`）对 `session-<uuid>` 原样保留（只含 `[A-Za-z0-9._-]`，
首尾非 `._-`），故指针键恒为 `dsh_` + `sessionId`。**D1 第 1 步直接成立。**

**结论 B — host 侧能拿到 cwd，两条同步路径（无需 client 传参）：**

1. **首选**：`ctx.sessions.get(sessionId)?.header.cwd`——`SessionHeader.cwd?: string`（会话服务契约），
   同步、精确；仅覆盖**存活**会话（GUI 正在看的活动会话即在其中）。
2. **回退**：`ctx.workspaceRegistry.list()` → 取 `sessionIds` 含该 id 的 `Workspace.path`（canonical）。
   该索引由启动时按持久化会话 header 的 canonical cwd 建成（`dsh-workspace/lib/index.js:618-646`），
   因此**非存活会话也覆盖**。两者都是同步调用，无 IO 放大。
3. **payload 只接受 `sessionId`**（原始设计里的"client 传 cwd"回退已在实现时删除）：
   两条 host 路径实测都可用，而该字段没有任何调用方——留着就是为一个不存在的调用者
   预留扩展点，属于 trellis-check 的 Scope Discipline 明确禁止的投机兜底。
   将来若真需要，加回它是三行改动，且会与真正发送它的 client 一起加。
4. **slug 反解已删除**：含 `-` 的工作区路径歧义无法可靠消解，实测已有两条更好的路径，不值得留一条会解析错工作区的兜底。

**结论 B 已在本机活动 dsh 进程内实测复核**（动态 host 探针读实时服务，非契约推断）：

```
sessionsService: "present"   sessionCwd: "D:\project\dsh\dsh-plugin"   sessionLive: true
registryService: "present"   workspaceCount: 5
matchingPaths:  ["D:\project\dsh\dsh-plugin"]
```

两条路径都返回同一个、正确的工作区。随后把该 cwd 灌进**已交付的 host 半边**跑真实
`.trellis/`，得到 `task = {id:'09-15-trellis-statusline', title:'Trellis statusline plugin for dsh web',
status:'in_progress', priority:'P2'}`，即 D1 全链路（会话 → cwd → 指针/扫描 → 任务）成立。

`inject` 取 `['sessions', 'connection', 'webServer']`（`session` 行在本机 web profile 中存在）；
`workspaceRegistry` 是**可选面**，用 `ctx.get('workspaceRegistry')` 读取，缺失即降级到"只有存活会话可用"，
不让整个插件因它缺席而挂起。

两条路径都落空（例如子代理会话无 cwd）→ `{ status: 'none' }`，即空态，符合 R3。

### 2.2 任务解析（D1 的四步）

1. 存在 `<cwd>/.trellis/.runtime/sessions/dsh_<sessionId>.json` 且 `current_task` 指向有效任务 → 用它。
   （key 由 `_sanitize_key` 规则推出：`session-<uuid>` 只含 `[A-Za-z0-9._-]`，原样保留 → `dsh_session-<uuid>`。）
2. 否则扫描 `<cwd>/.trellis/tasks/*/task.json`：`status === 'in_progress'` 优先，其次 `'planning'`。
3. 同级多个候选时：取目录名（含 `MM-DD-` 前缀）字典序最大的，即最近建的任务；实现时固定该 tie-break 并写进测试。
4. 无 `<cwd>/.trellis`、无匹配、任何读取异常 → `{ status: 'none' }`（不抛）。

### 2.3 返回字段

`{ id, title, status, priority }`，全部 JSON-safe；`title` 截断到 48 个字符（超出加省略号）。
id 用**任务目录名**（`09-15-trellis-statusline`）——它同时是 `current_task` 指针的 basename 和扫描 tie-break 的键，
比 `task.json` 里的 `id`（slug `trellis-statusline`）更稳定，也便于未来点击跳转。
`status` 原样透出 `task.json` 的 `planning` / `in_progress`（client 负责本地化成「规划中」/「进行中」）。

## 3. 呈现（D2：会话头部 pill）

- 席位：`conversation.session.header.utilities`（步骤 0 复核：`kind: list, scope: session` 未变，
  `standardProps` 含 `sessionId`）→ 只追加、不替换官方 cell。
- 组件签名照官方同席位惯例：`function StatuslineCell({ sessionId, t })`
  （对照 `dsh-client-ui-jobs` 的 `JobListAction({ sessionId, useSessions, t })`）。
- 渲染形态：一小段等宽数字友好文本 `[P1] 标题 · 进行中`，样式只用 `--dsw-*` token，`data-*` 表达状态。
- **空态 = 返回 `null`**：`.utilities` 有 `:empty{display:none}`，整行自动隐藏。
  这与官方 jobs cell 的既定风格一致（"普通对话不该长出用不到的控制"）。
- 刷新：`ctx.interval` 每 10s 重新 `task/read`；`sessionId` 变化时立即刷新；卸载清理 interval。
- 交互：MVP 无（不设 onClick）、不吞点击、不设 title 以外的东西。
- 顺序：`order: 5`。步骤 0 实测该席位占用为 `open-in-app`(-10)、`session-log-download`(默认 0)、
  第三方 `dsh-better-sidebar:bottom-toggle`(10)，故 5 落在官方记录导出与侧栏按钮之间。

## 4. 兼容、风险与权衡

| 项 | 影响 | 处置 |
|---|---|---|
| header 席位在 hero（新会话）阶段不存在 | 新会话不显示（D2 已接受的代价） | 不额外补 overlay；若日后想要，另开任务 |
| ~~`sessionId` 是否等于磁盘目录名~~ | — | **步骤 0 已证相等**（§2.1 结论 A），不再是风险 |
| ~~host 会话服务是否存在/可用~~ | — | **步骤 0 已证可用**（§2.1 结论 B，两条同步路径），不再是风险 |
| 非存活且未登记工作区的会话解不出 cwd | 该会话显示空态 | 接受：D1 第 4 步 → `none`；两条 host 路径已覆盖存活 + 持久化会话 |
| `.trellis` 规模（任务多） | 每 10s 扫目录的开销 | 只读 `<cwd>/.trellis/tasks/*/task.json`（浅扫一层），先取指针；实测任务数 <100 无压力 |
| 只读保证 | 误写会污染用户仓库 | host 只做 `fs.readFile`/`readdir`；不引入任何写路径；测试断言无写 API 调用 |

## 5. 运维与回滚

- 安装：`dsh plugin --profile web add <插件目录>` → `dsh --profile web --dump-config | grep trellis-statusline` → 重启 dsh（重启会结束 agent 自身进程，交由用户执行）。
- 预检替代：安装前用 `node --check lib/*.js` + `npm test`；安装后用带 cookie 的 `POST /trellis-statusline/task/read` 探针在浏览器外证明通道活着。
- 回滚：`dsh plugin --profile web remove dsh-plugin-trellis-statusline`，或在 profile patch 里把该行 `disabled: true`。
  插件不写入任何持久数据（只读展示），卸载无需清理。

## 6. 明确不做

- 不改 Trellis 脚本、不写 `.trellis/`、不做任务启动/切换、不做任务列表 UI。
- 不做点击行为、不做设置卡片（无可配置项；若日后要加，走 `settings.plugin.item` + 命名空间）。
- 不显示 dsh 自身已有的会话信息（模型、token、耗时）。
