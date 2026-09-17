# 修复 statusline 会话任务误报（会话身份链路）

## Goal

让 dsh web 会话头部的 Trellis 状态栏（`dsh-plugin-trellis-statusline`）显示**该会话真正在做的任务**：

- 会话在做子任务时显示该子任务（角色 `子任务`），下拉树中该子任务被标为当前；
- 会话在做父任务时显示该父任务（角色 `父任务`），树中父任务被标为当前；
- 拿不到会话级证据时**不得**把"工作区里最近启动的某个任务"伪装成本会话的任务。

用户价值：状态栏是"我现在在干什么"的唯一常驻提示；显示成别的任务（尤其是把它标成"父任务"）会让用户对自己的工作区状态产生错误判断。

## 背景与已确认事实（全部有实测证据）

### 现象（用户报告，2026-09-16）

工作区 `D:\project\java\ecms-backend`，三个 dsh 会话与 Trellis 任务的真实关系：

| 会话标题 | sessionId | 本会话真实任务 | 任务树 | 用户看到的 |
|---|---|---|---|---|
| 数采聚合物料产量排行接口 | `session-fbfd9e51-…` | `09-15-iot-agg-material-output-rank`（in_progress） | 根，children=`09-16-rank-testdata-copy` | 正常 |
| 生产库复制数据到测试库 | `session-0890f671-…` | `09-16-rank-testdata-copy`（planning，**子任务**） | parent=`09-15-…` | 显示父任务 `09-15-…`，当前高亮在父任务上 |
| 模锻球阀物料编号调查 | `session-a213d5a6-…` | `09-16-qffg-psqfft-2-150-valve-parts`（planning，**子任务**） | parent=`09-14-fc7398-1-actual-delivery` | 显示**无关的** `09-15-…` 为父任务，自己的子任务完全未出现 |

### 实测：真实 host 半边对这三个会话给出**完全相同**的回答

用真实 `lib/index.js` + 真实 cwd 复跑（`.scratch/probe-ecms.mjs`），三个会话都是：

```
pill: [P2] 数采聚合物料产量排行接口 · in_progress · 父任务
tree: - 数采聚合物料产量排行接口 [in_progress]  <= current
        - 生产库数据复制到测试库（数采产量排行接口功能测试） [planning]
```

即：与会话无关的工作区扫描结果被当成"本会话任务"，并被打上 `父任务` 角色（`lib/client.js:434` —— `tree.id === task.id` 即 root ⇒ `父任务`）。

### 根因链（三层，逐层实测）

**① 该会话根本没有 Trellis 会话指针。** `D:\project\java\ecms-backend\.trellis\.runtime\sessions\` 为空（其它 5 个工作区同样为空）；而 `.trellis/.backup-*` 里躺着 `claude_<uuid>.json` 指针，证明这套机制在 Claude Code 下本来是工作的。

**② 指针缺失的原因：模型侧 shell 里没有 `DSH_SESSION_ID`。**

- Trellis 把 `DSH_SESSION_ID` 当作 dsh 的会话身份来源（`.trellis/scripts/common/active_task.py:68-77`，dsh 条目在表首），据此算出 context key `dsh_session-<uuid>`（同文件 `:308-315`），指针文件即 `.trellis/.runtime/sessions/dsh_session-<uuid>.json`（`:642-643`）。
- 会话 `session-fbfd9e51` 在 2026-09-16T01:36Z 真跑过 `python ./.trellis/scripts/task.py start 09-15-iot-agg-material-output-rank`，输出是 Trellis 的**降级模式**（transcript `tool/ptc-dispatch` 记录原文）：
  `ℹ Session identity not available; active-task pointer not persisted this session (degraded mode).` + `✓ Status: planning → in_progress (degraded)` + `✓ Branch recorded: fbv-qyl (degraded)`
  → 状态与 branch 被写了，**指针没写**（`task.py:235-255`）。
- 那次调用的 bash 来自当时会话所用预设：`session-fbfd9e51`/`session-a213d5a6` 用 **`liangshen`**，`session-0890f671` 用 **`ptc-bash`**（读自 `~/.dsh/storages/session_projcache/sessions/session-*.json` 的 `agentPreset` 行）。
- 这两个预设的 bash 工具都直接用 `ctx.subprocess.spawn` 起 Git Bash、只继承环境，从不消费 dsh 的 shell 环境注册表：
  - `~/.dsh/.agent-presets/ptc-bash/dsh-bash-win.mjs:47` → `export const inject = ['subprocess', 'tools', 'systemPrompt']`（无 `shellEnv`），spawn 于 `:263/:283/:326`；
  - `~/.dsh/.agent-presets/liangshen/custom-bash.mjs:176` 同样无 env 覆盖。
  - 对照：官方 `@deepseek-ai/dsh-tool-bash` 在 `lib/index.js:395` 调 `ctx.shellEnv.collect(exec)`、`@deepseek-ai/dsh-tool-pwsh` 在 `lib/index.js:373` 同样；`@deepseek-ai/dsh-shell-env` `:80-96` 正是在 `execution.agent !== undefined` 时注入 `DSH_SESSION_ID`（与 `DSH_SHELL=1`）。
  - 官方 `tool-bash` 在 Windows 上是 `disabled`（`dsh-agent-presets/presets/ptc/agent.cordis.yml:52-54`），本机 dsh 的 bash 由上述自定义工具提供 ⇒ **Windows + 自定义 bash 预设 = 拿不到会话身份**。

**③ 无指针时，plugin 的兜底扫描是"工作区级"的，无法代表会话。**

- `lib/index.js:201-212` 先读指针；读不到就 `scanTasks(cwd)`（`:229-247`）：全工作区候选，`in_progress` 优先于 `planning`，同档取目录名最大者，且**必须有非空 `branch`**（`:240`）。
- ecms 工作区里唯一 `in_progress` + 有 `branch` 的任务就是 `09-15-iot-agg-material-output-rank` ⇒ 所有会话都命中它。
- 两个 `planning` 子任务 `branch: null` ⇒ 被 `:240` 直接排除 ⇒ 即使排序偏好改变也永远轮不到它们（这正是用户说的"未检测到子任务产生"）。

### 反证：指针存在时，显示完全正确

在 `.scratch/trellis-exp`（一次性 git 仓库 + 复制来的 `.trellis/scripts`，**未触碰真实实例**）做对照实验：

1. `task.py create` **无身份** → `.runtime/sessions` 目录根本不生成；
2. 带 `TRELLIS_CONTEXT_ID=dsh_session-1111…` 时 `task.py create` → 写入
   `{"platform":"dsh","current_task":".trellis/tasks/09-16-exp-b","current_run":null}`，`task.py current --source` 返回 `session:dsh_session-1111…`；
3. 把该指针放进父/子结构的小工作区，真实 host 半边输出：
   ```
   pill: [P2] 子任务示例（brainstorm 阶段） · planning · 子任务
     - 父任务示例 [in_progress]
       - 子任务示例（brainstorm 阶段） [planning]  <= current
   ```
   —— 与用户期望逐字一致；删掉指针后立刻退回"父任务 + current 打在父上"。

### 补充事实

- Trellis **本来就是"创建即激活"**：`task.py create` 在能解析出 context key 时会自动写本会话指针（`.trellis/scripts/common/task_store.py:626-681`，成功时打印 `Activated task for this session: …`）。也就是说 **只要会话身份可用，brainstorm 阶段创建子任务的那一刻指针就指向该子任务**——本 bug 根本不会出现。
- plugin 的 key 推导与 Trellis 一致：`lib/index.js:81-96` 的 `sanitizeKey`/`contextKey` 对应 `active_task.py:257-260` 与 `:308-315`，无拼写/截断分歧。
- 除 `create`/`start` 外，Trellis 没有"只设指针、不改状态"的命令（`task.py` 子命令清单；`current` 只读）⇒ 存量会话要恢复指针，只能用 `task.py start <task>`（会把 `planning` 翻成 `in_progress` 并记录 branch），或手工写指针文件。
- dsh 会话日志是**多帧 zstd**（实测 278 帧；Node 内置 `zstdDecompressSync` 与流式解码都只出第一帧 212 字节 / 共 2 MB），因此"直接读会话日志文件推断任务"在没有依赖或 `zstd` CLI 的前提下不可行；但**活会话对象**在进程内可读（`ctx.sessions.get(id)` → `snapshotEvents()/eventAt()/seq`，`dsh-session/lib/index.js:1096-1113`），是另一条可行但更重的备选路径。
- 本任务就在同类环境里创建（本会话也用 `ptc-bash` 预设，`env` 中无 `DSH_SESSION_ID`）⇒ 本任务在被 `task.py start` 之前，状态栏同样看不到它，可作为验收样本。

## 进展快照（2026-09-17：只补了存量指针，用户指示）

按用户指示"先只补存量指针"，用 **Trellis 自己的 `set_active_task()`**（经 `TRELLIS_CONTEXT_ID` 提供 context key，
一次性脚本 `.scratch/restore-pointers.py`）在 ecms 实例补了 3 个会话指针；**task.json 的 status/branch 未被本操作改动**：

| 指针文件（`.trellis/.runtime/sessions/`） | current_task | 该任务当时的 status（来自用户自己的会话，非本操作） |
|---|---|---|
| `dsh_session-fbfd9e51-…` | `.trellis/tasks/09-15-iot-agg-material-output-rank` | in_progress / fbv-qyl |
| `dsh_session-0890f671-…` | `.trellis/tasks/09-16-rank-testdata-copy` | in_progress / fbv-qyl（用户会话 2026-09-16 17:04 自行 `task.py start` 所致） |
| `dsh_session-a213d5a6-…` | `.trellis/tasks/09-16-qffg-psqfft-2-150-valve-parts` | planning / null（从未 start） |

验证（真实实例 + 真实 host 半边）：三个会话现在分别渲染
`[P2] 数采聚合物料产量排行接口 · in_progress · 父任务`、
`[P2] 生产库数据复制到测试库（数采产量排行接口功能测试） · in_progress · 子任务`、
`[P2] 调查组件 00QFFG116826 / 002PSQFFT116825 · planning · 子任务`，
且树中 `current` 都落在本会话任务上；`task.py current --source` 对三个 key 都返回 `session:dsh_session-…`。

**这是手工覆盖，不是根因修复**：会话身份（`DSH_SESSION_ID`）仍然缺失 ⇒ ① 这些会话里将来的 `task.py start` 仍会走降级模式、
**不会**改写已有指针（指针会停在当前目标、可能变陈旧）；② 其它没有指针的会话仍然吃工作区级扫描猜测（父任务会话在补指针前
一度被扫成子任务，即此类误报的又一实例）。R1/R2/D1/D2 仍未定案。

### 追加（2026-09-17）：本会话（dsh-plugin 工作区）为什么也是空白 + 关键实测

- 本会话 `session-4a220f8c-7bc5-48af-80f3-a4239bdca751` 同样没有指针：本任务是用 **自定义 bash 工具**跑的 `task.py create`，
  那条路径没有 `DSH_SESSION_ID` ⇒ 降级模式 ⇒ 不写指针。而本工作区唯一未归档任务就是它（`planning` / `branch: null`），
  又正好被兜底扫描的 branch 规则（`lib/index.js:240`）排除 ⇒ **空白**是这里唯一诚实的结果（ecms 那种"显示成别的任务"需要
  工作区里存在其它 `in_progress` + 有 branch 的任务才会出现）。**同类根因，不同症状。**
- 临时修复：用 **官方 pwsh 工具**（它自带真实 `DSH_SESSION_ID`，无任何 override）执行
  `.scratch/activate-session-task.py` → Trellis 自己算出 `dsh_session-4a220f8c-…` 并写入指针；
  `task.json` 仍是 `planning` / `branch: null`。随后状态栏渲染
  `[P2] 修复 statusline 会话任务误报（会话身份链路） · planning`（单任务形态：无角色、不可点击）。
- **同一会话里两个 shell 给出两个答案（R1 设计的直接证据）**：
  `task.py current --source` 经官方 pwsh → `Source: session:dsh_session-4a220f8c-…`；
  经自定义 bash → `Source: none`。唯一差别就是 `DSH_SESSION_ID` 的有无。
- 官方工具链锚点：`dsh-tool-bash/lib/index.js:395`、`dsh-tool-pwsh/lib/index.js:373` 调 `ctx.shellEnv.collect(exec)`；
  `dsh-shell-env/lib/index.js:80-96` 仅在 `execution.agent !== undefined` 时注入 `DSH_SESSION_ID`；
  `dsh-bash-local/lib/index.js:176,199`（及 `dsh-pwsh-local`）把 `dshEnv` 合并进子进程环境；
  官方 `tool-bash` 在 win32 被 `disabled`（`dsh-agent-presets/presets/ptc/agent.cordis.yml:52-54`）⇒ Windows 官方 shell 是 pwsh。
  实测：官方 pwsh 的 env 含 `DSH_HOME / DSH_SESSION_ID / DSH_SHELL=1 / DSH_WEB_URL`（经 `run_code`/PTC 派发也一样），
  自定义 bash 一个都没有。
- Claude Code 为何一直正常（两条独立路径）：官方文档 `CLAUDE_CODE_SESSION_ID` = "Set automatically to the current
  session ID in **Bash and PowerShell tool subprocesses**, hook command subprocesses, and stdio MCP server subprocesses"
  （Trellis 的 claude 条目就是它，见 `active_task.py:78-81`）；另有 `CLAUDE_ENV_FILE` —— Trellis 的
  `.claude/hooks/session-start.py:278-306` 把 `export TRELLIS_CONTEXT_ID=<key>` 追加进去，Claude 在每条 Bash 命令前 source 它。
  ⇒ `claude_<uuid>.json` 指针一直能写出来（`.trellis/.backup-*` 里可见实证）。

### 实现记录（2026-09-17：R1 已落地，待真机验收）

- `task.py start` 已执行（经**官方 pwsh**、真实身份，非 override）：`Source: session:dsh_session-4a220f8c-…`、
  `Status: planning → in_progress`、`Branch recorded: master`。⚠️ `master` 与 base_branch 相同，归档前需 `set-branch` 或 `--skip-branch-validation`。
- 改动（子模块 `dsh-plugin-ptc-bash`，共 +107/-2，未提交）：
  `presets/ptc-bash/dsh-bash-win.mjs`（头注释 + `inject` 加 `shellEnv` + `collectShellEnv()` + spawn spec 显式 `env`）、
  `test/plugins.test.mjs`（`makeCtx` 增 `shellEnv`；新增 4 个用例：inject 声明、前台 overlay、后台 overlay、三种降级）、
  `README.md`（「会话身份（DSH_*）」小节 + 新会话验收命令）。
- 自检：基线 `npm test` 25/25 → 现在 **29/29**；`node --check` 通过（工具/测试/lib）；LF 保持。
- **伪证检验**：把工具文件还原到 HEAD、保留新用例 → 新增的 3 条正向断言如预期失败（pass 26 / fail 3），恢复后 29/29 ⇒ 用例真的在测这次改动。
- 落地：`node .scratch/land-sync.mjs` → `copied: dsh-bash-win.mjs`；与仓库源 `cmp` 一致；二次运行 0 copied / 4 skipped（幂等）。
- **待办 AC-R1.2 / AC-R1.3（需要用户新开会话）**：本会话仍挂旧模块，故新会话里才能验证
  `env | grep '^DSH_'` 出现 `DSH_SESSION_ID`、以及 `task.py create` 写出会话指针。若新会话仍为 None，回退手段是重启 dsh（让 boot sync + 预设重新挂载）。
- 未提交：按 AGENTS.md 等用户明确同意再 git commit/push（子模块 + meta 指针两步）。

### 真机验收（2026-09-17，新会话 `session-61758d0f-…`，`ptc-bash` 预设）—— AC-R1.1~R1.5 全部通过

> 用户新开会话后，本任务在**自定义 bash 工具**上完成真机验收（无任何 `TRELLIS_*` override）。

**AC-R1.2 身份到达（改动前为 None）**

```
$ env | grep -E '^DSH_'        # 自定义 bash（dsh-bash-win）
DSH_HOME=C:\Users\Hasee\.dsh
DSH_SESSION_ID=session-61758d0f-8b4b-42ac-a086-ca506caa3152
DSH_SHELL=1
DSH_WEB_URL=http://127.0.0.1:3080

$ python -c "...from common.active_task import resolve_context_key;print(resolve_context_key())"
dsh_session-61758d0f-8b4b-42ac-a086-ca506caa3152
```

**AC-R1.3 端到端落盘（一次性仓库 `.scratch/trellis-exp`，经 bash）**

```
$ python ./.trellis/scripts/task.py create "E2E 身份验证" --description "verify DSH_SESSION_ID wiring" --slug e2e-identity
Activated task for this session: .trellis/tasks/09-17-e2e-identity
Source: session:dsh_session-61758d0f-8b4b-42ac-a086-ca506caa3152
Created task: 09-17-e2e-identity

$ cat .trellis/.runtime/sessions/dsh_session-61758d0f-....json
{ "platform": "dsh", "last_seen_at": "2026-09-17T01:53:37Z",
  "current_task": ".trellis/tasks/09-17-e2e-identity", "current_run": null }
```

无降级提示；指针生成且 `current_task` 指向新任务 ⇒ brainstorm 阶段"创建即写指针"的原设计恢复。

**真实工作区闭环**：经 bash 跑 `task.py start 09-16-statusline-session-identity` →
`✓ Current task set to: .trellis/tasks/09-16-statusline-session-identity` + `Source: session:dsh_session-61758d0f-…`（同样无降级），
真实 `.trellis/.runtime/sessions/` 生成**本会话**指针；状态栏 host 半边（真实 `lib/index.js` + 真实 cwd，见 `.scratch/probe-current-session.mjs`）渲染：

```
pill: [P2] 修复 statusline 会话任务误报（会话身份链路） · in_progress      # 单任务形态：无角色、不可点击
```

**AC-R1.1 / AC-R1.5**：`npm test` **29/29 全绿**（基线 25/25）；`node --check presets/ptc-bash/dsh-bash-win.mjs` 通过；
仓库源与 `$DSH_HOME/.agent-presets/ptc-bash/dsh-bash-win.mjs` `cmp` 一致（幂等 sync 未漂移）。

**AC-R1.4 回归**：官方 pwsh 的四个 `DSH_*` 与 bash 一致（不变）；bash 的 `[exit code: 7]` 标记、`[timed out after 1500ms]`、
`workdir` 生效、后台 job 正常且**后台子进程同样**拿到 `DSH_SESSION_ID`/`DSH_SHELL`（与单测的后台 overlay 用例互证）。

**R2/D1 追加证据**：对"工作区已注册、但会话没有指针"的会话，host 半边仍把工作区扫描结果**原样**呈现
（`{"status":"ok","task":{...}}`，本工作区里即本任务，与真实会话任务不可区分）；cwd 不可解析时才返回 `{"status":"none"}`。
⇒ R2 的"无会话级证据不得伪装"问题仍在，D1 待用户定案。

**结论**：R1（会话身份链路）修复真机通过，AC-R1.1~AC-R1.5 全部满足；下一步是 R2/R3/R4（阻塞于 D1/D2）。

### R2/R3 实现与验证（2026-09-17，D1 定案后）

**决定**：用户定案 **D1=(a)「什么都不显示」**——无会话级证据时 pill 不渲染；并明确「Trellis 指针是唯一无风险可信的来源，推断这个行为本身就不可靠，不做」⇒ D2 的选项 (c)「活会话事件推断」与 zstd 日志解码一并否决，不列入实现。

**改动**（子模块 `dsh-plugin-trellis-statusline`，未提交）：

- `lib/index.js`：`readTask` 只走指针（`const task = await readPointedTask(cwd, sessionId)`）；删除随扫描死掉的
  `scanTasks`、`statusRank`、`RUNNING_STATUSES`（-51 行）；文件头链路说明、`contextKey`、`parseTask`、
  `readPointedTask`、`readActiveNodes`、`readTask` 的注释同步改写。
- `lib/client.js`：仅 `STATE_KEYS` 一处注释（渲染路径与行为零改动）。
- `test/host.test.mjs`：解析组重写为「指针是唯一证据」——新增 4 条 AC-S1 断言（工作区里有 `in_progress` **且有 branch**
  的任务但本会话无指针 ⇒ `{status:'none'}`；陈旧指针 ⇒ none；越界指针 ⇒ none；脚手架任务有没有 branch 都不算本会话任务）；
  `cwd` 两条断言改为**经指针观测**（指针文件只在解析出的 cwd 下，故解析出任务即证明 cwd 来源正确）；archive 用例改走树路径
  （手移到 `tasks/archive/` 的子节点不进入父任务的结构）。
- `README.md` / `docs/design-notes.md`：任务来源链改为「cwd → 指针 → 无证据即空白」，删掉 branch 规则与
  「显示成工作区最新任务」的兜底叙述，troubleshooting 改写，断言数 197→195，design-notes 增「Why the workspace scan was
  removed (2026-09-17)」一节（含 ecms 三会话误报的实测结论与备选方案否决理由）。

**验证**：

- `node --check lib/index.js && node --check lib/client.js` 通过。
- `npm test` **195/195 全绿**（host 58 / client 45 / cell 81 / integration 11；改动前同样全绿，见上「真机验收」的 11/11 摘要）。
- **伪证检验**：临时把 `lib/index.js` 还原到 HEAD、保留新断言 ⇒ host 组 **54/58**，恰好那 4 条新断言失败；恢复后 58/58，
  且与还原前的副本 `cmp` 字节一致 ⇒ 新断言确实在测这次改动。
- 真机探针 `.scratch/probe-current-session.mjs`（真实 host 半边 + 真实 cwd，同一个探针改动前后各跑一次）：
  - 本会话（有指针）⇒ `[P2] 修复 statusline 会话任务误报（会话身份链路） · in_progress`（单任务形态：无角色、不可点击）；
  - 同工作区「工作区已注册、但本会话无指针」⇒ `{"status":"none"}`（**改动前同一探针返回扫描到的任务**，见上「真机验收」）；
  - cwd 不可解析的会话 ⇒ `{"status":"none"}`。
- 生效范围：host 半边随 dsh 启动挂载 ⇒ 实时 GUI 需**重启 dsh**（或插件重载）后才跑新代码；client 半边只有注释改动，无需重建。

**遗留**：ecms 实例那三个会话的指针是先前手工补的（见「进展快照」），本改动不影响它们（有指针 ⇒ 正常显示）。

## Requirements

- **R1（会话身份可用，根因）**：让 dsh 会话的模型侧 shell 重新拿到 `DSH_SESSION_ID`（与 `DSH_SHELL`），使 `task.py create|start` 不再进入降级模式、Trellis 照设计写 `dsh_session-<uuid>.json` 指针。
  - 落点（已核）：**手写维护的** `dsh-plugin-ptc-bash/presets/ptc-bash/dsh-bash-win.mjs`（`tools/derive-preset.mjs` 只派生 `agent.cordis.yml` 与 `workspace-instructions.mjs`，本文件不在其中——见该脚本头注释）。
    两处改动：① `inject` 增 `'shellEnv'`；② `spawnSpec` 增显式 `env: ctx.shellEnv.collect(exec)`（`dsh-subprocess` 会剥掉 ambient `DSH_*`，spec 的 `env` 是唯一受支持通道）。
    设计见 `design.md`，执行清单见 `implement.md`。
  - 第三方 `liangshen` 预设（`@linxin666/dsh-web-all`）的同一缺陷不在本仓库修，只记录/上报。
  - **生效范围**：预设模块在会话挂载时加载 ⇒ 只对**改动后新开的会话**生效（老会话沿用旧模块）。
- **R2（不再误报）**：状态栏在**没有会话级证据**时不得把工作区扫描结果呈现为"本会话任务"：不得打 `父任务/子任务` 角色、不得在树里把某个任务标为本会话当前。具体形态见"待决策 D1"。
- **R3（树的一致性）**：当本会话任务已知（指针或其它会话级证据）时，pill 的角色与下拉树的 `current` 必须都指向该任务，且祖先/子结构按 `task.json` 的 `parent/children` 正确呈现（现有建树逻辑 `lib/index.js:265-405` 已满足，只需保证输入 `currentId` 正确）。
- **R4（验证留痕）**：根因与回归证据要能从仓库内复现（探针脚本进 `.scratch/` 或测试用例），`npm test` 全绿，且新增用例覆盖"无指针不误报"与"指针存在时子任务角色正确"。

## Acceptance Criteria

**R1 组（dsh-bash-win 会话身份；本次计划覆盖，可开工验收）**

- **AC-R1.1（单测）**：`dsh-plugin-ptc-bash` 的 `npm test` 全绿；新增用例覆盖 overlay 传递（前台+后台）、`collect` 收到本次 `exec`、以及三种降级（服务缺失 / `collect` 抛错 / 空 overlay）下工具仍可用且 spec 无 `env` 键。
- **AC-R1.2（真机·身份到达）**：**新开**的 dsh 会话（`ptc-bash` 预设）里，经自定义 **bash** 工具 `env | grep '^DSH_'` 出现 `DSH_SESSION_ID=session-<该会话>`（与 `DSH_SHELL`/`DSH_HOME`）；`resolve_context_key()` 返回 `dsh_session-<id>`（改动前为 `None`）。
- **AC-R1.3（真机·端到端落盘）**：同一新会话里，经 bash 在一次性仓库（`.scratch/trellis-exp`）跑 `task.py create` → `.trellis/.runtime/sessions/dsh_session-<id>.json` 生成且 `current_task` 指向新任务（即 brainstorm 创建即写指针的原设计恢复）；状态栏 10s 内显示该任务。
- **AC-R1.4（回归）**：官方 `pwsh` 的 `DSH_SESSION_ID` 不变；bash 工具的 exit-code 标记、`workdir`、后台 job、超时行为不变；老会话不受影响。
- **AC-R1.5（不变量）**：`node --check presets/ptc-bash/dsh-bash-win.mjs` 通过；`$DSH_HOME/.agent-presets/ptc-bash/dsh-bash-win.mjs` 与仓库源 `cmp` 一致（不许手改生成物）。

**状态栏组（R2/R3；D1 定案后验收）**

- **AC-S1**：对无指针的会话（例如 ecms 里"模锻球阀物料编号调查"那个），状态栏**不再**显示 `09-15-iot-agg-material-output-rank`，也不显示任何 `父任务/子任务` 角色（形态按 D1 定案）。
- **AC-S2**：指针存在时，子任务会话的 pill 逐字为 `[P2] <子任务标题> · planning · 子任务`，下拉树把该子任务标为当前、父任务为其祖先（已在 `.scratch/trellis-exp` 复现，需回归为测试断言）。
- **AC-S3**：`node --check lib/index.js && node --check lib/client.js` 通过；`npm test` 全绿（含新增用例）；host 半边"只读 `.trellis/`"的不变量不被破坏。

## Out of Scope

- ecms-backend 的 Java 业务代码或任何具体项目内容（只把它的 `.trellis` 当作实例数据与验收样本）。
- 修改 Trellis 本体（`.trellis/scripts/**`）或其上游行为；plugin 仍然只读 `.trellis/`。
- 修第三方 `liangshen` 预设（`@linxin666/dsh-web-all`）：只在文档/上报里处理。
- 状态栏的样式、席位、下拉交互设计（除非 D1 定案要求去掉某个交互面）。
- 让 plugin 自己去写 Trellis 运行时状态（违反其"纯只读"硬约束，除非用户在 D2 明确要求）。

## 待决策

- **D2（2026-09-17 部分定案）**：用户已要求制定 `dsh-bash-win` 修复计划 ⇒ **R1 进入本次范围**（`design.md` + `implement.md` 已就绪，开工需显式批准）。
  仍未定：R2/R3（状态栏侧）是否并入本任务、以及是否允许为历史会话补指针（存量 3 条已按用户指示手工补过，见上"进展快照"）。
- **D1（必须用户定，阻塞 R2）**：无会话级证据时，pill 显示什么？
  - (a) 什么都不显示（宁缺毋滥，最保守）；
  - (b) 显示扫描到的任务，但**明确标注为工作区级推测**（无角色、样式弱化，例如 `[P2] 标题 · 进行中 · 工作区`）；
  - (c) 保持现状（继续当真）。
  推荐 (b)：保留信息量又不会撒谎；(a) 会让身份链路没修好的工作区完全看不到东西。
- **D2 的剩余选项（供用户选择 R2/R3 的走向）**：(a) 并入本任务一起做；(b) 只做状态栏本身、不动 ptc-bash；
  (c) 另加"从活会话事件推断任务"的兜底路径（能修好无指针会话的显示，但引入对 dsh 会话事件形状的耦合与每轮事件扫描成本；
  注：读会话日志文件那条路已实测不可行 —— 多帧 zstd，Node 内置解码只出第一帧）。
