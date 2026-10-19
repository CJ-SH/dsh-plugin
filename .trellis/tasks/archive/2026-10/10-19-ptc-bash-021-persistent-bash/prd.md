# ptc-bash 0.2.1 适配与持久 bash 执行器

## Goal

让 `ptc-bash` 预设在 `@deepseek-ai/dsh@0.2.1-rc.2` 上重新可用（当前每个请求都在提示词装配阶段失败），并在同一轮把 Windows 上的 `bash` 执行器升级到与第三方 `@linxin666/dsh-win-bash` 相当的水平：会话沙箱门禁、持久 shell、结构化结果。

目标用户：在 Windows 上使用 PTC 模式的 dsh 用户——官方 win32 侧只提供 `pwsh`，本包是他们获得 bash 方言的唯一途径。

## Background（已确认事实）

### F1 崩溃根因：`{{cwd}}` 变量在 0.2.1-rc.2 已不存在

- `presets/ptc-bash/agent.cordis.yml:33` 的 persona `suffix: Your working directory is {{cwd}}.` 原样注册为 `deployment:persona-suffix`（`@deepseek-ai/dsh-persona/lib/index.js:42-46`）。
- 渲染器对 section 文本做严格插值，未注册变量直接抛错（`@deepseek-ai/dsh-system-prompt/lib/index.js:118`、`:158-176`）。
- 0.2.1-rc.2 的循环只注册 `provider` / `model`（`@deepseek-ai/dsh-agent-loop/lib/index.js:1591-1592`）；本包 `workspace-instructions.mjs:703-704` 额外贡献 `workspace_instructions`——与报错中的变量表完全一致，确认失败装配就是本预设。
- 官方文档明确要求删除该子句：`@deepseek-ai/dsh-system-prompt/README.md:78`（中文版同款）。
- 上游 `ptc` 预设已经删掉该行：`@deepseek-ai/dsh-web-app/presets/ptc.patch.yml` 的 persona 只剩 `prefix`。

### F2 cwd 信息没有丢失，只是换了载体

`@deepseek-ai/dsh-working-directory` 在宿主层（`dsh-base/cordis.patch.yml:166`）注册 `required: true` 的运行时上下文 `Current working directory: "…"`（`dsh-working-directory/lib/index.js:56-62,122`）。因此修复动作是**删除**，不是替换变量。

### F3 为什么升级没被兼容门禁拦截

`package.json` 的 `"@deepseek-ai/dsh": "^0.2.0-rc.1"` 在运行时的门禁下接纳 `0.2.1-rc.2`：`satisfies(..., { includePrerelease: true })`（`dsh-app-boot/lib/index.js:276-277`），实测 `evaluatePluginCompatibility` 返回 `undefined`（放行）。破坏性变更因此绕过了启动检查。

### F4 官方 0.2.1-rc.2 仍然没有 Windows bash

- 官方 `ptc` 预设：`tool-bash` 在 win32 `disabled`，win32 只有 `tool-pwsh`。
- `@deepseek-ai/dsh-bash-local/README.md:141`：POSIX-only，Windows unsupported。
- `@deepseek-ai/dsh-shell/README.md:56`：Windows 的对应物是 `dsh-pwsh-local` / `dsh-pwsh-sandbox`。
- `@deepseek-ai/dsh-terminal-bash`：bash dialect 面向 POSIX，pwsh dialect 面向 Windows。
- 本包在 0.2.1 下的两个卖点（Windows bash、AGENTS.md 进系统提示词）均未被官方覆盖。

### F5 已知的上游行表漂移（**本任务不修**，见 Out of Scope）

上游 `ptc` 相对本预设的差异：删除 `delegation/tool-ralph`、`tool-subagent-codex`、`tool-subagent-claude-code`；新增 `time-context`、`tool-schedule`、`tool-plugin-market`；`plan-mode` 文案与两条 `tool-subagent` 的 `backgroundMode` 有差异。`npm test` 因此有 2 项红（漂移断言；以及 `evaluatePluginCompatibility` 结果形状从 `.peers` 改为 `.requirements`）。

### F6 当前执行器的能力缺口（对照 `@linxin666/dsh-win-bash@0.4.7`）

- 每次调用 `bash -c` 新进程，状态不保留（`dsh-bash-win.mjs:264` 的 tool 描述明说）。
- 不解析会话 `sandboxPolicy`，受限会话里仍以宿主权限执行命令。
- 输出只有 `text` + `jobId`，截断信息混在文本里。
- 相对优势（必须保留）：通过 `ctx.shellEnv.collect(exec)` 注入 `DSH_*` 会话事实（`dsh-bash-win.mjs:288-300`）；注册官方 `tool:bash` 提示词段（`:250-254`）；零负载、预设无关、保留 `pwsh` 兜底。

### F7 参考实现的关键语义（`win_bash`）

- 每会话一个持久 `bash -s`，`cd`/`export`/函数/别名跨调用保留。
- `workdir` 被改写为 `cd <dir> && <command>`，因此**会持久改变**该 shell 的 cwd。
- 超时/中断直接停掉 shell，下一次调用起新 shell 并告知模型。
- 后台任务走**独立进程**（会话 shell 内的 `&` 会随 shell 终止）。
- 环境契约固定（私有 TMPDIR、`MSYSTEM=MSYS`、`TERM=dumb`），**不注入 `DSH_*`**。
- 非 `danger-full-access` 会话直接 `SANDBOX_UNSUPPORTED` 拒绝；策略服务缺失也拒绝。
- 仅在 `liangshen` 预设已声明时注册；默认从工具面撤下 `pwsh`。

## Requirements

### R1 崩溃修复（必须）

删除 persona `suffix` 中的 `{{cwd}}` 子句及其过时注释；任何内置/预设 section 不得再引用未注册的提示词变量。

### R2 会话沙箱门禁（必须）

`bash` 工具在 `execute` 前解析**调用会话**的 sandbox policy：

- 非 `danger-full-access` → 返回明确错误（含 `SANDBOX_UNSUPPORTED` 语义），**不 spawn 任何进程**，并在文案中指向 `pwsh`。
- 判定必须使用会话自身模式（会话模式优先于部署默认）。
- 策略服务缺失时的行为按 Assumption A1 处理。

### R3 持久 shell（必须）

- 每个会话（owner）独占一个长期 `bash` 进程；cwd、导出的变量、函数、别名跨调用保留。
- `workdir` 语义按 D1（`cd` 持久改变）；不带 `workdir` 的调用沿用 shell 当前目录，相对路径按会话 cwd 解析。
- 超时或调用被中断时停止该 shell；下一次调用启动新 shell，并在结果中说明状态已重置。
- `run_in_background` 使用**独立进程**，不污染会话 shell 的状态。
- 会话销毁/插件卸载时清理 shell；一个会话的 shell 不得被另一个会话复用。
- 工具描述与 `tool:bash` 提示词段必须改为持久语义（现有 "State does NOT persist" 表述作废）。

### R4 结构化结果（必须）

工具输出在保留 `text`（渲染/回放兼容）之外，新增结构化字段：`stdout`、`stderr`、`exitCode`、stdout/stderr 截断标记、spill 路径、`jobId`（后台时）。字段命名与语义对齐 `win_bash`，便于后续 UI 与回放消费。

### R5 文档与测试同步（必须）

- 更新 `presets/ptc-bash/dsh-bash-win.mjs` 文件头、`README.md` / `README.zh.md` 与 `docs/design-notes.md` 中关于"无状态 / 无沙箱检查"的表述。
- 为 R2/R3/R4 增加单元测试（沙箱门禁拒绝、跨调用状态保留、超时重置、结构化字段）。

## Acceptance Criteria

- [x] AC1 新建会话选择 `PTC + Bash 模式` 后可以正常发起请求，不再出现 `unknown prompt variable "{{cwd}}"`。离线半边已验证：预设内只剩 `{{model}}` 与 `{{workspace_instructions}}`，二者均已注册；端到端由用户在 2026-10-19 手动验证通过。
- [x] AC2 受限（非 `danger-full-access`）会话调用 `bash` 返回可读的拒绝错误，且没有子进程被创建（单测断言 `spawns.length === 0`）。
- [x] AC3 同一会话内 `cd /tmp && pwd` 之后的 `pwd` 仍显示 `/tmp`；超时后下一次调用得到新 shell 且说明已重置（单测 + 真实 Git Bash 冒烟）。
- [x] AC3b 一次带 `workdir` 的调用之后，下一次**不带** `workdir` 的调用仍在该目录（单测断言帧内 `cd -- …`，真实 Git Bash 冒烟确认）。
- [x] AC4 结果同时带 `text` 与结构化字段；文本仍包含 `[exit code: N]` / `[timed out …]` / `[stderr]` 语义。
- [x] AC5 后台命令在会话 shell 被终止后仍可被 `job_output` 收集（独立进程，单测断言 `bash -c` argv）。
- [x] AC6 shell 内可读到 `DSH_SESSION_ID`（spawn spec 的 `env` 断言；shell 启动时取一次）。
- [x] AC7 相关用例全通过（`plugins.test.mjs` 25/25）；F5 的两项红保持原样并记录在案（70 tests / 68 pass / 2 fail）。

## Out of Scope

- **F5 的行表同步**：不删除 `tool-ralph` / codex / claude-code，不新增 `time-context` / `tool-schedule` / `tool-plugin-market`，不改 `plan-mode` 文案与 `backgroundMode`；不修 `composition-health.test.mjs` 的漂移与 `.peers` 断言。两项红保留，另行开任务。
- peer 范围 / `engines.dsh` 调整。
- vendored MinGit payload（16.1 MB）与 SHA256 校验。
- 默认从工具面撤下 `pwsh`。
- 把工具改名为 `win_bash`。
- 版本号提升、git 提交、发布（需用户另行批准）。

## Assumptions（非阻塞，若不同意请在批准前指出）

- **A1** `sandboxPolicy` 服务缺失时**放行**并只警告一次（预设需能在未组合该服务的部署里挂载）；服务存在则严格按 R2 执行。这与 `win_bash` 的"缺失即拒绝"不同。
- **A2** 超时/中断采用"停 shell + 下次重建"，不尝试向单条命令发送中断。
- **A3** 结构化字段采用 design §2.7 的 `win_bash` 命名集合：`stdout`、`stderr`、`exitCode`、`timedOut`、`stdoutTruncated`、`stderrTruncated`、`stdoutLostHead`、`stderrLostHead`、`stdoutSpillPath`、`stderrSpillPath`、`jobId`。
- **A4** 沿用现有 `timeoutMs` / `maxTimeoutMs` / `maxOutputBytes` / `bashPath` / `enableRunInBackground` 配置键，不引入 `win_bash` 的配置名。

## Decisions

- **D1** `workdir` 采用 `cd` 持久改变（对齐 `win_bash`），而不是子 shell 隔离。理由：终端手感一致，且模型可用显式 `cd` 覆盖；代价是一次带 `workdir` 的调用会悄悄改变后续调用的目录，工具描述必须写明。
- **D2** 沙箱门禁用会话自身的 `sandboxPolicy.resolve({ session })`，会话模式优先于部署默认。
- **D3** 截断保留输出**尾部**（与 subprocess collector 的内存尾部语义、以及 `win_bash` 一致），丢失头部时在结构化字段与文本中明确标注。

