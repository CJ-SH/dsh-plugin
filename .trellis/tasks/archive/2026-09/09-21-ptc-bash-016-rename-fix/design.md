# 设计：ptc-bash 0.1.6 修复（重派生 + 防复发）

## 边界与不变量

- **唯一权威源**是仓库 `dsh-plugin-ptc-bash/presets/ptc-bash/`；`~/.dsh/.agent-presets/ptc-bash/` 只是宿主启动时由 `lib/index.js` 单向、幂等同步出来的产物（只拥有自己那个目录）。
- 不写随包预设根（`@deepseek-ai/dsh-agent-presets/presets/*`）、不改 profile 组合与 `settings.yaml`、不改 dsh 安装目录、**不新增任何运行时依赖**。
- 组合文件由 `tools/derive-preset.mjs` 从**装机官方 `ptc`** 派生（锚点全中才写盘）；它是唯一的"生成"路径，本预设对上游的任何偏离都必须以锚定改动 + 差异清单的形式表达，而不是手改 YAML。

## 修复形态（DEC1）

派生后与官方 0.1.6 `ptc` 的结构关系：

- **两处自有意新增行**：`workspace-instructions`（`./workspace-instructions.mjs`）、`dsh-bash-win`（`./dsh-bash-win.mjs`，win32 gate）。第 3 处改动是文件头注释。
- `delegation` 组内 `workflow-ptc`（引擎）、`tool-workflow`、`tool-ralph` **全部随上游 `disabled: true`**：PTC 模式下编排面只由 `run_code` + subagent 工具承担。
- 顶层补齐上游新增的 `tool-plugin-manager`（`@deepseek-ai/dsh-plugin-manager/tools`，`disabled: true`）。
- 其余每一行（含全部 `config`）与上游逐行一致 —— 这正是 AC8 的断言内容。

## 防复发：三层设计

### 层 1 · 同步路径守卫（运行时，离线可测）

`lib/index.js:56-85` 的 `validateComposition` 目前只检查顶层 `- id:` 行与紧跟的两空格 `name:` 前缀，**既不解析 YAML、也不看嵌套行**（F7），所以坏文件照样被同步进用户根（F8）。增补一条"标量引号闭合 / 行标量健全"检查（覆盖任意缩进的 `name:` 行），保持零依赖、保持错误信息可读；沿用现有 `failed` 上报路径，使**坏组合不被写入目标**。

定位是"宁可漏报也不误报"：它不是 YAML 解析器，只挡「手改把标量写坏」这一类；权威判定交给层 2。因此新增检查必须对官方四个预设 + liangshen 全部通过（正向对照，见 implement.md 步骤 6）。

### 层 2 · 权威健康检查（测试，harness 在位时）

直接用 harness 自己的发现 API，而不是另写一套判定：

```
discoverPresets(roots, harnessBase, resolves) -> AgentPreset[]
AgentPreset.broken?: string   // 「为什么这个预设无法组会话」，正常时为 undefined
```

`lib/types/discovery.d.ts:8-20` 明确写了健康检查覆盖的正是本次故障：「a row naming a package that was renamed or uninstalled」，且「stops short of importing anything」——判定不执行任何插件代码。这与用户看到的挂载错误是同一段代码路径的产物。

- `harnessBase` 定位候选（按序命中即用）：`$DSH_PLUGIN_HOME` → `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh/package.json` → `tools/derive-preset.mjs` 的默认开发路径。本机实测：`profiles/node_modules/@deepseek-ai/dsh` 是指向 nvm 装机的 Junction，其嵌套 `node_modules` 里就是全部插件包。
- `resolves` = 以该 base 建立的 `createRequire(...).resolve(specifier)` 布尔包装。本机实测结果与故障一致：`dsh-workflow-ptc` / `dsh-tool-workflow` / `dsh-tool-ralph` **可解析**，`dsh-workflow-worker-thread` / `dsh-tool-ptc` **MODULE_NOT_FOUND**。
- 找不到 harness ⇒ **skip 并打印原因**，不 fail：包在裸 checkout 下 `npm test` 仍须可用（层 1 + 层 3 仍生效）。
- 正向：扫描仓库 `presets/` 根，断言 `ptc-bash` 的 `broken === undefined`。
- 负向（AC2 的实打实证据）：对**变异副本**跑同一判定 —— 引擎行改回 `workflow-worker-thread`、删掉任一行 `name` 的收尾引号 —— 断言 `broken` 必现。

### 层 3 · 结构契约（离线，dependency-free）

- roster 与行口径断言（DEC1）：delegation 三行 `disabled`、`tool-plugin-manager` 存在且 `disabled`。
- 与官方 `ptc` 的结构 diff 断言（harness 在位时）：差异集合恰为 `{workspace-instructions, dsh-bash-win}`（AC8）——上游再改名/再调默认时，这条会先响。

## 测试清单

| 文件 | 变化 |
|---|---|
| `test/preset.test.mjs` | roster 期望加 `tool-plugin-manager`；新增 delegation 三行与 `tool-plugin-manager` 的 `disabled` 断言；保留 PTC 唯一声明等既有断言 |
| `test/composition-health.test.mjs`（新） | 层 2 的 health 判定 + 变异负向用例 + 层 3 的结构 diff；harness 缺失时 skip |
| `test/sync.test.mjs` | 新增「引号未闭合的组合被拒绝同步、目标目录不被写」用例 |

## 生效路径与验证

1. 仓库修好 → `npm test` 全绿。
2. 同步到用户根：调用包内 `syncPresets()`（幂等、只碰 `ptc-bash`），或重启 `dsh web`（宿主启动时同步）。
3. 挂载代际只以组合文件的 **mtime+size** 为键 ⇒ 同步改了 mtime，新会话即用新代；本次不改 `.mjs`，无需额外重挂。
4. 会话级验证只能由用户在 GUI 完成：新建 ptc-bash 会话（AC4）、恢复原失败会话（AC5）、会话内 `bash` 跑 `env | grep '^DSH_'`（AC6）。

## 兼容性

- 0.1.6 仍有 `shellEnv.collect(execution)`（`dsh-shell-env/lib/types/index.d.ts:87`）与 subprocess spawn spec 的显式 `env`（`dsh-subprocess/lib/types/index.d.ts:14-31`），故 `dsh-bash-win.mjs` 不需要改动。
- 预设其余行与上游逐行一致，config schema 风险由"等于上游"直接消掉；`!!js` 平台门控写法与上游同名同形。

## 回滚

- 基线 = 修复前的 `git diff`（工作区里那份坏文件；HEAD 是 0.1.5 时代的旧行）。
- 回滚源文件：`git checkout -- presets/ptc-bash/agent.cordis.yml`，再跑一次同步即可生效；但这会回到「0.1.6 下不可用」，所以真正的回滚点是**修好后的提交**（提交需用户明确同意）。
- 派生脚本报锚点缺失时**不允许手改 YAML 绕过**：更新 `tools/derive-preset.mjs` 的锚点并记录。

## 风险

- **RISK-1 / RISK-2** 见 `prd.md`（liangshen 覆盖、上游再改名）。
- **RISK-3** 层 2 依赖本机 harness 布局（profile Junction → nvm 装机）。候选根列表 + skip 提示使其不至于变成误报；若将来布局变化，测试会 skip 而不是假绿——但这意味着守卫变弱，需在此处更新候选根。
