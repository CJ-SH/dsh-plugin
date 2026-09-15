# handoff.md — 任务现状与接续点

> 便签，不是 Trellis 标准产物（标准产物：prd.md / design.md / implement.md）。
> 2026-09-15 由本轮实现会话更新；原「交给创造模式」的启动说明已由下方现状取代。

---

## 一句话目标

在 dsh web 的**会话头部**常驻显示「当前会话所在工作区的活动 Trellis 任务」，
并在它属于父子体系时标出角色、可点击展开任务树（形如 `[P2] 标题 · 进行中 · 子任务`）。

## 现状：三轮反馈全部实现，自检 157/157，等待用户重启目视

| 项 | 状态 |
|---|---|
| 步骤 0 三项实测复核 | ✅ 结论已回写 `design.md` §2.1 / `prd.md` |
| 包实现（Host + Client + 清单 + patch） | ✅ `dsh-plugin-trellis-statusline/`，零依赖无构建 |
| `npm test` | ✅ **157/157**（host 54 · client 39 · cell 64） |
| 安装 | ✅ 已链入 web profile；`--dump-config` 有 `- id: trellis-statusline` |
| AC1 真机目视 | ✅ 用户已确认（第一轮，`.utilities` 席位） |
| AC6 只读 | ✅ `.trellis/` 快照前后比对 **0 变更**（建树读全部 task.json 后复测仍为 0） |
| trellis-check | ✅ 通过 |
| 提交 | ✅ `2520c79` `a5b00a9` `16730a6` `db84de8` `c840e81` + 本轮 |
| **第三轮增量（R6–R9）的真机目视** | ⏳ **待用户重启** |

## 第一轮反馈：席位迁移 + 误报修复

**席位（D2 修订）**：`.utilities` → **`.actions`**，`order: 10`（夹在 `agent-preset`(-10) 与
`job-list`(20) 之间，即会话预设模式右侧）。

**误报修复（D1 修订，`design.md` §2.2.1）**：`trellis init` 给每个项目建的
`00-bootstrap-guidelines` 一出生就是 `status: in_progress` 且永不被改（本机 5 个真实工作区里
4 个如此），而 Trellis 自己**从不扫描 `tasks/`**（`resolve_active_task()` 只读会话指针）。
修法：扫描候选必须 **`branch` 非空**（`task.py start` 正是那条既记录 branch、又写指针的命令）。
指针路径不加此过滤。真机前后对比：4 个工作区由 `[P1] Bootstrap Guidelines · 进行中` 变为空态。

## 第三轮增量（R6–R9）：角色标记 + 可点击任务树

> 已先把 R6–R9 / AC7–AC10 / D5–D7 写进 `prd.md`，技术设计写进 `design.md` §3.1–§3.5，
> 执行清单写进 `implement.md` 第 7 步；提交 `c840e81` 是"文档先行"那一步。

**一处解释分叉已定准**：用户第 2 条"显示上只有一个父任务，其余都显示为子任务"——
判定它约束的是**角色标记**（不引入祖/孙第三级），而第 3 条要的"文件夹目录 tree"保留**真实层级缩进**。
两者不冲突：前者是标签，后者是形状。已写入 `prd.md` R7 + D5。

**pill 三种形态**（`design.md` §3.1）：

| 情况 | 文本 |
|---|---|
| 单任务（R6） | `[P2] 标题 · 进行中` ← 与旧版逐字符一致 |
| 当前是根 | `[P1] 标题 · 进行中 · 父任务` |
| 当前是子/孙 | `根标题 › [P2] 标题 · 进行中 · 子任务` |

不变量：优先级方括号永远指当前任务；`›` 前永远是**根**标题。

**wire 契约**（`design.md` §3.2）：`task/read` 的 `value` 增加可选 `tree`（树即根节点，子节点递归）；
`current: true` 只打在会话当前任务；树节点 title **不截断**（pill 的仍截断 48）。

**推导算法**（`design.md` §3.3）：活动节点集（跳过 `archive`，不套 status/branch 过滤）→
`effectiveParent` 三级判定（自身 parent → 唯一认领者 → 无父）→ 上溯求根（visited + 上限 64 防环）
→ 反向索引递归出参；整体 try/catch，异常降级为"无树"。

**交互**（`design.md` §3.4）：无树时是 `span`（无 onClick/tabindex/焦点环）；有树时是 `button`，
`aria-expanded` 同步；下拉用绝对定位（与官方 jobs cell 同款），三条关闭路径（再点/Esc/点击外部）
共用一个 effect 注册并成对清理；`sessionId` 变化即收起。

**测试**：host harness 逐条覆盖 §3.5 那张表（含半写链接、悬空父、历史 `children`、legacy `subtasks`、
环、损坏节点、树 title 不截断），并对 plain + tree 两种工作区各做一次只读快照比对；
cell harness 覆盖三种 pill 形态、下拉行列/深度/缩进/唯一高亮、三条关闭路径、卸载释放监听器。

## 第三轮反馈：R10–R11（已实现，待重启目视）

**R10 去掉根标题前缀**：pill 三种形态现在是
`[P] 标题 · 状态` / `… · 父任务` / `… · 子任务` —— 没有 `›` 了。
角色标记成为 pill 里唯一表达"它在树里"的东西，结构交给下拉。

**R11 新会话界面也显示**（补上 D2 当初搁置的 hero 阶段）。调查后的关键实测：

- hero 里**确实有一个真实的空会话**（`ConversationRoot`：
  `hero = sessionId === undefined || shellPhase === "blank" && …`），所以**会话作用域席位是活的**。
- 头部在 hero 里是**挂载但被 CSS 隐藏**（`.wSkVaW_headerHidden{display:none}`），
  所以"头部 pill 没挂载即 hero"的计数器方案**会失效**。
- 选 **`conversation.input.dock`**（list / session / replaceRisk none / 输入框上方整宽条目）
  而不是 `shell.overlay`：不用自己 `position:fixed`、不用自己处理 pointer-events、
  直接拿到 `sessionId`。
- hero 判据用 shell 自己用的那个位：`useSessions((s) => s.byId[sessionId]?.blank)`。
- 那颗 pill 的下拉**向上**展开（`data-placement="up"`），否则会盖住用户马上要打字的输入框。
- 非 blank 会话渲染 `null`（否则会双 pill），且**不轮询**（`enabled=false` 时 effect 提前返回）。

两处平台事实已写进 spec `seats.md` 的「The blank-session (Hero) phase」一节。

## 下一步：用户重启 dsh web 后目视

1. 普通会话 → 头部 pill，文本 `… · 子任务`（**无 `›`**）。
2. 新建会话（hero）→ **输入框上方**出现同一颗 pill（`Tree demo` 是父任务，所以当前任务显示
   `[P2] Trellis statusline plugin for dsh web · 进行中 · 子任务`）；点击 → 下拉**向上**展开、当前行高亮。
3. 普通会话里输入框上方**不应**有第二颗 pill。

撤销演示任务（可选）：
```bash
python ./.trellis/scripts/task.py remove-subtask tree-demo 09-15-trellis-statusline
python ./.trellis/scripts/task.py archive tree-demo --skip-branch-validation
```
**注意**：`task.py` 的任务参数接受**裸任务名**（后缀匹配，歧义即报错），所以不要用
`$(ls -d .trellis/tasks/*tree-demo)` —— 那是 Git Bash 语法，在 PowerShell 里会炸。

确认后可 `python ./.trellis/scripts/task.py archive .trellis/tasks/09-15-trellis-statusline`。

两项确认后可 `python ./.trellis/scripts/task.py archive .trellis/tasks/09-15-trellis-statusline`。

## 复现工具

- `node .scratch/probe-workspaces.mjs` —— 对 5 个真实工作区跑真实 host 半边；
  传路径参数可跑旧版本做前后对比（`node .scratch/probe-workspaces.mjs ./old-index.mjs`）。
- `node .scratch/probe-real.mjs` —— 针对本工作区的完整字段级输出（含树）。
- 收尾时删掉 `.scratch/`。注意：**仓库根没有 `.gitignore`**，`.scratch/` 实际未被忽略
  （`AGENTS.md` 说"已在 .gitignore 中忽略"，与现状不符，未擅自改仓库配置）。

## 关键实测事实（已并入 spec，避免重复调研）

- **一个会话 id，四处同值**：`sessionId` = 席位 prop 域 = `DSH_SESSION_ID` =
  `~/.dsh/sessions/<slug>/session-<uuid>/` 目录名 = Trellis 指针 `dsh_<sessionId>.json` 的键。
- **host 有两条同步 cwd 路径**：`ctx.sessions.get(id).header.cwd`（存活会话）；
  `ctx.workspaceRegistry.list()` 的 `sessionIds`→`path`（含持久化会话，启动时建 canonical-cwd 索引）。
  两者已在本机活动 dsh 进程内实测：都返回 `D:\project\dsh\dsh-plugin`。
- 席位 `conversation.session.header.utilities`：`kind: list, scope: session`，`standardProps` 含 `sessionId`，
  空时 `:empty{display:none}` —— 空态返回 `null` 即整行消失。
- **hero（新建会话）阶段整块 header 不渲染** → 新会话看不到，D2 已接受的代价。
- 席位用 `ctx.locale.register(ns, {zh,en})` + 注册项 `locale: ns` 让 owner 把 `t` 投进 props；
  但**不能假设 `t` 一定到**，本插件在 `t` 缺席时直接读同一份字典。
- 平台通用契约（bundle 格式、`inject` 声明、RPC 信封与 `payload` 必填、槽名 vs `id`/`key`、
  `apply` 不抛、零依赖、harness 写法）见 `.trellis/spec/dsh-plugin-ollama-usage/frontend/`。

## 硬约束（本轮已全部遵守）

只读 `.trellis/`（插件运行时绝不写入）；host 半边不 import 任何 `@deepseek-ai/*`；
client 只 `require('react')`；`apply` 绝不抛（可选面 try/catch 降级）；零依赖、无构建步骤。

## 交付位置

按 D4 先作为 meta-repo 内的**普通目录**开发（未注册子模块）。真机验证通过后若要做成子模块，
再另开任务处理 `.gitmodules` 与指针迁移。
