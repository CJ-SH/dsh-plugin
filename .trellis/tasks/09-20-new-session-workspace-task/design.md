# design.md — 无指针会话：工作区活动任务计数

> 需求：PRD R1–R5（D1 = A，用户 2026-09-20 选定）。目标包：`dsh-plugin-trellis-statusline`（本仓库子模块）。

## 1. 目标与边界

**目标**：把"当前任务"的来源收敛为**仅会话指针**；没有指针时不再显示任何任务标题，改为显示工作区活动任务**计数**。

**边界（不改）**：Trellis 本体、`.trellis/` 内容、路由 `/trellis-statusline/task/read`、两处席位（header utilities / hero overlay）、
10s 轮询、只读不变量、零依赖与无构建步骤。**不引入**工作区级标题兜底。

## 2. 现状锚点（改动依据）

| 事实 | 锚点 |
|---|---|
| 解析入口：指针优先，否则工作区扫描 | `lib/index.js:415-427` |
| 扫描：状态过滤 + **branch 必填** + 排序（将被删除） | `lib/index.js:229-247`、`:42`（`RUNNING_STATUSES`） |
| 指针读取与任务归一 | `lib/index.js:201-212`、`:129-143`（`parseTask`） |
| 活动节点读取（树 + 计数复用） | `lib/index.js:265-294`（`readActiveNodes`，跳过 `archive`） |
| 客户端解码：`status !== 'ok'` → 渲染 `null` | `lib/client.js:184-197`、`:429` |
| pill 形态与角色 | `lib/client.js:431-457`（`role = tree === null ? null : tree.id === task.id ? 'root' : 'child'`） |
| 词典（键集以中文为准） | `lib/client.js:90-110` |
| Claude 计数语义（对齐目标） | `.claude/hooks/statusline.py:130-139`（非 archive 且存在 `task.json`） |

## 3. 设计

### 3.1 wire 契约（新增一种 reply 形态）

```ts
// 今天就有：
{ status: 'ok',    task: { id, title, status, priority? }, tree?: TreeNode }   // 会话指针命中
{ status: 'none' }                                                             // 什么都没有
// 新增：
{ status: 'workspace', activeTasks: number }                                   // 无指针，但工作区有 N≥1 个活动任务
```

- `activeTasks` 为**正整数**：`N === 0` 时仍返回 `{ status:'none' }`（空态，不画 pill）。
- 只增不改：`ok` / `none` 两种形态逐字段不变 ⇒ 有指针的会话行为不受影响（R4）。
- `task`/`title` 在 `workspace` 形态里**不存在**——这是"绝不可能把工作区任务冒充成本会话任务"的结构保证（R1）。

### 3.2 host 半边

```js
async function readTask(ctx, input) {
  const sessionId = text(input.sessionId)
  if (sessionId.length === 0) return { status: 'none' }
  const cwd = resolveCwd(ctx, sessionId)
  if (cwd.length === 0) return { status: 'none' }

  const task = await readPointedTask(cwd, sessionId)      // 唯一来源
  if (task === undefined) {
    const active = (await readActiveNodes(cwd)).size      // 复用：跳过 archive、要求 task.json 可解析
    return active > 0 ? { status: 'workspace', activeTasks: active } : { status: 'none' }
  }
  const tree = await buildTree(cwd, task.id)
  return tree === undefined ? { status: 'ok', task } : { status: 'ok', task, tree }
}
```

**删除**：`scanTasks()`、`RUNNING_STATUSES`、`statusRank()`、`:240` 的 branch 规则，以及它们专属的辅助。
保留 `parseTask()`（指针路径）、`readActiveNodes()`、`linkParents()`、`rootOf()`、`indexChildren()`、`toTreeNode()`（树与计数）。

### 3.3 client 半边

- 解码：新增 `decodeWorkspace(value)` → `number | null`（校验 `status === 'workspace'`、`Number.isSafeInteger`、`> 0`）。
- 状态：`task` 之外新增 `count`（同一轮 fetch 里二者互斥）。
- 渲染优先级：`task !== null` → 现有三种 pill（不变）；否则 `count !== null` → **计数 pill**；否则 `null`。
- 计数 pill：
  - 元素：`span.trellis-statusline-pill`（**非** `button`；无 `onClick`/`aria-haspopup`/`tabindex`；无 chevron；无角色节点）。
  - 文本：词典 `workspace.count` = `'工作区 {n} 个活动任务'` / `'{n} active task(s) in workspace'`，
    用一行 `formatCount(template, n)` 做 `{n}` 插值（`String.prototype.replace`，无第三方依赖）。
  - 样式：复用 pill 外观 + 一个 `data-kind="workspace"` 钩子；不加状态色（没有 status）。
- 空态：`task === null && count === null` → `null`（不画任何东西，hero 与 header 一视同仁）。

### 3.4 取舍

| 备选 | 否决理由 |
|---|---|
| 保留 `scanTasks` 但只在无指针时**不显示** | 纯死代码 + 保留 branch/bootstrap 规则的心智负担 |
| 计数改由 `readdir` + `stat` 单独实现（对齐 Claude 的"文件存在"判据） | 多一条文件遍历路径；且会把**损坏**的 task.json 也计进去。复用 `readActiveNodes` 更省、更诚实（差异已写进 PRD R3） |
| 计数用 `status` 过滤（只数 `in_progress|planning`） | 与 Claude 口径不一致（它数所有非归档目录）；用户在选 A 时明确"对齐 Claude" |
| 把计数拼进现有 pill（`标题 · 状态 · 3 个任务`） | 无指针时不该出现标题；有指针时再加计数会改变 R4 的"逐字节不变" |

### 3.5 兼容性与运维

- **wire 只增**：旧客户端（页面未刷新）遇到 `workspace` 形态会走进 `decodeTask` → `null` → 渲染空，等价于今天的空白，
  不会画错东西（向前兼容）。
- **生效时机**：host 半边改动需**重启 dsh**；client 半边改动需**硬刷新页面**（两半都改 ⇒ 两者都要）。
- **回滚**：还原 `lib/index.js` / `lib/client.js` 与测试，重跑 `npm test`；插件是普通文件包（`link:` 安装），无构建产物。
- **dsh 版本**：不依赖新 API，仍是 `web` profile 的既有席位与 `connection.requestRejection` 栅栏。

## 4. 验证矩阵

| 层 | 手段 | 期望 |
|---|---|---|
| host 单测 | `test/host.test.mjs` | 无指针：N≥1 → `workspace` 计数；N=0 → `none`；archive 不计；指针优先且字段不变；**任何形态都不含 `title`/`task`**（除 `ok`） |
| client 单测 | `test/client.test.mjs` | 词典双语含 `{n}`；解码器拒绝 `0`/负数/非整数/`ok` |
| cell 单测 | `test/cell.test.mjs` | 计数 pill 是 `span`（无 tab stop / 无 aria-haspopup）；无角色文本；两语言渲染；`task=null,count=null` → `null` |
| 集成 | `test/integration.test.mjs` | 真 host 读真 `.trellis`（无指针）→ 该 reply 喂真 cell → 计数 pill 出现 |
| 真机 | 重启 + 硬刷新 + 新会话目视 | ecms 新会话 `工作区 3 个活动任务`；有指针会话标题+角色不变 |
