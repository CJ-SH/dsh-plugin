# handoff.md — 任务现状与接续点

> 便签，不是 Trellis 标准产物（标准产物：prd.md / design.md / implement.md）。
> 2026-09-15 由本轮实现会话更新；原「交给创造模式」的启动说明已由下方现状取代。

---

## 一句话目标

在 dsh web 的**会话头部**常驻显示「当前会话所在工作区的活动 Trellis 任务」（形如 `[P2] 标题 · 进行中`）。

## 现状：AC1 已目视确认；随后按验收反馈做了两处修改，待二次重启生效

| 项 | 状态 |
|---|---|
| 步骤 0 三项实测复核 | ✅ 全部通过，结论已回写 `design.md` §2.1 / `prd.md` |
| 包实现（Host + Client + 清单 + patch） | ✅ `dsh-plugin-trellis-statusline/`，零依赖无构建 |
| `npm test` | ✅ **100/100**（host 39 · client 36 · cell 25） |
| 安装 | ✅ 已链入 web profile；`--dump-config` 有 `- id: trellis-statusline` |
| AC1 真机目视 | ✅ **用户已确认**（首次在 `.utilities` 席位可见） |
| AC6 只读 | ✅ `.trellis/` 80 文件快照（清单+mtime+size+sha256）前后比对 **0 变更** |
| trellis-check | ✅ 通过（删除了无调用方的投机 `cwd` 回退） |
| 提交（第一轮） | ✅ meta-repo `2520c79`（插件包 + spec）、`a5b00a9`（便签） |
| **二次反馈的两处修改** | ⏳ 已实现、自检通过，**待在重启后目视确认** |

## 二次反馈的两处修改（2026-09-15）

**1. 席位迁移（D2 修订）**：`conversation.session.header.utilities` → `conversation.session.header.actions`，
`order: 10`。理由：`.actions` 是 "Title-adjacent Session actions"，紧邻会话标题、横向空间更足；
用户要求 pill 紧挨「会话预设模式」(`agent-preset`, order -10) 右侧，`10` 正好夹在它与
`job-list`(20) 之间。已改 `design.md` §3、`prd.md` D2/D3、spec `seats.md`。

**2. 修复误报（D1 修订，`design.md` §2.2.1）**：用户报告其他工作区显示
`[P1] Bootstrap Guidelines · 进行中`，而其经验中不该出现。跨 5 个真实工作区实测确认是
**扫描步骤的误报**：`trellis init` 给每个项目建的 `00-bootstrap-guidelines` 一出生就是
`status: in_progress` 且永不被改（4/5 个工作区至今如此），而 **Trellis 自己从不扫描 `tasks/`**
（`resolve_active_task()` 只读会话指针）—— 只有 D1 第 3 步会把它翻出来。

修法：扫描候选**必须 `branch` 非空**。依据是 `task.py:88-131` 自己的注释 —— `task.py start`
正是那条既记录 `branch`、又写运行时指针、还把 `planning → in_progress` 的命令。
**指针路径不加此过滤**：指针本身就是"已开工"的直接证据，且非 git 仓库记录不到分支（`task.py:129-130`）。

真机前后对比（探针用无指针的 sessionId 强制走扫描路径）：

| 工作区 | 修正前 | 修正后 |
|---|---|---|
| `dsh-plugin` | `[P2] Trellis statusline plugin for dsh web · in_progress` | 同前（真任务，有分支） |
| `dsh\any` / `dsh\backwave` / `java\ecms-backend` / `python\agent_demo` | `[P1] Bootstrap Guidelines · in_progress` | 空态 |

副作用（已知、可接受）：非 git 工作区里"别人 start、本会话又无指针"的任务会漏报 → 空态。宁可漏报不误报。

## 下一步

**需要再次重启 dsh web**（host 半边 `lib/index.js` 是普通 ESM，改动必须重启才会重新加载），然后确认：

1. pill 从右上角 utilities 区移到了**标题右侧、会话预设模式右边**；
2. 切到 `any` / `backwave` / `ecms-backend` / `agent_demo` 这类只有脚手架任务的工作区时，
   整条 pill **不再出现**，而不是显示 Bootstrap Guidelines。

两项都确认后即可 `python ./.trellis/scripts/task.py archive .trellis/tasks/09-15-trellis-statusline`。

## 复现工具

- `node .scratch/probe-workspaces.mjs` —— 对 5 个真实工作区跑真实 host 半边，打印命中的链路结果；
  传路径参数可跑旧版本做前后对比（`node .scratch/probe-workspaces.mjs ./old-index.mjs`）。
- `node .scratch/probe-real.mjs` —— 针对本工作区的完整字段级输出。

收尾时删掉 `.scratch/` 即可。注意：**仓库根没有 `.gitignore`**，所以 `.scratch/` 实际并未被忽略
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
