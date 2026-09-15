# handoff.md — 任务现状与接续点

> 便签，不是 Trellis 标准产物（标准产物：prd.md / design.md / implement.md）。
> 2026-09-15 由本轮实现会话更新；原「交给创造模式」的启动说明已由下方现状取代。

---

## 一句话目标

在 dsh web 的**会话头部**常驻显示「当前会话所在工作区的活动 Trellis 任务」（形如 `[P2] 标题 · 进行中`）。

## 现状：实现完成并已提交，只差一项真机目视

| 项 | 状态 |
|---|---|
| 步骤 0 三项实测复核 | ✅ 全部通过，结论已回写 `design.md` §2.1 / `prd.md` |
| 包实现（Host + Client + 清单 + patch） | ✅ `dsh-plugin-trellis-statusline/`，9 文件，零依赖无构建 |
| `npm test` | ✅ **97/97**（host 36 · client 36 · cell 25） |
| 安装 | ✅ 已 `dsh plugin --profile web add` 链入；`--dump-config` 有 `- id: trellis-statusline` |
| 全链路（真实 `.trellis/` + 真实服务） | ✅ host 半边返回 `{id:'09-15-trellis-statusline', title:'Trellis statusline plugin for dsh web', status:'in_progress', priority:'P2'}` |
| AC6 只读 | ✅ `.trellis/` 80 文件快照（清单+mtime+size+sha256）前后比对 **0 变更** |
| trellis-check | ✅ 通过（删除了无调用方的投机 `cwd` 回退） |
| spec 更新 | ✅ frontend 层补入会话头部 seats 与 host 会话→工作区解析 |
| 提交 | ✅ meta-repo `2520c79`（普通目录，非子模块，按 D4） |
| **AC1 真机目视** | ⏳ **未完成 —— 需重启 dsh web** |

## 唯一剩余动作

重启 dsh web（重启会结束 agent 自身进程，只能由用户执行），重开 `http://127.0.0.1:3080`
并 resume 本会话，确认会话头部右上角出现形如
`[P2] Trellis statusline plugin for dsh web · 进行中` 的 pill。

- 出现了 → AC1 达成，可以 `python ./.trellis/scripts/task.py archive .trellis/tasks/09-15-trellis-statusline`。
- 没出现 → 先看 boot HTML 是否含该插件 bundle（证明客户端半边是否入图），
  再看浏览器 console 的 `client-half-failed`；`.scratch/probe-real.mjs` 可复现 host 半边的真实数据链路。

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
