# implement.md — dsh-plugin-ptc-bash 执行清单

对应 PRD `prd.md`（R1–R14 / AC1–AC13）与 `design.md`。前置：Phase 2 开始时按 `trellis-before-dev` 读一次 spec 索引（当前 `.trellis/spec/` 只覆盖 `dsh-plugin-ollama-usage` 前端层，本任务命中不到，走 `guides/`）。

## 0. 准备

- [ ] 读 `design.md` 全文 + PRD 的 R 列表；把「三处 YAML 改动」「两个 .mjs 的改动点」「同步契约」抄成实施时的对照表。
- [ ] 确认工作区干净：`git status --short --branch`（root + 两个 submodule）。
- [ ] 建包目录 `D:\project\dsh\dsh-plugin\dsh-plugin-ptc-bash\`（**本地目录形态先行**；GitHub 仓库与 `git submodule add` 由用户操作，见 §7）。

## 1. 包骨架

- [ ] `package.json`：`name: dsh-plugin-ptc-bash`、`version: 0.1.0`、`type: module`、`main: lib/index.js`、`exports`（`.`、`./presets/*`、`./package.json`）、`files`、`engines`（对齐另两个 submodule）、`license: MIT`、`scripts.test: node --test test/`、`dsh.bundle.patch: ./cordis.patch.yml`；**无 dependencies**（peer/dev 也不需要）。
- [ ] `cordis.patch.yml`：`- insert:` + `- id: dsh-plugin-ptc-bash` / `name: 'dsh-plugin-ptc-bash'`（照抄 trellis-statusline 的形状）。
- [ ] `LICENSE`（MIT，作者 HenTaiCJN）、`NOTICE`（官方 PTC preset MIT；xiaobright/dsh-anchored-standard MIT；逐条列出派生自 `custom-bash.mjs`/`minimal-prompt.mjs` 的改动）、`README.md`（用途/安装/验证/迭代注意/回滚）。

## 2. 预设目录 `presets/ptc-bash/`

- [ ] 复制官方 `presets/ptc/agent.cordis.yml` 原文（`<dsh>/node_modules/@deepseek-ai/dsh-agent-presets/presets/ptc/agent.cordis.yml`）。
- [ ] 打三处改动：shell 区加 `custom-bash` 行、identity 区加 `workspace-instructions` 行、重写文件头注释（改动清单 + 出处）。**其余行逐字不动**（改完用 `diff` 复核：只应出现这三处差异）。
- [ ] `preset.yml`：`name: PTC + Bash 模式` / `description`（见 design.md §3）/ `order: 5`。
- [ ] `custom-bash.mjs`：从 `C:/Users/Hasee/.dsh/.agent-presets/liangshen/custom-bash.mjs` 派生 → 改描述、加 `tool:bash` 段、`inject` 加 `systemPrompt`；其余逻辑逐字保留。
- [ ] `workspace-instructions.mjs`：从 `.../liangshen/minimal-prompt.mjs` 派生 → 删裁剪/hint/workspace-line，保留发现/渲染/标记消息/动态投递；导出纯函数供测试。
- [ ] `node --check` 两个 `.mjs`（在包目录下执行）。

## 3. 同步插件 `lib/index.js`

- [ ] 实现 `syncPresets({ sourceRoot, targetRoot })` 纯函数（幂等逐字节比较、原子替换、源缺则删、写前结构校验、返回 `{copied,skipped,removed,failed}`）。
- [ ] 实现 `apply(ctx)`：解析包根与 `$DSH_HOME`、调用同步、`ctx.logger?.warn?.()` 上报 `failed`，异常全部吞掉（不阻塞宿主）。
- [ ] `node --check lib/index.js`。

## 4. 测试 `test/`

- [ ] `test/sync.test.mjs`：临时目录 + 注入源/目标根 → 首次复制完整、二次零写入（`copied.length === 0`）、源改后覆盖、源删后目标删、非法组合不写入且 `failed` 非空、目标根下另一个预设目录字节不变。
- [ ] `test/preset.test.mjs`：`agent.cordis.yml` 结构断言（`tool-bash`/`tool-pwsh`/`custom-bash` 三行与门控表达式、`tool-presentation` + `mode: ptc`、无 `tool-catalog`/`str_replace_editor`、行 `id` 唯一）；`preset.yml` id/name/description/order 合法且 id 不等于内置四个。
- [ ] `test/plugins.test.mjs`：假 `ctx` 记录 `tools.register`/`systemPrompt.section` 调用 → 断言 bash 描述含优先措辞、段名 `tool:bash` 且 order 来自 `getSectionOrder('TOOL_BASH')`；`discoverInstructionFiles`/`renderInstructionSection`（临时 AGENTS.md）/ `filterInstructionMessages`（基线消息被替换为标记、非指令消息原样、`baselineLoaded=false` 时原样透传）。
- [ ] `npm test`（= `node --test test/`）全绿。

## 5. 本地安装与端到端验证

- [ ] `dsh plugin --profile web add D:\project\dsh\dsh-plugin\dsh-plugin-ptc-bash`（该 CLI 走 pnpm：会写入 profile `dependencies` 并同步 `dsh.profile.bundles`）。
- [ ] 重启 `dsh web`（宿主需重载 bundle）→ 确认 `$DSH_HOME/.agent-presets/ptc-bash/` 出现且文件与仓库一致（`diff -r`）。
- [ ] 新会话选「PTC + Bash 模式」：AC2（`uname -s`/`git --version`/`pwd`；非零退出带输出回报）、AC3（SDK 里 `bash`+`pwsh`）、AC9（首轮即 PTC）、AC11（普通命令走 bash）、AC12（`tool:bash` 段在 `tool:pwsh` 前）。
- [ ] AC4：临时把 `bashPath` 指向不存在的路径（或在无 Git Bash 的环境）验证报错文本。
- [ ] AC1/AC6：预设选择器顺序与描述正确；新建梁神模式会话与官方 `ptc` 会话各一次，确认无回归。
- [ ] AC13 端到端复核：连跑两次同步（重启两次）观察第二次零写入日志/返回值。

## 6. 风险文件与回滚点

- 风险文件：`presets/ptc-bash/agent.cordis.yml`（唯一被官方 loader 直接消费的文件；改坏 = 预设 broken）、`lib/index.js`（会写用户目录）、`presets/ptc-bash/workspace-instructions.mjs`（会改消息流，写错会导致指令重复或丢失）。
- 回滚点：每完成 §1/§2/§3 各存一次 git 状态（**提交需用户明确同意**）；端到端验证前先记录 `$DSH_HOME/.agent-presets/` 的目录清单（当前只有 `liangshen`）。
- 紧急回滚：删 `$DSH_HOME/.agent-presets/ptc-bash/` + `dsh plugin --profile web remove dsh-plugin-ptc-bash`。

## 7. 收尾（需用户参与）

- [ ] 把 §5 的验证结果写回本任务的 `check` 记录（或 `.trellis/workspace/HenTaiCJN/` 日志）。
- [ ] **用户侧**：新建 GitHub 仓库（建议 `CJ-SH/dsh-plugin-ptc-bash`）→ `git init` + `git add` + 首次提交 + `git remote add` + `push`（**git 操作需用户明确同意**）→ 回到本仓库 `git submodule add <url> dsh-plugin-ptc-bash` 并提交 `.gitmodules`。
- [ ] 是否把 `settings.yaml` 的 `agent-presets.default` 改成 `ptc-bash`：默认**不动**，由用户决定。
- [ ] 可选：把 `README.md` 的安装说明从本地路径改成 npm/git URL 形式（发布后再做）。
