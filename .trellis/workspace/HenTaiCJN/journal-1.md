# Journal - HenTaiCJN (Part 1)

> AI development session journal
> Started: 2026-09-15

---



## Session 1: 两个 dsh 插件改走自有路由 + README/发布收尾
<!-- trellis-session: v=2 fp=578b168d7940b792 -->

**Date**: 2026-09-16
**Task**: 两个 dsh 插件改走自有路由 + README/发布收尾
**Package**: dsh-plugin-ollama-usage
**Branch**: `master`

### Summary

R2/R6 决策落地：statusline 与 ollama-usage 都改为自开 webServer 路由 + connection.requestRejection 栅栏，删除 connection 行覆盖；自检 197/197 与 87/87；README 复核/重写、LICENSE 与发布元数据补全；ollama-usage 新建 GitHub 仓库并推送、statusline 推送；meta 仓库提交子模块指针与记录；npm 因无凭据未发布

### Git Commits

| Hash | Message |
|------|---------|
| `997a8c6` | chore: 收尾本轮 —— 两个插件改走自有路由，README/元数据补全，子模块指针更新 |

### Status

[OK] **Completed**


## Session 2: 两个 dsh 插件改走自有路由 + README review + 发布推送（finish-work）
<!-- trellis-session: v=2 fp=e03ac54b8b98527d -->

**Date**: 2026-09-16
**Task**: 两个 dsh 插件改走自有路由 + README review + 发布推送（finish-work）
**Package**: dsh-plugin-ollama-usage
**Branch**: `master`

### Summary

09-16-dsh-channel-patch-research：R1-R4/R6 全部落地并记录（F7 并行实例实测、上游调研、spec 增补）；两个插件改为自开 webServer 路由 + connection.requestRejection 栅栏，删除 connection 行覆盖；自检 197/197 与 87/87。子模块 work commits：trellis 90a4aa1、ollama-usage 65fc19f。README 复核：statusline 修断言数与排版；ollama-usage 整篇重写并补 LICENSE/元数据、去掉 private。GitHub：trellis 推 90a4aa1，ollama-usage 新建仓库并推 65fc19f，两仓库加 topics。npm 已就绪但缺凭据（未发布）。Tree demo（测试产物）已归档；按用户要求本轮不归档其它任务。真机目视（AC5）留给用户。

### Git Commits

| Hash | Message |
|------|---------|
| `997a8c6` | chore: 收尾本轮 —— 两个插件改走自有路由，README/元数据补全，子模块指针更新 |
| `2e95c20` | docs(task): 记录本轮发布与仓库收尾（README review、GitHub 推送、npm 待凭据） |

### Status

[OK] **Completed**


## Session 3: 收尾：物理删除测试用 Tree demo 任务
<!-- trellis-session: v=2 fp=b2f0843c80c4b44b -->

**Date**: 2026-09-16
**Task**: 收尾：物理删除测试用 Tree demo 任务
**Package**: dsh-plugin-ollama-usage
**Branch**: `master`

### Summary

按用户要求物理删除测试产物 09-15-tree-demo（含归档副本），handoff.md 的过期复现步骤改写为删除记录；09-15-trellis-statusline 的 parent 已由归档流程清空，无悬空引用。活动任务保持 09-15-trellis-statusline 与 09-16-dsh-channel-patch-research（in_progress）—— 按用户上次明确指示本轮不归档。两个子模块干净且与远端一致（trellis 90a4aa1 / ollama-usage 65fc19f）。仍待用户：重启后真机目视（AC5）；npm 发布需凭据；GitHub PAT 建议 revoke。

### Git Commits

| Hash | Message |
|------|---------|
| `c237758` | chore(task): 物理删除测试用演示任务 09-15-tree-demo |

### Status

[OK] **Completed**


## Session 4: 归档：09-16 调研任务与 09-15 statusline 任务
<!-- trellis-session: v=2 fp=2ddb2a0b2b961a18 -->

**Date**: 2026-09-16
**Task**: 归档：09-16 调研任务与 09-15 statusline 任务
**Package**: dsh-plugin-ollama-usage
**Branch**: `master`

### Summary

两条活动任务均已归档（分支元数据都是 master==master、从未走 PR，故用 --skip-branch-validation）：09-16-dsh-channel-patch-research（R1-R6 全部落地、spec 增补、两个插件改造与发布收尾）与 09-15-trellis-statusline（插件功能三轮增量和真机验收均已完成并发布）。归档后活动任务为 0，运行时会话指针已随之清除。剩余待用户事项不变：重启目视（AC5）、npm 发布凭据、GitHub PAT revoke。

### Git Commits

| Hash | Message |
|------|---------|
| `c237758` | chore(task): 物理删除测试用演示任务 09-15-tree-demo |

### Status

[OK] **Completed**


## Session 5: PTC+Bash agent 预设：官方 PTC 基底 + Windows Git Bash 首选 shell
<!-- trellis-session: v=2 fp=479b3908356b0cbb -->

**Date**: 2026-09-16
**Task**: PTC+Bash agent 预设：官方 PTC 基底 + Windows Git Bash 首选 shell
**Package**: dsh-plugin-ollama-usage
**Branch**: `master`

### Summary

交付 ptc-bash agent 预设：新建插件仓库 CJ-SH/dsh-plugin-ptc-bash（public/main，33a2f09 + c935ca8）并接入本仓库第三个 submodule（9477eab），任务文档 0953def，指针更新 f7ec4b4。预设以官方 ptc 逐行复制为底座、只改三处（新增 dsh-bash-win 行与 workspace-instructions 行、重写头注释），保留官方全部提示词段落、不做首轮锚定；两个本地插件：dsh-bash-win（Git Bash bash 工具，参数齐官方 description/timeoutMs/run_in_background，后台走 ctx.jobs，结果用 [exit code: N]/[timed out after Nms]/[killed by signal: S] 标记，非零退出报告而非报错）与 workspace-instructions（AGENTS.md 链进 system prompt 并抑制官方重复注入）。许可：派生自 @linxin666/dsh-liangshen（Apache-2.0）与 DeepSeek MIT，LICENSES/ 已附带，xiaobright MIT 全文待补。验证：用户新会话验收通过；node --test 25/25（含 submodule 克隆内跑）；.gitattributes 固定 LF（修掉 CRLF 导致的 4 项测试失败）。遗留：父仓库未配置 remote（3 个提交仅本地）、profile 尚未装载该插件（启动同步未接）、GitHub token 需撤销。

### Git Commits

| Hash | Message |
|------|---------|
| `9477eab` | feat: 新增 dsh-plugin-ptc-bash submodule（官方 PTC 基底 + Windows Git Bash 首选 shell 预设） |
| `0953def` | docs(trellis): ptc-bash 预设任务的规划与产物（prd/design/implement） |
| `f7ec4b4` | chore: 更新 dsh-plugin-ptc-bash 指针（LF 行尾 + 预设测试对 CRLF 容错） |

### Status

[OK] **Completed**


## Session 6: statusline 会话身份：R1 真机验收 + R2/R3 指针唯一证据（提交并归档）
<!-- trellis-session: v=2 fp=5256724542ad8e0a -->

**Date**: 2026-09-17
**Task**: statusline 会话身份：R1 真机验收 + R2/R3 指针唯一证据（提交并归档）
**Package**: dsh-plugin-ollama-usage
**Branch**: `master`

### Summary

新会话（session-61758d0f）真机验收通过：自定义 bash 已拿到 DSH_SESSION_ID/DSH_SHELL（与官方 pwsh 逐字一致），resolve_context_key 返回 dsh_session-<id>，一次性仓库里 task.py create 无降级并写指针，真实工作区 task.py start 同样无降级 —— R1 达成（dsh-plugin-ptc-bash 7cce955）。R2/R3 按用户定案 D1=(a) 落地（dsh-plugin-trellis-statusline 27b5b39）：task/read 只认 Trellis 会话指针、删除工作区扫描兜底（净 -51 行），无指针/陈旧/越界/损坏一律 none，pill 不渲染；用户判断是指针为唯一无风险可信来源，活会话事件推断与 zstd 日志解码一并否决。spec 增补 shellEnv 注入契约（57308f3），任务文档 5dfa6b3 与指针 5fec91a 提交后归档（8d693cc），归档已清空运行时会话指针。

### Main Changes

- dsh-bash-win：inject 增 shellEnv + spawn spec 显式 env=ctx.shellEnv.collect(exec)，前台/后台共用；单测补 4 例覆盖 overlay 传递与三种降级
- statusline host：readTask 只走指针，删 scanTasks/statusRank/RUNNING_STATUSES；client 仅注释；host 组新增 4 条「无指针不误报」断言，README/design-notes 改写
- spec：halves-contract 增「Shell tools must forward ctx.shellEnv.collect(exec)」小节，index 硬约束表加一行（子进程被 scrub 的静默失败）

### Git Commits

| Hash | Message |
|------|---------|
| `57308f3` | docs(trellis): 补充自定义 shell 工具的会话身份注入契约（DSH_*） |
| `5dfa6b3` | docs(trellis): statusline 会话身份任务的规划与产物（R1 真机验收 + R2/R3 落地） |
| `5fec91a` | chore: 更新 dsh-plugin-ptc-bash 与 dsh-plugin-trellis-statusline 指针 |

### Testing

- [OK] ptc-bash npm test 29/29；node --check 通过；仓库源与 DSH_HOME 生成物 cmp 一致
- [OK] statusline npm test 195/195（host 58 / client 45 / cell 81 / integration 11）
- [OK] 伪证检验：host 半边还原 HEAD 后 host 组 54/58，恰好 4 条新断言失败；真机探针本会话出 pill、无指针会话 none
- [OK] 真机：bash env 含 DSH_SESSION_ID；scratch 仓库 task.py create 写指针；真实工作区 task.py start 无降级

### Status

[OK] **Completed**

### Next Steps

- 重启 dsh（或重载插件）让新 host 半边生效；归档后本工作区无活动任务，状态栏应显示空白（指针已清空，正是新语义）
- 两个子模块与 meta 仓库均未 push；npm 已发布版本不含本次修复（本地 profile 走 link:，对外需发版）
- 第三方 liangshen 预设 custom-bash.mjs 同缺陷待上报上游
