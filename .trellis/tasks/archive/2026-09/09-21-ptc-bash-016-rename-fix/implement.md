# 实施计划：ptc-bash 0.1.6 修复

> 执行前提：`task.py start`（status → in_progress）之后才动手。本文件是 Phase 2 的清单与闸门。

## 前置

- 载入 `trellis-before-dev`；本包在 `.trellis/spec/` 下**没有** spec（spec 只覆盖 ollama-usage），因此以包内 `README.md` / `NOTICE` / `tools/derive-preset.mjs` 头部记录的派生契约为准。
- 硬约束：零运行时依赖；`agent.cordis.yml` 与 `workspace-instructions.mjs` 是派生件，**手改只在派生脚本里以锚定改动表达**。
- 基线记录（只读）：`git -C dsh-plugin-ptc-bash status --short`、`git diff -- presets/ptc-bash/agent.cordis.yml`。

## 步骤

1. **复现基线（只读）**：用装机 js-yaml（`$DSH_HOME/profiles/node_modules/js-yaml`）解析当前 `agent.cordis.yml`，确认 `bad indentation of a sequence entry`；并确认安装副本与仓库字节一致。
2. **重新派生**：`cd dsh-plugin-ptc-bash && npm run derive-preset`，必须输出 `ALL CHECKS OK`。检查 `git diff` 只包含：
   - 引擎行 `workflow-ptc` / `@deepseek-ai/dsh-workflow-ptc`（已由前一轮手改带入）；
   - 工具行恢复为 `tool-workflow` / `@deepseek-ai/dsh-tool-workflow` 且 `disabled: true`；
   - `workflow-ptc`、`tool-ralph` 补上上游的 `disabled: true`；
   - 新增顶层 `tool-plugin-manager`（`disabled: true`）；
   - 上游注释更新（如 `ptcRuntime` 措辞）；
   - `workspace-instructions.mjs` **零变化**（若变了：停下查 liangshen 上游漂移）。
   - **闸门**：出现 `PROBLEMS:` ⇒ 停止，先更新锚点，不手改 YAML 绕过。
3. **收紧同步守卫**：在 `lib/index.js` 的 `validateComposition` 增加标量引号闭合检查（覆盖任意缩进的 `name:` 行），保持零依赖与可读报错；坏组合继续走 `failed` 上报、**不写入目标**。
4. **更新/新增测试**（见 design.md 测试清单）：
   - `test/preset.test.mjs`：roster 加 `tool-plugin-manager`；新增 delegation 三行 + `tool-plugin-manager` 的 `disabled` 断言。
   - `test/composition-health.test.mjs`（新）：harness 定位 → `discoverPresets` 健康断言（正向 + 变异负向）→ 与官方 `ptc` 的结构 diff（只剩 `workspace-instructions` / `dsh-bash-win`）。harness 缺失时 skip 并打印原因。
   - `test/sync.test.mjs`：新增「引号未闭合 ⇒ 拒绝同步且目标不变」。
5. **文档**：`README.md`「预设里有什么」表补 `tool-plugin-manager`（disabled）与「ralph / 引擎随上游 0.1.6 默认禁用」；`NOTICE` 若差异清单涉及行口径则同步更新。
6. **验证（命令见下）**：`npm test` 全绿；**负向用例实跑**——把引擎行改回 `workflow-worker-thread`、再删掉一处收尾引号，测试必须失败，随后还原；新增的守卫必须对官方四个预设 + liangshen 安装副本**全部通过**（不误报）。
7. **同步到用户根**：`node -e "import('./lib/index.js').then(m => m.syncPresets()).then(r => console.log(JSON.stringify(r)))"`；断言 `failed` 为空、`copied` 含 `agent.cordis.yml`，并用 SHA256 比对源与目标一致。
8. **会话验证（需用户配合）**：新建 ptc-bash 会话（AC4）→ 恢复 `session-50f428a1-0dd8-4c4b-868d-185c7dca9037`（AC5）→ 会话内 `bash` 执行 `env | grep '^DSH_'`（AC6）。
9. **收尾**：清理 `.scratch/`；**不执行 git 提交**（AGENTS.md：需用户明确同意）；Phase 3 更新 journal 与 spec（若产生可沉淀的契约，如"派生件的防漂移测试形态"）。

## 执行记录（2026-09-21）

| 步骤 | 结果 |
|---|---|
| 2 重新派生 | `npm run derive-preset` → `ALL CHECKS OK`；`git diff` 恰为 5 处：引擎行 `workflow-ptc`、工具行 `tool-workflow`（`disabled`）、`workflow-ptc`/`tool-ralph` 补 `disabled`、新增 `tool-plugin-manager`、`ptcRuntime` 注释；`workspace-instructions.mjs` 零变化 |
| 3 同步守卫 | `lib/index.js` 新增 `nameScalarProblem`（`+41/-2`）；对官方 4 个预设 + liangshen 安装副本 **全部 PASS**（无误报），对修复前的安装副本与变异文本精确报行号 |
| 4 测试 | `test/preset.test.mjs` +18 行、`test/sync.test.mjs` +42 行、新增 `test/composition-health.test.mjs`（harness 判定 + 变异负向 + 与官方 ptc 结构 diff） |
| 5 文档 | `README.md`：预设表补编排三行与 `tool-plugin-manager`；验证节说明 health 测试与 skip 行为；迭代注意加「升级后先重派生再测试」 |
| 6 验证 | `npm test` 38/38（0 skip）；负向 A（旧引擎名+启用）→ 5 项失败；负向 B（删引号）→ 6 项失败；还原后 38/38；`npm run derive-preset` 重跑哈希不变（幂等） |
| 7 同步 | `syncPresets()` → `copied: [agent.cordis.yml]`、`skipped` 3、`failed: []`、`removed: []`；安装副本与仓库字节一致；harness 判定安装根的 `ptc-bash` **healthy**（此前为 `not valid YAML`），liangshen 仍 healthy |
| 8 会话验证 | 用户已在 GUI 确认「已正常」（新会话挂载 / 历史会话恢复 / `bash` 工具可用） |
| 9 收尾 | Phase 3.3 spec：新增共享 guide `.trellis/spec/guides/dsh-upgrade-derived-assets.md` 并登记进 `guides/index.md`（升级后重派生 + 用 harness 发现 API 判定组合健康）；`.scratch/` 已清理；提交与归档由 Phase 3.4 / finish-work 执行 |

## 验证命令

```powershell
cd D:\project\dsh\dsh-plugin\dsh-plugin-ptc-bash
npm test
node --check lib/index.js; node --check presets/ptc-bash/dsh-bash-win.mjs; node --check presets/ptc-bash/workspace-instructions.mjs
npm run derive-preset          # 幂等：重跑后 git diff 不新增差异
```

## 回滚点

- 步骤 2 之前：`agent.cordis.yml` 的 HEAD 版本即基线（注意：它对应 0.1.5 时代的行，回滚即回到 0.1.6 下不可用）。
- 派生结果不合意：`git checkout -- presets/ptc-bash/agent.cordis.yml`。
- 同步后要退回：修回源文件再跑一次同步（幂等，会覆盖回去）。

## 风险闸门

- 步骤 2 的锚点失败、步骤 6 的负向用例不失败、或层 1 守卫对官方预设误报 —— 三者任一出现即停止并回到 design.md 修订，不带病推进。
