# 创建 PTC+Bash Agent 预设（`dsh-plugin-ptc-bash`）

## Goal

在 dsh 中新增一个可选 agent 预设（id `ptc-bash`，显示名暂定「PTC + Bash 模式」），以**官方 PTC 预设**为底座、去掉梁神模式的「特殊第一轮」，在 Windows 上提供以 **Git Bash 为首选**的 shell，并把 AGENTS.md 指令链放进系统提示词。预设以本仓库 `D:\project\dsh\dsh-plugin` 的**第三个 submodule** 形式交付，submodule 本身是一个标准 dsh 插件包（启动时幂等同步预设文件到发现根）。

用户价值：

- 编码 agent 用自己更擅长的 bash 方言执行命令，而不是被限定在 pwsh。
- 预设不再黑箱：与官方 PTC 的差异逐条可列举（见差异清单）。
- 梁神模式与官方四个预设保持不动，可随时回退。

## 已确认决策

- **DEC1 底座**：逐行复制官方 `ptc` 的 `agent.cordis.yml`，只做本 PRD 与 `design.md` 记录的改动。
- **DEC2 提示词层（B1）**：保留官方**全部**提示词段落（不裁剪）；只做单项增强——AGENTS.md/CLAUDE.md 指令链进 system prompt（派生小插件实现）。
- **DEC3 工具**：带入 `custom-bash.mjs`（win32 的 `bash` 工具，Git Bash）。
- **DEC4 去掉特殊第一轮**：不移植 `tool-catalog.mjs`（锚定 / 动态 PTC 声明 / durable 工具目录消息三者一体），恢复官方 `tool-presentation`（`mode: ptc`）；第一回合起就是 PTC。
- **DEC5 shell 组成**：win32 上 `bash` 与官方 `pwsh` **并存**，但 **bash 最高优先级、尽可能不用 pwsh**；pwsh 行保持官方配置。
- **DEC6 交付形态**：submodule = 标准插件包（含启动同步），本仓库只管理 submodule，不直接版本化插件内容。

## 背景：为什么官方四个预设没有 bash（带证据）

结论：**bash 工具不缺，缺的是 Windows 上可用的 bash 执行器与可执行文件解析。**

1. `@deepseek-ai/dsh-tool-bash` 的 lib 无平台分支；平台差异在它消费的 `ctx.shell` 执行器一侧。
2. 宿主组装成对挂载执行器并按平台互斥（`@deepseek-ai/dsh-base/cordis.patch.yml:214-222`）：`bash-sandbox` 关 win32、`pwsh-sandbox` 关 POSIX。
3. 同一 patch 的模型可见工具行重复同一门控（`:246-252`）：`tool-bash`（非 win32）/ `tool-pwsh`（win32）。
4. 四个内置预设照抄：`presets/ptc|standard|cordis/agent.cordis.yml:52-58`、`presets/minimal/agent.cordis.yml:21-69`。
5. win32 上不能「顺手开一下」的原因：
   - 持久 bash 走 PTY，`dsh-subprocess-local/lib/runner-launch-*.js` 在 win32 抛 `terminal inspection is unsupported on platform win32`。
   - `dsh-bash-local` 固定 spawn `["bash","-c",command]`（`lib/index.js:214-217`），README 自称「POSIX 上的默认 Bash 执行器」，不做 Git Bash 推断。
   - 沙箱化 bash 在 Windows 不实际：win32 的 runner 链只有 `windows-acl`（`dsh-sandbox-local/lib/index.js:175`），受限令牌下管道 stdio 捕获会 EPERM（`dsh-tool-pwsh/README.zh.md:58`、`:200`）。
   - 官方配对是「平台原生 shell + 该平台的语言/沙箱事实」；`dsh-tool-pwsh/README.zh.md:32`：「当命令集是 bash 方言时选择 `dsh-tool-bash`；两者之间没有翻译」。
6. 梁神的 `custom-bash.mjs` 补的正是第 5 条：Git Bash 探测（git 安装根 → 环境变量推导根 → PATH 兜底）+ `ctx.subprocess.spawn`，找不到就报可行动的错，绝不静默降级成 pwsh/cmd。

## 差异清单：官方 PTC vs 梁神模式

除下表差异外，两份 `agent.cordis.yml` 在 delegation / compaction / planning / todo / ask-user / skill / fs / jobs / ralph 上逐行一致（已逐行核对）。

| # | 维度 | 官方 PTC | 梁神模式 | 本预设 |
|---|---|---|---|---|
| 1 | shell（win32） | `pwsh`（`dsh-pwsh-sandbox`，带升权语义） | `custom-bash.mjs`：Git Bash，无沙箱约束、无跨调用状态、非零退出以错误结果回报 | 两者并存；**bash 首选**（DEC5） |
| 2 | shell（POSIX） | `tool-bash` + `bash-sandbox` | 持久 PTY bash（跨调用保留状态，300s） | 保持官方 |
| 3 | 系统提示词 | 官方完整段落 | `minimal-prompt.mjs`：只留 persona + `plan:policy` + PTC SDK 段 | 官方段落不动；另加「指令进 system prompt」（DEC2/B1） |
| 4 | 首轮工具面 | 第一回合起就是 PTC | 首轮收窄为原生 4 工具，二回合起切 PTC | 保持官方（DEC4） |
| 5 | 工具目录消息 | 无 | durable 工具签名摘要 | 不带（DEC4） |
| 6 | 编辑工具 | 无 `str_replace_editor`（用 `write`/`edit`） | 额外注册 `str_replace_editor` | 不带（主要服务锚定轮） |
| 7 | goal 命令 | `command-goal` + `tool-goal`（有 `/goal`） | 只有 `tool-goal` | 保持官方 |
| 8 | web | `fetch: true`（有 `web_fetch`） | `fetch: false` | 保持官方 |
| 9 | subagent | `modelSelectionSettings: true` | 无该字段 | 保持官方 |
| 10 | 元数据 | 内置 id `ptc`、`order: 2` | 自定 name/description、`order: 4` | 自定 id `ptc-bash`、显示名「PTC + Bash 模式」、`order: 5` |

## 需要（Requirements）

- **R1** 预设以官方 `ptc` 的 `agent.cordis.yml` 为底座逐行复制，只做 design.md 记录的改动。
- **R2** win32 会话可调用名为 `bash` 的工具（Git Bash、`bash -c <command>`）；找不到 Git Bash 时给出可行动的报错，绝不静默降级为 pwsh/cmd。
- **R3** 非 win32 会话保持官方行为（`tool-bash` + `bash-sandbox`），且自定义行在该平台不挂载。
- **R4** 预设自带 `preset.yml`（显示名、描述、order）；id 匹配 `[a-z0-9][a-z0-9-]*` 且不与内置/随包预设重名。
- **R5** 交付物包含出处与许可说明（MIT）：官方 PTC preset、xiaobright/dsh-anchored-standard（`custom-bash.mjs`、`minimal-prompt.mjs` 的派生点与改动都要写明）。
- **R6** 不修改 dsh 安装目录、内置预设与 `settings.yaml` 的 `agent-presets.default`（除非用户显式要求）。
- **R7** 官方 `tool-presentation`（`mode: ptc`）行保留，且是该 scope **唯一**的呈现声明（`tools.presentAs()` 二次声明会抛错）。
- **R8** 官方提示词段落一律不改（只允许追加新段）。
- **R9** B1 插件按 `design.md` §B1 约束实现：追加 `workspace-instructions` 段 + 装配变量承载正文、抑制官方重复注入（保留消息换正文）、保留动态子目录指令投递、失败只降级告警。
- **R10** 预设目录必须是真实目录（发现用 `readdir(withFileTypes)` + `isDirectory()`，符号链接目录会被跳过）。
- **R11** `bash` 工具描述包含明确的优先级措辞，并注册 `tool:bash` 提示词段（`order = getSectionOrder('TOOL_BASH')`）承载同一规则。
- **R12** win32 上 `pwsh` 行保持官方配置（不 disable、不改参数）。
- **R13** submodule = 标准插件包：`package.json`（`dsh.bundle.patch`）、`cordis.patch.yml`、`lib/`（启动同步）、`presets/<id>/`、`test/`、`README.md`、`NOTICE`、`LICENSE`；零 `@deepseek-ai/*` 运行时依赖（与另两个 submodule 同风格）。
- **R14** 同步只拥有 `$DSH_HOME/.agent-presets/<id>/`：幂等（内容未变不写）、逐文件原子替换、源中已删除的文件在目标中删除、结构校验失败**不写入**并告警、其它预设目录绝不触碰、同步失败不阻塞宿主启动。

## 验收标准（Acceptance Criteria）

- [ ] **AC1** 新会话的预设选择器中出现该预设，显示名/描述/排序正确。
- [ ] **AC2** 在该预设会话里执行 `bash` 命令（`uname -s`、`git --version`、`pwd`）拿到输出；非零退出以「输出 + exit code」形式回报。
- [ ] **AC3** 工具面 = 官方 PTC 工具面 + `bash`；win32 下 `bash` 与 `pwsh` 并存；PTC 生效后都能在 `run_code` 的 SDK 里看到。
- [ ] **AC4** 用错误 `bashPath` 制造失败时，报错文本指向补救办法（装 Git for Windows / 暴露 bash 到 PATH / 配 `bashPath`）。
- [ ] **AC5** `node --check` 与仓库测试全绿；loader 能挂载该预设，roster 无 broken 记录。
- [ ] **AC6** 梁神模式与官方四个预设不受影响（仍可切换、仍可用）。
- [ ] **AC7** 非 win32 组合里预设仍可挂载（走官方 bash 路径）。
- [ ] **AC8** system prompt 里出现 `workspace-instructions` 段（含 AGENTS.md 正文），用户消息里不再出现同一份指令正文（只留标记消息）——由单元测试断言装配结果 + 实会话行为观察。
- [ ] **AC9** 第一个用户回合的 wire 就是 PTC（只有 `run_code` + SDK），无「首轮原生工具」窗口。
- [ ] **AC10** 改一处 AGENTS.md 后，下一次请求的系统提示词即反映新内容；某目录指令不可读时只告警不失败。
- [ ] **AC11** 普通命令（列目录/读文件/git/跑测试）由模型用 `bash` 完成；`pwsh` 只在明确需要 PowerShell 的任务里出现。
- [ ] **AC12** system prompt 里 `tool:bash` 段存在且排在 `tool:pwsh` 之前（order 1000 < 1010）。
- [ ] **AC13** 同步幂等：连跑两次同步第二次零写入；改动源文件后目标更新；删除源文件后目标对应文件移除；`agent.cordis.yml` 结构非法时不写入且告警；其它预设目录字节不变。

## 范围外（Out of Scope）

- 不为 Windows 提供沙箱化的 bash（受限令牌 + 命名管道限制）。
- 不做持久 shell（PTY 在 win32 不可用）。
- 不移植锚定轮、动态 PTC 声明、durable 工具目录消息（DEC4）。
- 不修改 dsh 源码/内置预设；不发布到 npm/市场（submodule 形态已为将来留路）。
- 不修复梁神模式本身；不调整 `deepseek-v4.1-flash` 的模型配置。
- 不弱化或改写 pwsh 的官方描述与段落。
- 不把 `agent-presets.default` 改成新预设（用户自行在设置里切换）。

## 关键文件锚点

- 官方 PTC 预设：`<dsh>/node_modules/@deepseek-ai/dsh-agent-presets/presets/ptc/agent.cordis.yml`（`<dsh>` = `D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh`）
- 宿主 shell 门控：`@deepseek-ai/dsh-base/cordis.patch.yml:199-252`
- 呈现声明约束：`@deepseek-ai/dsh-tools/lib/index.js:2705-2720`
- 提示词排序表与 `section()` API：`@deepseek-ai/dsh-system-prompt/lib/index.js:10-40`、`:230-249`
- 官方 bash 段/描述样例：`@deepseek-ai/dsh-tool-bash/lib/index.js:254-258`；官方 pwsh 描述/段：`@deepseek-ai/dsh-tool-pwsh/lib/index.js:134`、`:141-145`、`:228-232`
- 发现/元数据/挂载代际：`@deepseek-ai/dsh-agent-presets/lib/index.js:1240-1248`（Config）、`:1806-1820`（stamp = 组合文件 mtime+size）、`lib/invariant.js:395-402`（scanRoot）
- roster 服务无「注册根」API：`@deepseek-ai/dsh-agent-presets/lib/types/index.d.ts`（只有 `list/read/copy/remove/mount`）
- 官方指令注入：`@deepseek-ai/dsh-agent-instructions/lib/index.js`（Config 仅 discovery + `maxBytes`）
- 梁神模式：`C:/Users/Hasee/.dsh/.agent-presets/liangshen/{preset.yml,agent.cordis.yml,custom-bash.mjs,minimal-prompt.mjs,tool-catalog.mjs,NOTICE}`
- 生态先例（插件包 + 启动同步）：`@linxin666/dsh-liangshen`（`presets/liangshen/*` + `lib/index.js` 的 sync）

## 环境事实

- `$DSH_HOME` = `C:\Users\Hasee\.dsh`；`settings.yaml` 里 `agent-presets.default: liangshen`。
- 用户预设根 `$DSH_HOME/.agent-presets/`（现只有 `liangshen/`）；随包根优先于配置根、配置根优先于用户根；新目录对**新会话**即时生效，无需重启宿主。
- `@linxin666/dsh-client-ui-preset-center` 把市场预设装到 `$DSH_HOME/agent-presets/<id>/`（惰性库），启用时移入 `.agent-presets/`；自建目录被标「未托管」（禁用/卸载被拒，手工删目录即可）。
- 本机工具链：node v24.18.0、python 3.10.7、git 2.35.1.windows.2（`bash` 在 `/usr/bin/bash`）、`dsh` 0.1.5-rc.2（`dsh plugin --profile web <pnpm 参数>`）。
- 本仓库是插件管理仓库：两个 submodule（`dsh-plugin-trellis-statusline`、`dsh-plugin-ollama-usage`）+ `.trellis` 工作流；profile 以 `link:` 依赖它们。
- 用户侧待办（不阻塞实现）：新建 GitHub 仓库、`git submodule add`、提交/推送（git 操作需用户明确同意）。
