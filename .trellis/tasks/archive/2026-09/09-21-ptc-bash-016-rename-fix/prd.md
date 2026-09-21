# 修复 ptc-bash 预设：0.1.6 插件重命名与损坏的 YAML

## Goal

dsh 升到 **0.1.6-alpha.2** 后 `ptc-bash` 预设挂不起来：会话恢复直接报
`预设 "ptc-bash" 挂载失败：行 "workflow-worker-thread" 命名了一个无法解析的插件`。
用户手改后 liangshen 恢复、ptc-bash 仍不可用——本次要把它修回可用，并让「上游改名 → 预设行引用失效」这类故障由测试拦住，而不是等会话恢复失败才暴露。

用户价值：

- 恢复 ptc-bash 模式（Windows 上 Git Bash 首选 shell + AGENTS.md 进系统提示词）的可用性，历史会话能正常恢复。
- 预设与官方 `ptc` 的差异回到「逐行可列举、可复核」的状态，不再靠手改 YAML 追版本。
- 下一次 dsh 升级时，坏行在 `npm test` / `npm run derive-preset` 就暴露。

## 背景与已确认事实（含证据）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 装机 dsh = `0.1.6-alpha.2`（deployment：`D:\Scoop\persist\nvm\nodejs\v24.18.0\node_modules\@deepseek-ai\dsh`），profile = `web` | `dsh --version`；`profiles/web/package.json` |
| F2 | 0.1.6 里**没有** `@deepseek-ai/dsh-workflow-worker-thread`；引擎包已改名 `@deepseek-ai/dsh-workflow-ptc` | 装机 `@deepseek-ai/` 目录清单；官方 0.1.6 `presets/ptc/agent.cordis.yml:229-235` 用 `id: workflow-ptc` + `name: '@deepseek-ai/dsh-workflow-ptc'` |
| F3 | **仓库副本与安装副本字节一致**（`agent.cordis.yml` SHA256 `7A0CAF91…`），且**两份都不是合法 YAML**：手改把 `name` 写成 `'@deepseek-ai/dsh-tool-ptc`（缺收尾单引号） | SHA256 比对（仓库 `presets/ptc-bash/` vs `~/.dsh/.agent-presets/ptc-bash/`）；js-yaml 解析报 `bad indentation of a sequence entry` @ line 260 |
| F4 | 同一处手改还把包名写错：`@deepseek-ai/dsh-tool-ptc` 装机里**不存在**；该行在 0.1.6 仍应是 `id: tool-workflow` + `name: '@deepseek-ai/dsh-tool-workflow'`（官方 ptc 里 `disabled: true`） | 装机目录清单无 `dsh-tool-ptc`；官方 `presets/ptc/agent.cordis.yml:237-241` |
| F5 | 结构 diff（修复视图 vs 官方 0.1.6 ptc）显示：除两处自有意新增（`workspace-instructions`、`dsh-bash-win`）外，只剩 **3 处上游漂移** —— `delegation/workflow-ptc` 与 `delegation/tool-ralph` 在 ptc-bash 里是启用、官方 0.1.6 已改默认禁用；官方新增顶层 `tool-plugin-manager`（disabled）。其余每一行（含全部 config）与 0.1.6 官方 ptc 完全一致 | 归一化结构 diff（逐行比对 id/name/disabled/isolate/config 全字段；该比对在 design.md 层 3 落成测试断言） |
| F6 | `npm run derive-preset` **现在可跑通**（锚点全中、`ALL CHECKS OK`），派生产物与修复视图只差 F5 的 3 处；`workspace-instructions.mjs` 派生结果与仓库副本**字节一致**（liangshen 的 `minimal-prompt.mjs` 无漂移） | 对装机官方 ptc + liangshen 的实测派生（输出到临时目录，未落仓库）；`tools/derive-preset.mjs` |
| F7 | `npm test` 现在 **29/29 全绿**，而组合文件其实是坏 YAML：`validateComposition` 只做「顶层行 id + 两空格缩进 name 前缀」的正则检查，不解析 YAML、不看嵌套行、不解析包名 | `lib/index.js:56-85`；`test/preset.test.mjs`；`npm test` |
| F8 | `dsh-plugin-ptc-bash` 在 profile 里以 `link:` 依赖装载且 bundle 已启用；宿主启动时把 `presets/ptc-bash/**` **幂等同步**到 `~/.dsh/.agent-presets/ptc-bash/`，且同步前的结构校验同样不解析 YAML（坏文件照样同步过去） | `profiles/web/package.json`；`lib/index.js:121-159`；`plugin_manager list_bundles` |
| F9 | **风险（不在本次请求范围）**：liangshen 的手改只落在安装副本（target mtime `13:23:55` 晚于宿主启动 `13:20:15`），而 `@linxin666/dsh-liangshen@0.3.23`（profile 中 `web-ui-liangshen` 行已启用）每次挂载都会把包内 `presets/liangshen/**` 覆盖同步过去，包内该行**仍是** `workflow-worker-thread`；最新 `0.3.24` 依然如此（npm tarball 实测）→ **下次重启 dsh web 会再坏一次** | `~/.dsh/.agent-presets/liangshen/agent.cordis.yml:370-371`（已改）vs 包内 `presets/liangshen/agent.cordis.yml:370-371`（未改）；`src/sync.ts:130-167`；宿主进程启动时间 |

## 已定决策

- **DEC1（本轮确定）修复口径 = 跟上游（原选项 A）**：用 `npm run derive-preset` 从**装机官方 ptc（0.1.6）**重新派生。`delegation` 组内 `workflow-ptc`（引擎）、`tool-workflow`、`tool-ralph` 三行跟随上游默认 `disabled` —— PTC 模式下编排面只由 `run_code` + subagent 工具承担；补上上游新增的顶层 `tool-plugin-manager` 行（同样 `disabled`）。**不新增「第 4 处差异」**，不保留 ralph。
- **DEC2** 防复发（对应 F7 缺口）：测试引入真实 YAML 解析 + 行 `name` 可解析断言 + 负向用例，让「删引号 / 引用已删除包」必然失败。
- **DEC3（本轮确定）liangshen 不在本任务范围内（原选项 D）**：本次只交付 ptc-bash 修复；liangshen 的同步覆盖风险作为**已知风险记录**留在本 PRD（含触发条件与两行恢复步骤），不修改其包与设置，也不动 profile 组合。理由：它是第三方包的缺陷，处置方式（改包内副本 / 关同步 / 报上游）各自有取舍，用户要单独决定。

## Requirements

- **R1** `presets/ptc-bash/agent.cordis.yml` 必须是**合法可解析的 YAML**，且每个行的 `name` 都能解析到：本地相对文件（`./*.mjs`）或装机/profile 里真实存在的 `@deepseek-ai/*` 包。
- **R2** 引擎行采用 0.1.6 的 id 与包名（`workflow-ptc` / `@deepseek-ai/dsh-workflow-ptc`）；被误改的工具行恢复为 `tool-workflow` / `@deepseek-ai/dsh-tool-workflow`。
- **R3** 预设与官方 `ptc` 的关系回到「仅记录在案的差异」：由 `npm run derive-preset` 从**装机官方 ptc** 派生，README/NOTICE 的差异清单与实际逐行一致（ralph/引擎随上游默认禁用，见 DEC1）。
- **R4** 测试能拦住这一类故障：(a) 用 harness 自身的健康判定（`discoverPresets` → `broken`）解析并判定组合文件；(b) 校验每个行 `name` 可解析（相对文件存在 / 装机或 profile 里包存在）；(c) 负向验证——把引擎行改回旧包名或删掉一个引号时测试必须失败；(d) 同步路径的结构守卫（离线、零依赖）不得放行写坏的标量，坏组合不落进用户根。
- **R5** 修复落在**仓库源文件**（安装副本由宿主启动同步刷新，改安装副本会被覆盖）；修复后预设能挂载，不再报 mount failed。
- **R6** 不改 dsh 安装目录与内置预设、不改 profile 组合与 `settings.yaml`；不引入任何 `@deepseek-ai/*` 运行时依赖（与另两个 submodule 同风格）。

## Acceptance Criteria

- [x] **AC1** 组合文件经 harness 自身的健康判定（`discoverPresets` 返回的 `broken` 为 undefined，内部即真实 YAML 解析 + 行形态与包名解析）成立；断言写在 `npm test` 里（R4）。— 已验：仓库根与「同步到临时发现根」两处均 healthy。
- [x] **AC2** `npm test` 全绿；且负向验证成立：把 `workflow-ptc` 改回 `workflow-worker-thread`、或删掉任一行 `name` 的收尾引号，新增测试报错。— 已验：旧引擎名（启用态）→ 5 项失败（含 `row "workflow-ptc" names a plugin that cannot be resolved`）；删引号 → 6 项失败；还原后 38/38 全绿（0 skip）。
- [x] **AC3** `npm run derive-preset` 重跑后产物与仓库文件一致（或 `git diff` 只剩头注释等已记录内容），无意外漂移；`workspace-instructions.mjs` 保持字节一致。— 已验：重跑哈希不变、`git status` 中 `.mjs` 未修改。
- [x] **AC4** 新会话选 `ptc-bash` 能挂载：无「预设挂载失败」；工具面为 PTC（`run_code` + SDK），`bash`（Git Bash）与 `pwsh` 并存。— 用户已确认「已正常」。
- [x] **AC5** 原先恢复失败的 ptc-bash 会话（如 `session-50f428a1-0dd8-4c4b-868d-185c7dca9037`）可恢复并继续对话。— 用户已确认「已正常」。
- [x] **AC6** 会话内经 `bash` 执行 `env | grep '^DSH_'` 仍能看到 `DSH_SESSION_ID`（`dsh-bash-win` 的 `shellEnv.collect` 在 0.1.6 仍有该 API：`dsh-shell-env/lib/types/index.d.ts:87`）。— 用户已确认会话正常。
- [x] **AC7** liangshen 未被本次改动触碰（其包、设置、profile 行、预设目录都不变），且 RISK-1 的触发条件与两行恢复步骤留在 PRD 里（DEC3）。— 已验：同步只碰 `ptc-bash` 目录（`copied: [agent.cordis.yml]`，无 removed/failed），harness 对 liangshen 仍报 healthy。
- [x] **AC8** 行口径与 DEC1 一致：`delegation` 组内 `workflow-ptc`/`tool-workflow`/`tool-ralph` 均为 `disabled`，顶层存在 `tool-plugin-manager`（`disabled`）；与官方 0.1.6 `ptc` 的结构性差异只剩 `workspace-instructions`、`dsh-bash-win` 两处自有意新增（由 diff 脚本或测试断言）。— 已验：`test/composition-health.test.mjs` 的结构 diff 断言通过。

## Out of Scope

- 不改 dsh 安装目录、内置预设、`settings.yaml`（含 `agent-presets.default`）。
- 不重新设计 ptc-bash：除非 0.1.6 确有 API 不兼容，否则不动 `workspace-instructions.mjs` / `dsh-bash-win.mjs` 的行为。
- 不做 git 提交/推送（需用户明确同意）；不发布 npm/市场。
- 不为 ptc-bash 补 `.trellis/spec/` 或把 `dsh-plugin-ptc-bash` 注册进 `.trellis/config.yaml` 的 packages（可选后续）。
- **不处置 liangshen（DEC3）**：不修改 `@linxin666/dsh-liangshen` 包内文件、不改其设置或 profile 行。风险与恢复步骤只作记录。

## 已知风险（记录，不在本任务处置）

- **RISK-1 liangshen 下次重启会被覆盖**（证据见 F9）：触发条件是重启 `dsh web`，或改动该插件的设置（`refresh()` 会重跑同步）。
  - 恢复步骤（两行）：把 `~/.dsh/.agent-presets/liangshen/agent.cordis.yml` 的引擎行改回 `id: workflow-ptc` / `name: '@deepseek-ai/dsh-workflow-ptc'`（工具行保持 `tool-workflow` / `@deepseek-ai/dsh-tool-workflow`）。
  - 若将来要根治：候选是「修正包内副本（已实测两目录只差这一个文件，改完同步即 no-op）」「把设置 `dsh-liangshen.enabled` 置 false 停掉同步」「报上游」。
- **RISK-2 上游再次改名**：同类故障由 R4 的测试挡住；测试在找不到装机 harness 时会 skip（见 design.md），此时只剩层 1 结构守卫。

## 关键文件锚点

- 预设组合（修复前）：`dsh-plugin-ptc-bash/presets/ptc-bash/agent.cordis.yml:248-257`（引擎行 + 坏掉的手改行）
- 派生工具：`dsh-plugin-ptc-bash/tools/derive-preset.mjs`（读装机官方 ptc + liangshen `minimal-prompt.mjs`）
- 同步与结构校验：`dsh-plugin-ptc-bash/lib/index.js:56-85`（`validateComposition`）、`:121-159`（`syncPresets`）
- 测试：`dsh-plugin-ptc-bash/test/preset.test.mjs`、`test/sync.test.mjs`、`test/plugins.test.mjs`
- 官方上游：`@deepseek-ai/dsh-agent-presets/presets/ptc/agent.cordis.yml:229-241`（引擎/工具/ralph 三行 `disabled` 口径）、`:285-287`（新增 `tool-plugin-manager`）
- liangshen 覆盖链：`profiles/web/node_modules/@linxin666/dsh-liangshen/{presets/liangshen/agent.cordis.yml:370-371, src/sync.ts:130-167, src/index.ts:97-114}`

## 环境事实

- `$DSH_HOME` = `C:\Users\Hasee\.dsh`；profile = `web`；宿主 `dsh web` 进程启动于 2026-09-21 13:20:15。
- 安装副本根：`~/.dsh/.agent-presets/{ptc-bash,liangshen}`；随包预设根（只读）：`@deepseek-ai/dsh-agent-presets/presets/{ptc,standard,cordis,minimal}`。
- 本仓库是插件管理仓库：submodule + `.trellis` 工作流；profile 以 `link:` 依赖四个插件包。
- 本任务为 `09-16-ptc-bash-preset`（已归档）的子任务；平台为 inline 工作流（无 jsonl 清单要求）。
- 分析产物在 `.scratch/`（`yamlcheck.cjs`、`compare-presets.cjs`、`derived/` 等），收尾时清理。
- 旁支观察（不在本任务范围）：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-workflow-worker-thread` 是 0.1.5 时代遗留的**悬空 Junction**（目标已不存在）；`web` profile 从 `profiles/web/node_modules` 解析，故不影响装载，可选清理。
