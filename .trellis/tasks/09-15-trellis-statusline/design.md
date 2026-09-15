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
2. 否则扫描 `<cwd>/.trellis/tasks/*/task.json`：`status === 'in_progress'` 优先，其次 `'planning'`，
   **且必须 `branch` 非空**（2026-09-15 真机验收后修正，见 §2.2.1）。
3. 同级多个候选时：取目录名（含 `MM-DD-` 前缀）字典序最大的，即最近建的任务；实现时固定该 tie-break 并写进测试。
4. 无 `<cwd>/.trellis`、无匹配、任何读取异常 → `{ status: 'none' }`（不抛）。

#### 2.2.1 「已开工」判据（真机验收后新增，修复误报）

用户真机验收时报告：其他工作区显示 `[P1] Bootstrap Guidelines · 进行中`，而其经验里这项不该出现。
跨 5 个真实工作区实测确认这是**扫描步骤的误报**，根因：

- `trellis init` 给每个新项目建的 `00-bootstrap-guidelines`，`status` 一出生就是 `in_progress`，
  且**不会被自动改回去**（`dsh-plugin` 里它靠手动 archive 才变 `completed`；
  `dsh\any`、`dsh\backwave`、`python\agent_demo`、`java\ecms-backend` 四个工作区至今仍是 `in_progress`）。
- 而 **Trellis 自己从不扫描 `tasks/`**：`resolve_active_task()` 只读会话指针
  （`active_task.py:646-678`，`allow_single_session_fallback` 默认 False）。所以 Trellis 对这四个
  工作区的答案是「无活动任务」——只有本设计的 D1 第 3 步会把它翻出来。

判据取 **`branch` 非空**，依据是 `task.py` 自己的语义：`cmd_start` 的注释写着
"Move a freshly started task to in_progress and record its branch … Recording at start is what
keeps `branch` trustworthy"（`task.py:88-131`）。**`task.py start` 正是那条既写 `branch`、
又写运行时指针、还把 `planning → in_progress` 的命令**。

| 场景 | `status` | `branch` | 扫描候选 |
|---|---|---|---|
| `trellis init` 脚手架，从未 start | `in_progress` | `null` | 否 |
| 真被做过的任务 | `in_progress` | 分支名 | 是 |
| 未 start 的 planning 任务 | `planning` | `null` | 否 |

**指针路径不加这道过滤**（关键的不对称）：指针本身就是「某个会话已经 start 过它」的直接证据；
且非 git 仓库 / detached HEAD 时 `task.py start` 记录不到分支（`task.py:129-130`），那时只有指针能救。
测试用「指针指向一个 `branch: null` 的任务」把这条不对称钉住。

真机前后对比（同一份 host 半边、同一批工作区，探针用无指针的 sessionId 强制走扫描路径）：

| 工作区 | 修正前 | 修正后 |
|---|---|---|
| `dsh-plugin` | `[P2] Trellis statusline plugin for dsh web · in_progress` | 同前（真任务，有分支） |
| `dsh\any` | `[P1] Bootstrap Guidelines · in_progress` | 空态 |
| `dsh\backwave` | `[P1] Bootstrap Guidelines · in_progress` | 空态 |
| `java\ecms-backend` | `[P1] Bootstrap Guidelines · in_progress` | 空态 |
| `python\agent_demo` | `[P1] Bootstrap Guidelines · in_progress` | 空态 |

副作用（已知、可接受）：非 git 工作区里「由别的会话 start、本会话又无指针」的任务，扫描会漏 → 空态。
宁可漏报也不误报。

另：`review` 状态不在候选内（D1 只定了 `in_progress`/`planning`）。若要算，改 `RUNNING_STATUSES` 一处即可，
已在 README 的"不做什么"里标注。

### 2.3 返回字段

`{ id, title, status, priority }`，全部 JSON-safe；`title` 截断到 48 个字符（超出加省略号）。
id 用**任务目录名**（`09-15-trellis-statusline`）——它同时是 `current_task` 指针的 basename 和扫描 tie-break 的键，
比 `task.json` 里的 `id`（slug `trellis-statusline`）更稳定，也便于未来点击跳转。
`status` 原样透出 `task.json` 的 `planning` / `in_progress`（client 负责本地化成「规划中」/「进行中」）。

## 3. 呈现（D2：会话头部 pill）

> **D2 修订（2026-09-15，真机验收后）**：席位由 `conversation.session.header.utilities`
> 改为 `conversation.session.header.actions`。理由（用户提出，实测支持）：
> `.actions` 是"Title-adjacent Session actions"（紧邻会话标题），横向空间明显多于右对齐的
> `.utilities`；且用户希望 pill 紧挨「会话预设模式」选择器右侧。实测 `.actions` 占用为
> `agent-preset`(order -10) 与 `job-list`(order 20)，故取 `order: 10` —— 正好夹在两者之间。
> `.utilities` 的实测事实（`kind/scope`、`standardProps` 含 `sessionId`、`:empty` 自动隐藏）
> 仍成立并已并入 spec，只是不再是本插件的席位。

- 席位：`conversation.session.header.actions`（实测 `kind: list, scope: session`，
  `standardProps` 含 `sessionId`，`replaceRisk: none`）→ 只追加、不替换官方 cell。
- 组件签名照官方同席位惯例：`function StatuslineCell({ sessionId, t })`
  （对照 `dsh-client-ui-jobs` 的 `JobListAction({ sessionId, useSessions, t })`，
  它注册的正是 `.actions`）。
- 渲染形态：一小段等宽数字友好文本 `[P1] 标题 · 进行中`，样式只用 `--dsw-*` token，`data-*` 表达状态。
- **空态 = 返回 `null`**：在 `.utilities` 里这一行有 `:empty{display:none}` 会自动隐藏；
  在 `.actions` 里该行本来就有 `agent-preset`/`job-list` 常驻，`null` 只是不贡献单元格、不占位。
  两者都与官方 jobs cell 的既定风格一致（"普通对话不该长出用不到的控制"）。
- 刷新：`ctx.interval` 每 10s 重新 `task/read`；`sessionId` 变化时立即刷新；卸载清理 interval。
- 交互：MVP 无（不设 onClick）、不吞点击、不设 title 以外的东西。
- 顺序：`order: 10`（`agent-preset` -10 → 本 cell → `job-list` 20）。
- 本地化：`ctx.locale.register('trellis-statusline', {zh, en})` + 注册项 `locale: 'trellis-statusline'`，
  由 owner 把绑定命名空间的 `t` 投进 props；**但不假设 `t` 一定到**——缺席时 cell 直接读同一份字典。

### 3.1 角色与 pill 文本（R6/R7/R10）

角色只有两种（R7）：`root`（树的根祖先 = 唯一的「父任务」）与 `child`（其余**全部**后代，
含孙及更深）。`role = task.id === tree.id ? 'root' : 'child'`。

| 情况 | pill 文本 |
|---|---|
| 无任务树（R6） | `[P2] 标题 · 进行中` |
| 当前是根 | `[P1] 标题 · 进行中 · 父任务` |
| 当前是子/孙 | `[P2] 标题 · 进行中 · 子任务` ← **R10：不再有 `根标题 ›` 前缀** |

R10 之后 `tree.id` 不再进入 pill 文本，只用于两件事：判定"有没有树"（决定角色标记、箭头、
可点击性）与渲染下拉。角色标记成为 pill 里唯一表达"它在树里"的东西，结构本身交给下拉（R9）；
优先级方括号永远指当前任务自己这条不变量也因此更直白。

### 3.2 wire 契约（D6：与 pill 同源）

`task/read` 的 `value` 增加可选 `tree`，**树即根节点**（子节点递归）：

```jsonc
{
  "status": "ok",
  "task": { "id", "title", "status", "priority"? },   // pill 投影，title 仍截断到 48
  "tree": {                                            // 单任务时整个字段省略
    "id", "title", "status", "priority"?, "current"?,  // 根 = 唯一的「父任务」
    "children"?: [ { …同形状，可再嵌套… } ]             // 无子时省略该字段
  }
}
```

- `current: true` 只出现在会话当前任务那一行，其余行**省略该字段**（沿用仓库"可选字段省略"的约定）。
- **树节点的 title 不截断**（完整标题），只有 `task.title` 保留 48 截断：pill 是头部单行、
  受横向空间硬约束；下拉是详情视图，靠 CSS ellipsis + `title` 属性兜底。两条规则各自成立，写在注释里。
- `tree` 省略的判据：**根就是当前任务且没有任何后代**（R6 的单任务）。
- 树的**层级照实**（R9）：不做扁平化，深度由 `children` 递归表达。

### 3.3 树推导算法（host 侧）

输入：`<cwd>/.trellis/tasks` 下全部活动任务（跳过 `archive`，见 §2.2.1），每个读 `task.json`。

1. **建节点集** `nodes: Map<dirName, {id,title,status,priority,parent,childNames}>`。
   入集**不套扫描的 status/branch 过滤**——树要展示整棵树，包括 `completed` 或从未 start 的成员
   （与 `task.py list` 的 `all_tasks` 一致）。`childNames` 取 `children` ∪ 旧拼写 `subtasks`
   （`task_store.py:851` 说后者仍在老文件里被携带）。
2. **求有效父** `effectiveParent(id)`，三级判定，专门为容错：
   1. `node.parent` 指向活动节点 → 用它；
   2. 否则若**恰有一个**活动节点的 `childNames` 列出了它 → 用它（Trellis 自己会打印
      "Link is half-written" 的半写链接正落在这里：父已认子、子还没记父）；
   3. 否则 → 无父（悬空 `parent` 引用 / 父已归档，与 `task.py list` 把孤儿渲染成顶层同义）。
   因为父是**函数**（每个节点至多一个），整片就是森林——不会出现一个节点挂两处。
3. **建反向索引**：`childrenIndex: parentId → [childId]`，由第 2 步的结果一次性生成，
   同级按**目录名字典序**（`MM-DD-` 前缀即时间序）排序 → 迭代顺序完全确定、可断言。
4. **定位根**：从当前任务沿 `effectiveParent` 上溯，visited 集合 + 迭代上限 64 防环；
   遇到环则在停止点收手（不抛、不死循环）。
5. **递归出参**：根节点带 `children` 递归转 wire，`current: true` 打在当前任务那一行。
6. **单任务判定**：根 === 当前任务且无 `children` → 返回 `undefined`（R6）。
7. 整个 `buildTree` 包在 try/catch 里：任何异常 → 当作无树（pill 退化成今天的行为，不抛）。

**`children` 是历史列表**（`trellis-meta` task-reference 原话）：已归档的子任务名字仍留在里面。
它们不在活动节点集里 → 自然被第 1 步挡掉，不出现在树里 —— 与 `task.py list` 的
`if child_name in all_tasks` 行为一致。

**为什么向下只走 `childrenIndex` 而不再并 `childNames`**：若某节点的 `childNames` 列了一个
`parent` 字段指向别人的节点（数据自相矛盾），并集合会把它挂到两处、还要靠遍历顺序决定归属。
只认 `effectiveParent` 则每节点唯一归属，结果与顺序无关。

### 3.4 下拉交互与样式（R8/R9）

DOM（`span` 为根，保持一行内联；菜单行由递归渲染展平成一维数组后带 `depth`）：

```
span.trellis-statusline[data-status][data-role][title]      position:relative; inline-flex
 ├─ (button|span).trellis-statusline-pill                   圆角 + 略灰背景；有树时才是 button
 │   ├─ span.trellis-statusline-parent      根标题 ›           仅子任务
 │   ├─ span.trellis-statusline-priority    [P2]
 │   ├─ span.trellis-statusline-title       标题
 │   ├─ span.trellis-statusline-separator   ·
 │   ├─ span.trellis-statusline-state       进行中
 │   ├─ span.trellis-statusline-role        父任务 / 子任务     仅有树时
 │   └─ span.trellis-statusline-chevron     ▾                 仅有树时，展开时旋转
 └─ ul.trellis-statusline-menu                              仅展开时
     └─ li.trellis-statusline-menurow[data-role][data-depth][data-current?]   ← 每行一个，按 depth 缩进
```

- **圆角 + 略灰**：`border-radius:8px`、`background:var(--dsw-alias-bg-layer-2)`（已核实的 token，
  语义就是"次级嵌套表面"）。菜单用 `--dsw-alias-bg-overlay`（"Overlay and popover background"）。
- **层级缩进**：`li[data-depth="n"]` 的 `padding-left` 随 n 递增（0 → 8px，每级 +14px），
  子级再叠一条左导引线（`.trellis-statusline-menubranch`）。不用 `├└` 字符：字体无关、不会出现豆腐块
  （字符方案考虑过并否掉）。
- **只在有树时才是 `button`**：无树时渲染成 `span`，没有 `onClick`、没有焦点环、不进 Tab 序，
  守住"不该长的控件不要长"。
- **关闭路径三条**：再次点击、`document` 上的 `pointerdown` 落在根之外、`document` 上的 `keydown`
  Escape。展开期间用一个 effect 注册这两个监听器并成对清理。
- **切会话即收起**：`sessionId` 变化时 `setOpen(false)`。
- **高亮当前任务**：`data-current="true"` → 品牌色文字 + `bg-layer-2` 底 + 左侧 2px 品牌色条。
- 下拉定位 `position:absolute; top:calc(100% + 6px); left:0; z-index:100`，与官方同席位
  jobs cell 的菜单同款做法（它就是 `.actions` 里的绝对定位下拉，证明头部不裁切）。

### 3.5 边界情况（把"很多种情况"逐条钉住）

| 情况 | 期望 |
|---|---|
| 当前任务无父无子 | 无 `tree`；pill 与旧版一致；不可点击（R6/AC7） |
| 当前任务是根，有后代 | `tree` = 当前节点；角色 `root` |
| 当前任务是子任务 | `tree` = 根；pill 前缀 = **根**标题；当前行 `current: true`；角色 `child` |
| 当前任务是孙任务 | 同子任务（角色仍 `child`）；菜单里按真实深度缩进两级（R7 + R9） |
| 后代里混有 `completed` / 从未 start 的兄弟 | 照常入树（不套 status/branch 过滤） |
| 半写链接（只在父的 `children` 里） | `effectiveParent` 第 2 级兜住，仍认作父子 |
| 悬空 `parent`（父已归档/被删） | 视为无父 → 当前成为根 |
| `children` 里的历史名字（子已归档） | 不在活动集 → 不进树（与 `task.py list` 一致） |
| 老文件只写 `subtasks` 没写 `children` | `childNames` 并集覆盖 |
| 环（a.parent=b, b.parent=a） | visited + 上限 64 → 在停止点收手，不挂死 |
| 当前任务自身 `task.json` 解析失败 | 走既有空态（`parseTask` 已返回 undefined） |
| 树里某节点 `task.json` 解析失败 | 该节点及其子树不进树；不影响其它行 |
| 会话没有 cwd / 无 `.trellis` | 走既有空态，无树 |

### 3.6 新会话（hero）里的第二处席位（R11）

**为什么需要第二处**：hero 阶段 `conversation.session.header` 整块被 shell 加上
`.wSkVaW_headerHidden{display:none}` —— 头部是**挂载但不可见**，所以头部那颗 pill 在 hero 里
既看不见、也拿不到"我该消失"的信号。唯一的办法是在别处再放一颗。

**席位**：`conversation.input.dock`（`kind: list, scope: session, replaceRisk: none`，用途
"输入框上方的整宽条目"，已有 todo/goal/queue/git-graph 四个真实占用者）。选它而不是
`shell.overlay` 的三条理由见 `prd.md` D8；核心是 **hero 里存在真实的空会话**，
所以会话作用域席位是活的，`sessionId` 直接由 props 给出，不需要任何 workspace 反查、
不需要 `position:fixed`、不需要自己处理 pointer-events。

**hero 判据（D9）**：`useSessions((s) => s.byId[sessionId]?.blank) === true`。
这是 `ConversationRoot` 自己算 `summaryBlank` 用的同一个事实源。
**不能用"头部 pill 没挂载"来判**——头部在 hero 里是挂载的（只是 `display:none`），
计数器方案会永远认为"头部在显示"。

**两种状态**：

| 状态 | 头部 cell | dock cell |
|---|---|---|
| `sessionId === undefined`（无会话） | 不挂载 | 不挂载（席位是 session 作用域） |
| blank 会话（hero，R11） | 挂载但被 shell 隐藏 | **显示 pill**（AC12） |
| 普通会话 | 显示 pill | 渲染 `null`（AC13，不得出现第二颗） |

**位置与展开方向（D10）**：dock cell 外面套一层
`.trellis-statusline-dock{display:flex;justify-content:center;width:100%;max-width:var(--dsh-chat-content-width,720px);margin:0 auto;padding:0 16px 4px}`
—— 与 hero 居中的观感一致，并复用 composer 的内容宽度变量。
下拉在 dock 里**向上**展开（`bottom:calc(100% + 6px)`）：dock 就在 composer 上方，
向下展开会盖住用户马上要打字的输入框。用 `data-placement="up"` 切换，头部那颗仍是向下。

**共用**：两颗 cell 用同一个 `TaskPill({ sessionId, t, placement })` 组件与同一份
`task/read` 契约，只有外层包装与展开方向不同。

## 4. 兼容、风险与权衡

| 项 | 影响 | 处置 |
|---|---|---|
| header 席位在 hero（新会话）阶段不存在 | 新会话不显示（D2 已接受的代价） | 不额外补 overlay；若日后想要，另开任务 |
| ~~`sessionId` 是否等于磁盘目录名~~ | — | **步骤 0 已证相等**（§2.1 结论 A），不再是风险 |
| ~~host 会话服务是否存在/可用~~ | — | **步骤 0 已证可用**（§2.1 结论 B，两条同步路径），不再是风险 |
| 非存活且未登记工作区的会话解不出 cwd | 该会话显示空态 | 接受：D1 第 4 步 → `none`；两条 host 路径已覆盖存活 + 持久化会话 |
| `.trellis` 规模（任务多） | 每 10s 扫目录的开销 | 只读 `<cwd>/.trellis/tasks/*/task.json`（浅扫一层）；实测 5 个真实工作区最大 40 个任务无压力 |
| 建树需读**全部**活动任务（D7，指针命中时也读） | 每 10s N 个小文件读，N 达数千时成为负担 | 已知上界：实测最大 40，可忽略；若日后某工作区上千任务，加一个 `NODE_LIMIT` 常量跳过建树即可（届时 pill 退化为不带树） |
| 下拉被头部裁切 | 菜单被 `overflow:hidden` 剪掉 | 用与官方同席位 jobs cell 完全相同的绝对定位方案（它已验证可用）；`z-index:100` |
| 树推导遇到环 / 半写链接 / 悬空父 | 挂死或归属错误 | visited + 迭代上限 64；`effectiveParent` 三级判定；§3.5 逐条有测试 |
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
