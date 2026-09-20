# 源会话「本轮运行失败 500」定位与归因

> 任务：`09-20-investigate-source-session-500`（父任务 `09-20-new-session-workspace-task`）
> 调查日期：2026-09-20 ｜ 结论等级：**已确认 / 已推翻 / 存活假设** 三层，不混写

## 结论摘要

1. **源会话** = `session-4a220f8c-7bc5-48af-80f3-a4239bdca751`（cwd `D:\project\dsh\dsh-plugin`）——它创建并驱动了 `09-20-new-session-workspace-task`。
2. 用户看到的 `本轮运行失败500: {"message":"Internal Server Error (ref: 386be7ca-2c09-4320-8446-9136f28fbadd)",…}` 是 **turn 21 的终局错误**（2026-09-20 15:35:35），不是网络故障、不是上下文超限、不是 dsh 侧异常；是 **provider（ollama.com / deepseek-v4.1-flash）返回的 HTTP 500 `api_error`**。
3. 该会话自 **15:30:50** 起，**每一次 LLM 调用都 500**（t20/s4、t21/s1、t22/s1），dsh 每步重试 5 次后把整轮标记为失败——**没有自愈路径**。
4. 关键反证：同一会话 15:30:46 还成功；其它会话用同一 provider/model/api 跑到 801,758 / 803,810 tokens 且零错误轮。⇒ 既不是上游整体故障，也不是"上下文太大"的硬墙，而是**该会话当时那段请求特有的问题**。
5. **两次判定实验（相隔约 2 分钟）给出了决定性组合**：
   - **B（合成重放，16:07）**：把 t20/s4 的会话消息前缀（662 条消息 / 380,499 prompt tokens）重放到 ollama.com → **HTTP 200**；
   - **A（真机重放，16:09:37）**：用户 resume 该会话发「继续」= turn 23 → **再次 500**，5 次重试全败（`91e07e5f`/`dc6aaa70`/`4777bd4d`/`c8df848f`/`64e41024`/`ec506f3c`），16:10:10 `turn/end kind=error`。
   ⇒ 端点健康的同时真实 payload 仍被拒 ⇒ **故障是该会话请求 payload 特有的，且持续存在（15:30 → 16:10，40 分钟），重启/重试都无法自愈**。

## 1. 源会话定位（AC1）

| 项目 | 值 |
|---|---|
| session id | `session-4a220f8c-7bc5-48af-80f3-a4239bdca751` |
| 日志 | `~/.dsh/sessions/--D-project-dsh-dsh-plugin--/<id>/session.v3.jsonl.zstd`（压缩 2.6 MB / 解压 9.1 MB / 3063 条） |
| cwd | `D:\project\dsh\dsh-plugin` |
| agentPreset | `ptc-bash` |
| 生命周期 | 创建 2026-09-16 16:37:38 → 末次写入 2026-09-20 15:36:58（turn 22 被用户中止） |
| 会话指针 | `.trellis/.runtime/sessions/dsh_session-4a220f8c-….json` → `current_task: .trellis/tasks/09-20-new-session-workspace-task`、`last_seen_at 2026-09-20T03:24:36Z` |
| 交叉验证 | 日志内 `09-20-new-session-workspace-task` 出现 305 次；最早一次 = 2026-09-20 **10:43:43** 的 `task.py create`（seq 1380） |
| 旁证排除 | `.scratch/restore-pointers.py` 只对 ecms-backend 生效，未触碰本工作区指针 ⇒ 指针是 task.py 真写进去的 |

## 2. 报错时间线（AC2）

| 本地时间 | 位置 | 内容 |
|---|---|---|
| 15:30:46 | t20/s3（最后一次成功） | usage `total=655437, cacheRead=654720, in=374, out=343` |
| **15:30:50** | **t20/s4 首次 500** | ref `b8fb91a4-01dd-4052-92b8-f5532af3bda4`；随后 `3aa2eb8e…`、`d8b48dec…`、`5d01d180…`，第 5 次 TRANSPORT |
| 15:31:19 | t20 `turn/end` | `kind=error`，ref `5d348310-dfc3-497a-92ad-062dad6a1418` |
| **15:35:35** | **t21 `turn/end`** | **`kind=error`，ref `386be7ca-2c09-4320-8446-9136f28fbadd`（用户引用的一条）** |
| 15:36:43 | t22/s1 | 用户发「继续」→ 再次 500（`3ccebdaa…`/`aa23fe35…`） |
| 15:36:58 | t22 `turn/end` | `kind=aborted`（`reason.kind=user`，用户放弃） |
| 16:07:26 / 16:07:34 | 判定实验 B（本任务） | control 200（31 tok）／合成重放 **200**（380,499 tok，`cached=0`） |
| **16:09:37–16:10:10** | **t23（判定实验 A：真机 resume + 「继续」）** | **再次 500 ×5**（`91e07e5f`/`dc6aaa70`/`4777bd4d`/`c8df848f`/`64e41024`），终局 ref **`ec506f3c-849b-4823-8c54-6ee6e988d89b`** |

原文（两轮相同形态）：

```json
{"kind":"error","error":{"message":"500: {\"message\":\"Internal Server Error (ref: <uuid>)\",\"type\":\"api_error\",\"param\":null,\"code\":null}","code":"SERVER"}}
```

触发增量：t20/s4 相对 t20/s3 只多了一条 assistant tool-call（`call_3he28c99`，343 output tokens）与它的 56 字节工具结果 `44/44 passed…`。

## 3. UI 文案链路（AC3 的一部分）

| 环节 | 位置 | 行为 |
|---|---|---|
| provider | `ollama` / `deepseek-v4.1-flash` / `openai-completions`（settings `llm-pi-ai.providers.ollama`） | 返回 HTTP 500，body 是 OpenAI 风格 `api_error` |
| 分类 | `dsh-llm-pi-ai/lib/index.js:1372` | `if (/\b5\d\d\b/.test(message)) return "SERVER"` ⇒ 可重试类 |
| 重试 | `dsh-llm-retry`（policy `mode=normal`，`maxRetries=5`；codes `EMPTY_RESPONSE/RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT`） | 每步 5 次，全部失败后 `step/end` + `turn/end kind=error` |
| 溢出保护（未触发） | `dsh-llm-pi-ai/lib/index.js:1389` | `isContextOverflow(message, contextWindow)`：既要求溢出文案，又要求 `totalTokens > contextWindow`（本机该模型配 **1,000,000**）⇒ 本例两者都不满足 |
| UI | `dsh-client-ui-chat/lib/client.js:2697` | `"message.turnError": "本轮运行失败"` ⇒ 渲染成「本轮运行失败」+ 原始 message |

## 4. 被推翻的假设（有量化反证）

| 假设 | 反证 |
|---|---|
| 上游整体故障 / 该模型部署坏了 | 同一会话 **15:30:46 成功、15:30:50 失败**（相隔 4 秒）；`66d44746`（09-15）达 **803,810 tokens**、`cecc8255`（09-14）达 **801,758 tokens**，同一 provider/model/api，**零错误轮** |
| 上下文尺寸硬墙（~655k 上限） | 同上，800k 级会话正常；本会话 655k 就永久失败 |
| dsh 侧路由/插件故障 | 插件路由此前实测 401（已注册 + 信任栅栏正常）；失败发生在 provider 调用层，且 `api_error` 是上游 body 原文 |
| 会话日志里能查到请求 payload | 日志只有 `assistant/attempt`（usage + stream chunk）；`~/.dsh` 无服务端日志目录/无 `*.log` |

## 5. 存活假设

- **H1（主，A 实验后升级）**：**该会话按 dsh 真实渲染的请求 payload 本身是"毒"**——真实 payload 在 40 分钟后仍稳定 500，而同一批对话消息（去掉 system prompt / 工具 schema / reasoning / 图片 / dsh 线格式）重放为 200。剩下的定位空间 = dsh 组装请求时**额外加进去的那部分**（system prompt ~105 KB、工具 schema、reasoning 块、图片附件渲染、assistant 消息的 replay 形态）与这段对话的组合。
- **H2′（次）**：上游**缓存/前缀亲和**路径故障——原请求 `cached 654,720`、重放 `cached 0`；但 40 分钟后仍失败，单纯"陈旧缓存条目"已不太可能，除非前缀缓存长期驻留且被污染。
- ~~**H3（瞬时故障）**~~ **已推翻**：A 实验（16:09）与 B 实验（16:07，200）相隔约 2 分钟；且失败从 15:30 持续到 16:10。

## 6. 判定实验（AC4）

**路线 B（本次执行，用户 2026-09-20 选定）**：`.scratch/replay-500.mjs` 从日志只读重建 t20/s4 的请求（截到 seq 2998 = 最后一次成功状态）：

- 662 条消息（user 27 / assistant 326 / tool 309），请求体 1,266,640 字节（1.21 MB）
- 保真度缺口：缺 system prompt（会话期 ~105 KB）、工具 schema、reasoning 块；依据"同一 system prompt 在 15:30:46 还成功"⇒ 致错增量必落在消息前缀，故该缺口不改变对 H1 的检验力
- 判读规则：**先 tiny 控制请求**（证明端点此刻健康）→ 大重放；`max_tokens:16`

**结果（2026-09-20 执行，脚本 `.scratch/replay-500.mjs --send`）**：

| 步骤 | 结果 |
|---|---|
| control(tiny) | **HTTP 200**，0.8 s，31 prompt tokens |
| replay(full) | **HTTP 200**，7.9 s，`prompt_tokens=380,499`、`completion_tokens=16`（截断）、`cached_tokens=0`；模型甚至开始作答待办（"现在加图标。先看 statusline 现有渲染与可用的官方…"） |
| 判读 | **未复现** ⇒ 会话消息内容本身对上游无害（H1 降级）；本次实测消耗 380,530 input tokens（控制 31 + 重放 380,499） |

**路线 A（用户 2026-09-20 16:09 执行）—— 复现失败**：

| 步骤 | 结果 |
|---|---|
| resume `4a220f8c` + 发「继续」 | turn 23 / step 1 |
| 第 1–5 次尝试 | 全部 **HTTP 500 `api_error`**：`91e07e5f`、`dc6aaa70`、`4777bd4d`、`c8df848f`、`64e41024` |
| 16:10:10 | `turn/end` `kind=error`，终局 ref **`ec506f3c-849b-4823-8c54-6ee6e988d89b`** |

**最终归因**：该会话**不可恢复**（重试/等待均无效，40 分钟后仍 100% 失败）；故障属于**该会话请求 payload 与上游的组合问题**，不是本地网络、不是上下文尺寸、不是瞬时抖动。要定位到具体字段，只能靠上游按 `ref` 查内部 trace，或在 dsh 侧 dump 出网请求做二分（后者需要 dsh 的调试开关，属另开任务）。

## 7. 证据缺口与局限

- 无法确认"毒"具体是哪条内容：上游只给 `ref`，dsh 不落请求 payload。要定论需上游按 `ref` 查内部日志。
- H3 无法用本地日志排除（缺同时刻对照）。
- 合成重放与真实 dsh 请求存在前述保真度差异 ⇒ **200 只能算"未复现"，500 才算强证据**。
- 重放规模 **380,499** prompt tokens vs 原请求 ~655,094，且 `cached_tokens=0` vs 原 `cacheRead=654,720` ⇒ **上游缓存/前缀亲和路径完全未覆盖**，这正是 H2′ 仍然存活的原因。

## 8. 复现与排查手册（可复用）

- dsh 会话日志是**多帧 zstd**：`zstdDecompressSync()` 与 `createZstdDecompress()` 都**只解第一帧**（≈200 字节）。必须按魔数 `28 B5 2F FD` 切帧逐帧解压——见 `.scratch/zstd-frames.mjs`。
- 本次用到的探针（`.scratch/`，临时产物）：`zstd-frames.mjs`（多帧解压）、`probe-4a220f8c.mjs`（结构/类型直方图）、`probe-retries.mjs`（`llm/retry` + `turn/end`）、`probe-tail.mjs`（turn 时间线）、`probe-usage.mjs` / `probe-maxtokens.mjs`（上下文规模对照）、`probe-allerrs.mjs`（全会话错误轮）、`replay-500.mjs`（重放）。
- 排查同类问题的最短路径：`grep -c 'turn/end'` → 找 `reason.kind=error` → 看同 step 的 `llm/retry` 序列 → 与"该 step 之前的 usage"对齐时间。

## 9. 后续建议（不在本任务范围）

1. **上游报障**：把 ref 清单（t20：`b8fb91a4`/`3a…`/`d8b48dec`/`5d348310`；t21：`386be7ca`；t22：`3ccebdaa`/`aa23fe35`）与"仅该会话复现"的事实交给 ollama/DeepSeek 侧。
2. **dsh 侧改进候选**（另开任务）：① 把 provider 5xx 的原始 `ref` 显式呈现/可复制；② 上下文接近窗口时给出预警或压缩；③ 连续 N 次同前缀失败后给出"该会话可能不可恢复，建议新开会话/导出上下文"的提示，而不是让用户反复发「继续」。
3. 该会话（`4a220f8c`）在最终归因出来前**不要再无脑重试**——每次都会带上同一前缀。
