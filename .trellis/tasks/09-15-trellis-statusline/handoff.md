# handoff.md — 交给「创造模式」会话的接续对话

> 复制下面 `---` 之间的整段，粘贴到创造模式会话即可接续。
> 本文件只是便签，不是 Trellis 标准产物（标准产物：prd.md / design.md / implement.md）。

---

接续任务：**Trellis statusline（dsh web 插件）**。仓库根 `D:\project\dsh\dsh-plugin`（Windows / Git Bash，命令一律 `python ./.trellis/scripts/...`）。

**第一步**
1. 加载 `trellis-continue` 技能（`.dsh/skills/trellis-continue`），按它读出当前任务状态。
2. 依次读 `.trellis/tasks/09-15-trellis-statusline/` 下的 `prd.md` → `design.md` → `implement.md`。

**当前状态**
- 规划已完成（证据实测、决策已定、产物齐全），**尚未写任何代码**；任务由 `task.py create` 建好但还没 `start`。
- 我（用户）批准规划摘要，直接进入实现：
  `python ./.trellis/scripts/task.py start .trellis/tasks/09-15-trellis-statusline --allow-empty-context`
  （dsh 是 inline 工作流、没有 jsonl manifests，所以必须带 `--allow-empty-context`。）
- 实现前先加载 `trellis-before-dev`；实现完用 `trellis-check` 自检；收尾用 `trellis-update-spec` + 提交。

**目标一句话**：在 dsh web 的会话头部常驻显示「当前会话所在工作区的活动 Trellis 任务」（形如 `[P1] 标题 · 进行中`）。

**已定决策（不用再问）**
- **D1 口径**：client 拿 `sessionId` → host 解析该会话 `cwd` → 若 `<cwd>/.trellis/.runtime/sessions/dsh_<sessionId>.json` 的 `current_task` 有效则优先 → 否则扫描 `<cwd>/.trellis/tasks/*/task.json`（`in_progress` > `planning`，同级取目录名字典序最大）→ 都没有则空态。
- **D2 席位**：`conversation.session.header.utilities`（list / scope session）**追加**一个 cell，不替换官方 cell。
- **D3 默认值**：空态不渲染、点击无行为、`order: 5`、轮询 10s。
- **交付位置**：新建目录 `dsh-plugin-trellis-statusline`，先作为普通目录开发；真机验证通过后再谈子模块注册。

**关键实测事实（省掉重复调研，出处见 design.md §2–§3）**
- 同席位官方 cell 的签名是 `({ sessionId, useSessions, t })`（`dsh-client-ui-jobs/lib/client.js:117`）→ 席位组件能直接拿到会话 id。
- `.utilities` 是 `kind: list, scope: session`，且空时 `:empty{display:none}` 自动隐藏 → 空态返回 `null` 即可，不占位（官方 jobs cell 同风格）。
- **hero（新建会话）阶段整块 header 不渲染** → 新会话看不到，这是 D2 已接受的代价，不要为此补第二个席位。
- `DSH_SESSION_ID` 是 **dsh 的**变量（`@deepseek-ai/dsh-shell-env` 的 `collect()` 注入 `execution.agent.session.header.id`；`dsh-terminal-bash` 也会设），Trellis 只读它。本机 agent 经 `run_code` 调 bash 时观测不到（连 `DSH_HOME`/`DSH_SHELL` 都没有）→ **不要把设计建在它上面**。
- 会话 → 工作区两条线索：磁盘 `~/.dsh/sessions/<slug>/session-<uuid>/`（里面只有 `session.v3.jsonl.zstd`）；会话记录含 `cwd`（`dsh-api-session-controller` 的 `id, cwd, title, updatedAt, running …`）。
- 平台通用契约（bundle 格式、`inject` 声明、RPC 信封与 payload 必填、槽名 vs `id`/`key`、`apply` 不抛、零依赖、harness 写法）见 `.trellis/spec/dsh-plugin-ollama-usage/frontend/` 六个文件——新包同样适用。

**执行顺序**：照 `implement.md` 六步走。第 0 步是三项实测复核（client 的 `sessionId` 是否等于磁盘目录名 `session-<uuid>`；host 能否查到会话 `cwd`；交互式 dsh 是否真带 `DSH_SESSION_ID`），**结论必须回写 design.md §2.1**。之后依次：包骨架 → 先写三套 harness（host / client / cell）→ host 实现 → client 实现 → 真机验证（`--dump-config` + 带 cookie 的 RPC 探针 + 重启后目视）→ 收尾（README、spec 更新、提交）。

**硬约束**：只读 `.trellis/`（绝不写入）；host 半边不 import 任何 `@deepseek-ai/*`；client 只 `require('react')`；`apply` 绝不抛（可选面 try/catch 降级）；提交顺序 = 插件仓库先、meta-repo 指针后。

**验收**：AC1–AC6 见 `prd.md`；其中 AC6 = 运行前后对目标工作区 `.trellis/`（文件清单 + mtime/hash）做快照比对，必须完全不变。

**可选**：若创造模式预设支持动态插件原型（cordis 动态插件），可以先花十几分钟把 pill 动态挂到同一席位上验证观感与几何，再落成常驻包；但 `implement.md` 是按常驻包写的，动态原型只是为了早点看到效果。

---
