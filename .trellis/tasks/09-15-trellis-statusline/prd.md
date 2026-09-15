# PRD — Trellis statusline（dsh web 插件）

## 目标与用户价值

在 dsh web 的**会话头部**常驻显示「当前会话正在处理的 Trellis 任务」：优先级 + 标题 + 状态。
用户不必切回终端、也不必问 AI，就能确认当前任务——补上 Claude Code 里
`statusline.py` hook 那条信息在 dsh 中缺失的部分。多会话并行时，各会话显示各自工作区的任务。

## 背景与证据（实测，非推测）

1. **参照物**：`D:\project\cc\any\.claude\hooks\statusline.py` —— Claude Code 把会话 JSON 从 stdin 交给 hook，
   hook 调 `.trellis/scripts/common/active_task.py` 的 `resolve_active_task()` 取活动任务，输出 1–2 行。
2. **dsh 无 hook 式 statusline**：Web 端只能靠客户端插件 + 插槽（slot）自己渲染。
3. **Trellis 的活动任务按会话存**：`.trellis/.runtime/sessions/<context-key>.json` 的 `current_task`，
   由 `task.py start` 写入；dsh 平台的 context key 规则 = `dsh_<sanitize(DSH_SESSION_ID)>`
   （`active_task.py:77`、`_sanitize_key` `:257-260`、`_context_key` `:308-315`）。
4. **DSH_SESSION_ID 是 dsh 的变量，不是 Trellis 的**：生产者 `@deepseek-ai/dsh-shell-env`
   （`collect(execution)` 里 `values.DSH_SESSION_ID = execution.agent.session.header.id`，并无条件注入 `DSH_HOME`/`DSH_SHELL`）
   与 `@deepseek-ai/dsh-terminal-bash`（`lib/index.js:874-882`）；Trellis 只是读它。
   本机 `dsh --profile web --dump-config` 里 `shell-env`（139 行）与 `tool-bash`（143 行）都在，
   但 agent 经 `run_code` 调 bash 时连 `DSH_HOME`/`DSH_SHELL` 都观测不到 → 该路径不经过 `shellEnv.collect()`。
   结论：`.trellis/.runtime/sessions/` 为空是"没人以会话身份跑过 `task.py start`"，且**不应把设计建在这个环境变量上**。
5. **dsh 会话 → 工作区的两条可用线索**：
   - 磁盘：`~/.dsh/sessions/<工作区 slug>/session-<uuid>/`（本工作区：`--D-project-dsh-dsh-plugin--/session-3724610a-…`），
     目录内只有压缩转写 `session.v3.jsonl.zstd`。
   - 会话记录含 `cwd`：`dsh-api-session-controller` 的会话条目字段有 `id, cwd, title, updatedAt, running, parentSessionId …`。
6. **席位组件能拿到会话身份**：官方同席位 cell `JobListAction({ sessionId, useSessions, t })`
   （`dsh-client-ui-jobs/lib/client.js:117`，注册进 `conversation.session.header.actions`）。
7. **社区先例（参考）**：`Small-Miao/dsh-statusbar`、`Starlight-bananice/dsh-status-bar`、
   `czm15053/dsh-trellis-card`、`Beants/dsh-trellis`、`QianziTech/dsh-trellis-dashboard`。
   席位机制与现有 cell 占用等细节见 `design.md` §3。

## 需求（MVP）

- **R1 显示**：在会话头部常驻显示优先级 + 标题 + 状态，形态如 `[P1] 标题 · 进行中`。
- **R2 口径**：按 **D1** 的四步解析（会话 → 工作区 → 会话指针优先 → 工作区扫描 → 空）。
- **R3 空态**：没有活动任务时**不渲染**（`null` 单元格：`.actions` 席位不占位），不显示占位、不报错。
- **R4 只读**：只读 `.trellis/`，绝不写入或修改任何 Trellis 数据；文件异常一律视为"无任务"。
- **R5 形态与刷新**：host + client 两半、`cordis.patch.yml`、零依赖、无构建步骤；
  轮询周期 10s，任务切换/结束后 ≤10s 内跟随；卸载后无残留。

## 验收标准

- **AC1** 在含活动任务的工作区打开活动会话：会话头部出现该任务的 `[P1] 标题 · 状态`。
- **AC2** 任务开始/切换/结束后，显示在 10s 内跟随（或立刻，若同一轮询内）。
- **AC3** 无 `.trellis/`、无任务、`task.json` 损坏时：整行消失、无报错、无占位文案。
- **AC4** `npm test` 全绿，覆盖：解析四步（指针优先/扫描兜底/tie-break/空态）、席位注册（槽名 vs `id`/`key`）、
  cell 渲染（ok / none）、`sessionId` 变化触发刷新、卸载清理 interval、跨半边端点与常量一致。
- **AC5** 安装可验证：`dsh --profile web --dump-config` 出现插件行；带 cookie 的
  `POST /trellis-statusline/task/read` 返回 `{"ok":true,...}`；重启后目视可见。
- **AC6** 只读可验证：对目标工作区 `.trellis/` 做前后快照（文件清单 + mtime/hash）比对，运行前后不变。

## 已决定

- **D1 活动任务口径**：会话 → 工作区映射，会话指针优先，其次工作区扫描：
  1. client 席位拿到 `sessionId`；host 解析该会话的 `cwd`（步骤 0 实测：存活会话走
     `ctx.sessions.get(id).header.cwd`，否则走 `ctx.workspaceRegistry.list()` 的 sessionIds→path 索引；
     原设计的"client 传 cwd"与 slug 反解两条回退已删除，理由见 `design.md` §2.1）；
  2. 若 `<cwd>/.trellis/.runtime/sessions/dsh_<sessionId>.json` 的 `current_task` 有效 → 用它；
  3. 否则扫描 `<cwd>/.trellis/tasks/*/task.json`：`in_progress` 优先，其次 `planning`；
     **且必须 `branch` 非空**（2026-09-15 真机验收后修正：`trellis init` 的脚手架任务
     `00-bootstrap-guidelines` 永远停在 `in_progress` 且从未被 start，五个真实工作区里四个中招，
     实测与修正见 `design.md` §2.2.1）；同级取目录名字典序最大；
  4. 都没有 → 空态。
- **D2 呈现位置**（2026-09-15 修订）：`conversation.session.header.actions`（list / scope session）
  追加一个 cell，紧挨「会话预设模式」选择器右侧 —— 实测占用为 `agent-preset`(order -10)、
  `job-list`(order 20)，故取 `order: 10`。原定 `conversation.session.header.utilities`
  空间过窄（右对齐，被 `open-in-app` -10、`session-log-download` 0、第三方侧栏按钮 10 占满）。
  只追加不替换官方 cell。代价不变：**hero（新建会话）阶段整块 header 不渲染，新会话看不到**——已接受。
- **D3 MVP 默认值**：空态不渲染、点击无行为、`order: 10`（原定 5，随 D2 修订调整）、轮询 10s。

## 范围外

- 不做任务启动/切换，不做任务列表或看板；不替代 `task.py start`。
- 不显示 dsh 自身已有的会话信息（模型、token、耗时、成本）。
- 不改 Trellis 脚本、不写 `.trellis/`、不做设置卡片（无可配置项）。
- 不为 hero 阶段补第二处席位（若日后需要，另开任务）。

## 待核查（步骤 0 已完成，2026-09-15 实测）

- ✅ client 拿到的 `sessionId` **等于**磁盘目录名 `session-<uuid>`：同一会话
  `session-66d44746-…` 同时出现在席位 prop 域（`SessionId`）、`DSH_SESSION_ID` 环境变量、
  `~/.dsh/sessions/--D-project-dsh-dsh-plugin--/session-66d44746-…/`、以及
  `.trellis/.runtime/sessions/dsh_session-66d44746-….json` 四处。无需 id 映射。
- ✅ host 侧能查到会话 `cwd`，且是两条同步路径：`ctx.sessions.get(id).header.cwd`（存活会话）、
  `ctx.workspaceRegistry.list()` 的 `sessionIds`→`Workspace.path`（含持久化会话）。
  因此**不需要**"client 传 cwd"作为主路径；slug 反解兜底已删除。详见 `design.md` §2.1。
- ✅ 交互式 dsh 会话**确实**带 `DSH_SESSION_ID`（本机工具执行实测；
  `dsh-shell-env/lib/index.js:85` 由 `execution.agent.session.header.id` 赋值）→ D1 第 2 步命中率高。

## 待定（已决）

- ✅ 交付位置：新建目录 `dsh-plugin-trellis-statusline/`，先作为 meta-repo 内的**普通目录**开发；
  真机验证通过后再谈子模块注册（D4）。
