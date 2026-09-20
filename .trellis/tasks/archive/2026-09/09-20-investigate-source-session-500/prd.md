# 源会话「本轮运行失败 500」定位与归因

> 父任务：`09-20-new-session-workspace-task`（[P2] 新会话不显示工作区活动任务）。
> 本任务只做**定位 + 归因 + 可判定性**，不修代码（无 design.md / implement.md）。

## Goal

1. **定位**「[P2] 新会话不显示工作区活动任务」原本所在的会话（谁创建/驱动了这个任务）。
2. **归因**该会话里出现的 `本轮运行失败500: {"message":"Internal Server Error (ref: 386be7ca-2c09-4320-8446-9136f28fbadd)",...}`：
   这条 UI 文案从哪来、上游为什么 500、是否 dsh 侧问题。

用户价值：知道这条 500 是"上游内部错误被原样抛出且 dsh 无法自愈"，还是"本地会话状态坏了"；据此决定要不要修、修哪一侧，并且拿到可向上游报障的 `ref`。

## 背景与已确认事实（2026-09-20 实测）

### 1. 源会话（已定位）

- 工作区会话指针：`.trellis/.runtime/sessions/dsh_session-4a220f8c-7bc5-48af-80f3-a4239bdca751.json`
  → `{"platform":"dsh","last_seen_at":"2026-09-20T03:24:36Z","current_task":".trellis/tasks/09-20-new-session-workspace-task"}`。
- 被指会话 = `session-4a220f8c-7bc5-48af-80f3-a4239bdca751`；日志
  `~/.dsh/sessions/--D-project-dsh-dsh-plugin--/<id>/session.v3.jsonl.zstd`（压缩 2.6 MB / 解压 9.1 MB / 3063 条记录）；
  `cwd = D:\project\dsh\dsh-plugin`、`agentPreset = ptc-bash`；创建于 2026-09-16 16:37:38，最后写入 2026-09-20 15:36:58（turn 22 被用户中止）。
- 交叉验证：日志内 `09-20-new-session-workspace-task` 出现 **305 次**，最早一次是 2026-09-20 **10:43:43** 的 `task.py create`（seq 1380）；
  `.scratch/restore-pointers.py` 只对 ecms-backend 生效、未触碰本工作区指针 ⇒ 指针可信。

### 2. 报错锚点（`386be7ca…` 的确切出处）

| 时间（本地） | 位置 | ref / 结果 |
|---|---|---|
| 15:30:46 | t20/s3 成功（最后一条成功调用） | usage `total=655437, cacheRead=654720, in=374, out=343` |
| **15:30:50** | **t20/s4 首次 500（第一次出现）** | `b8fb91a4-01dd-4052-92b8-f5532af3bda4`，随后 3aa2eb8e… / d8b48dec… / 5d01d180… 各失败一次，第 5 次为 TRANSPORT |
| 15:31:19 | t20 `turn/end` `kind=error` | `5d348310-dfc3-497a-92ad-062dad6a1418` |
| 15:35:35 | **t21 `turn/end` `kind=error`（用户引用的是这一条）** | `386be7ca-2c09-4320-8446-9136f28fbadd` |
| 15:36:43–15:36:58 | t22 再次连续 500，用户中止 | `3ccebdaa…/aa23fe35…` 等 |

- 原文：`500: {"message":"Internal Server Error (ref: <uuid>)","type":"api_error","param":null,"code":null}`，`code = SERVER`。
- 触发点：t20/s4 相对上一条成功请求只多了 s3 的 assistant tool-call（343 output tokens）+ 一条 56 字节工具结果（`44/44 passed…`）。
- **此后该会话每一次 LLM 调用都 500**（t20/s4、t21/s1、t22/s1），无自愈。

### 3. 失败链路（为什么 UI 上是这句话）

- provider/model/api = `ollama` / `deepseek-v4.1-flash` / `openai-completions`；每步重试 5 次（`llm/retry`，policy `mode=normal, maxRetries=5`）。
- 错误分类：`dsh-llm-pi-ai/lib/index.js:1372` `if (/\b5\d\d\b/.test(message)) return "SERVER"` ⇒ 归为可重试的 SERVER；重试耗尽 → turn 以 `kind:error` 结束。
- UI 文案：`dsh-client-ui-chat/lib/client.js:2697` `"message.turnError": "本轮运行失败"` ⇒ 渲染为「本轮运行失败」+ 原始 message，即用户看到的 `本轮运行失败500: {…}`。
- 上下文溢出保护**未触发**：`dsh-llm-pi-ai/lib/index.js:1389` 的 `isContextOverflow(message, contextWindow)` 依赖溢出文案 + 配置的 `contextWindow`（本机 settings 该模型为 1,000,000），而本例 payload 只有 `api_error`。

### 4. 已推翻的假设（量化反证）

- **不是上游整体故障**：同一会话 15:30:46 成功、15:30:50 失败（相隔 4 秒）；09-14/09-15 其它会话用同一 provider/model/api 跑到 **801,758 / 803,810 tokens** 且 0 错误轮。
- **不是"上下文太大"的硬墙**：本会话在 `total≈655k` 起永久失败，而 `66d44746` 在 **803,810**、`cecc8255` 在 **801,758** 正常。

### 5. 存活假设（尚未判定）

- **H1（主）**：该会话自 t20/s4 起的请求 payload 对上游是"毒"——上游对其中某条内容/前缀解析失败而返回 500（`api_error` 不给细节），dsh 无裁剪/压缩，重试必然带上同一前缀 ⇒ 永久失败。
- **H2**：上游缓存层对该会话 ~655k 的 cached prefix 出问题（与 H1 同一段前缀，同源）。
- **H3（弱）**：15:30:48 之后上游瞬时故障。与"同会话 4 秒前成功"相冲突；但 15:30:50–15:39:57 之间无其它会话发起请求，缺同时刻对照，只能靠实验区分。

### 6. 证据缺口

- 会话日志**不含请求 payload**（只有 `assistant/attempt` 的流式 chunk 与 usage）；`~/.dsh` 下无 dsh 服务端日志目录、无 `*.log`；全量扫描 41 个会话日志，`386be7ca`、`Internal Server Error` 仅出现在上述记录中。
- 判定 H1/H3 的最小实验：**在 GUI 里 resume 该会话并发一句「继续」**——仍 500 ⇒ payload 层持久毒（H1/H2）；恢复正常 ⇒ 上游瞬时故障（H3）。

### 7. 工具性事实（复用）

- dsh 会话日志是**多帧 zstd**：`zstdDecompressSync()` 与 `createZstdDecompress()` 都只解第一帧（≈200 字节）；必须按魔数 `28 B5 2F FD` 切帧逐帧解压。现有脚本：`.scratch/zstd-frames.mjs`，探针 `.scratch/probe-*.mjs`、`.scratch/scan-500*.mjs`。

### 8. 重放方案（用户选定 B）的可行性与形态

- **key 不在进程环境里**：本 agent 的 shell 是 dsh 的子进程，`OLLAMA_API_KEY` 缺失 ⇒ dsh 进程自身也没有该环境变量，它是在运行时从凭据库解析的。
- `~/.dsh/.credentials.yaml` 只存**引用**：`refs.OLLAMA_API_KEY` = 57 字符不透明值（且与 `DEEPSEEK_API_KEY` 完全相同，非任何 provider key 形态），records 里只有 `client-connection/browser-session`；`dsh-credentials` 只通过 `ctx.credentials.resolve()` 在 dsh 内取值，**无 CLI dump** ⇒ 重放必须由用户提供 key（贴给 agent，或用户自己在 shell 里跑）。
- **重放载荷已重建**（`.scratch/replay-500.mjs`，只读日志）：截到 t20/s3（seq 2998，最后一次成功请求的状态）= **662 条消息**（user 27 / assistant 326 / tool 309）、请求体 **1.21 MB**；粗估 ~36 万 tokens（provider 侧真实 ~655,094 ⇒ 缺 system prompt(~105 KB)、工具 schema、reasoning 块）。
- **保真度取舍（有证据支撑）**：同会话 4 秒前用同一 system prompt 成功 ⇒ 致错增量必然落在**消息前缀**里，所以"缺 system prompt/tools"的合成重放仍能检验 H1；但结论强度不对称——**500 ⇒ 强证据**（该内容至今仍让上游出错）；**200 ⇒ 只能算"未复现"**（不排除与缺失部分相关的组合条件），此时应补做 GUI resume 实验。

## Requirements

- **R1 定位源会话**：给出 session id、cwd、生命周期、以及"它拥有该任务"的证据（指针文件 + 日志内 task.py 痕迹），不靠旁证（如 mtime）下结论。
- **R2 锚定报错**：给出 `386be7ca…` 的确切记录（turn/step/时间/完整 message）与同批 500 的完整序列。
- **R3 归因**：解释"UI 文案为何长这样"（provider → 分类器 → 重试 → turn error → 词典）与"上游为何 500"（列出已被证据推翻与仍然存活的假设，并给出各自的证据强度）。
- **R4 可判定性**：给出区分剩余假设的两条实验路线与判读规则——(a) **B 重放**（`.scratch/replay-500.mjs --send`：先发一个 tiny 控制请求证明端点健康，再发重建的完整载荷，`max_tokens:16`，只打印 HTTP 状态与 body 前 300 字符）；(b) **A 真机**（GUI resume 该会话发「继续」，载荷 100% 真实）。并给出若仍 500 时的上游报障话术（带 `ref` 清单）。
- **R5 只读与成本**：不改 dsh 宿主、不改插件、不改该会话内容；重放只在**用户显式提供 key**（贴给 agent 或用户自己执行）后进行；单次重放 = 1 次大请求 + 1 次 tiny 控制请求，输出上限 16 tokens；不向上游提工单。

## Acceptance Criteria

- **AC1（源会话结论）**：session id / cwd / 创建与末次写入时间 / 指针文件路径 / 日志内 task.py 证据（seq 或行），并给出一句话结论。
- **AC2（报错锚点）**：`386be7ca…` 的 turn/step/时间/原文 message 完整列出；t20 首次、t20 终局、t21、t22 按时间排列。
- **AC3（归因链）**：给出 file:line 链路（`dsh-llm-pi-ai/lib/index.js:1372`、`:1389`、`dsh-client-ui-chat/lib/client.js:2697`）+ ≥2 条被推翻假设的量化反证（800k 级正常会话；同会话 4 秒前成功）。
- **AC4（可判定性）**：写明判定实验（B 重放 / A 真机）与判读规则（500 ⇒ H1/H2 强证据；200 ⇒ 未复现，降级为 H3 或组合条件）；实验执行后记录 HTTP 状态、`ref`（若有）与最终归因。
- **AC5（交付物）**：`research/500-turn-failure.md`（完整证据链 + 结论分级）；`.scratch/` 探针脚本清单并在收尾时声明临时性。

## Out of Scope

- 修 dsh 宿主/provider 适配层（上下文保护、自动压缩、错误提示改进）——如需另开任务。
- 改 `dsh-plugin-trellis-statusline` / `dsh-plugin-ollama-usage`（父任务的代码范围）。
- 除 D4 的判定实验外，不用真实 API key 做任何其它请求；不主动向上游提工单。
- 追查其它会话（ecms `aa509ce8`/`703aabd3` 等本轮无 500）。

## Key Decisions

- **D1**：源会话以**工作区会话指针**为主证，日志内容为交叉验证；不采信 mtime 之类旁证。
- **D2**：结论分层——已确认 / 已推翻 / 存活假设；H1 不写成定论，直到 AC4 的实验给出结果。
- **D3**：本任务不改代码，故不需要 `design.md` / `implement.md`；交付物是结论文档 + 判定方法。
- **D4（用户 2026-09-20 选定）**：判定实验走 **B = 用真实 provider 直接重放**，而不是 GUI resume；因 dsh 内部持有加密凭据，执行前必须由用户提供 `OLLAMA_API_KEY`（或用户自己跑脚本）——这是本任务唯一的外部依赖。

## 实现记录（2026-09-20）

- **源会话定位**：`session-4a220f8c-…`（cwd `D:\project\dsh\dsh-plugin`，2026-09-16 16:37 创建 → 09-20 15:36:58 末次写入）；主证 = 工作区会话指针，交叉验证 = 日志内 `09-20-new-session-workspace-task` 出现 305 次（最早 10:43:43 的 `task.py create`，seq 1380）。
- **报错锚定**：`386be7ca…` = **t21 终局**（15:35:35）；首次 500 = **t20/s4**（15:30:50，ref `b8fb91a4…`）；t20 终局 15:31:19（`5d348310…`）；t22 被用户中止。
- **链路锚点**：`dsh-llm-pi-ai/lib/index.js:1366-1377`（`:1372` 5xx→SERVER）、`:1388-1389`（溢出保护需溢出文案 + `totalTokens > contextWindow`，本机配 1,000,000）、`dsh-client-ui-chat/lib/client.js:2697`（`message.turnError`）。
- **量化反证**：同会话 15:30:46 成功 / 15:30:50 失败；`66d44746` 803,810、`cecc8255` 801,758 tokens（同 provider/model/api，零错误轮）。
- **判定实验**：
  - **B（合成重放）** 16:07:26 control `HTTP 200`（31 tok）→ 16:07:34 重放 `HTTP 200`（`prompt_tokens=380,499`、`cached=0`、completion 截断 16）⇒ **未复现**；实测消耗 380,530 input tokens。
  - **A（真机 resume + 「继续」）** 16:09:37–16:10:10 turn 23 → **500 ×5**（`91e07e5f`/`dc6aaa70`/`4777bd4d`/`c8df848f`/`64e41024`），终局 ref `ec506f3c…` ⇒ **复现；该会话不可恢复**。
  - 两次实验相隔 2 分钟 ⇒ 端点健康的同时真实 payload 被拒 ⇒ H3（瞬时故障）被推翻，H1（真实 payload 特有问题）为主。
- **交付物**：`research/500-turn-failure.md`（证据链 / 假设分层 / 排查手册 / 上游报障 ref 清单）。
- **规范回写（3.3）**：新增 `.trellis/spec/dsh-plugin-ollama-usage/frontend/runtime-diagnostics.md`（多帧 zstd 契约、记录面、错误链路、验证命令）与 `.trellis/spec/guides/turn-failure-triage.md`（排查纪律），并在两个 index 挂链。
- **AC 对照**：AC1–AC5 全部满足（AC4 记录 B 未复现 + A 复现 + 最终归因）。
- **状态**：未提交（AGENTS.md：需用户明确同意）；`.scratch/` 探针为临时产物，收尾时声明或清理。

## Open Questions

- **B 的 key 交付方式未定**（贴给 agent / 用户自己执行 / 改走 A 真机 resume）：阻塞 AC4 的实验执行，不阻塞 AC1–AC3、AC5 的产出。
