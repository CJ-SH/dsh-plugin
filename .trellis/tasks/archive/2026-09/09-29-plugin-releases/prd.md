# 插件 README 双语重写与 docs/ 搬运（发布暂缓）

> Task: `09-29-plugin-releases` · Package(注册面): dsh-plugin-ollama-usage · 分支: master · 状态: planning
> 工件：[design.md](./design.md)（模板 + 分类 + 双语规则）· [implement.md](./implement.md)（执行顺序 + 验证命令）

## Goal

把 5 个插件仓库的 README 改造成「**简洁 + 功能/使用/安装靠前 + 技术细节后置**」的统一结构，并补齐**中英双语**：让第一次来的人在首屏就知道「这是什么、怎么装、怎么用」；被挤出的技术细节搬进各仓库 `docs/design-notes.md` 而不是丢掉。

**用户价值**：新访客 30 秒内能判断插件是否合用并完成安装；中英双语对与上游 dsh / `@linxin666` 插件包的落盘惯例一致；操作与排障知识有稳定发现路径，不再靠 git 历史打捞。

## 决策记录

| ID | 决策 | 结论 | 影响 |
|---|---|---|---|
| D1 | 版本号口径 | 5 个仓库统一升到 `0.2.0`（对齐 dsh 0.2 兼容基线） | **暂缓**，见 Deferred |
| D2 | 发版自动化深度 | 手工一次性 + 流程沉淀为 spec 指南，不加 CI/脚本 | **暂缓**，见 Deferred |
| D3 | 执行顺序 | 发布搁置，先校正 README 与语言问题 | 本阶段只做文档；版本号/Release 留到后续 |
| D4 | 双语落盘形式 | `README.md` = 英文（GitHub 默认展示）＋ `README.zh.md` = 中文，顶部互链；**不生成** `README.i18n.yaml` | 写作顺序：先中文稿交 review，通过后才写英文 |
| D5 | 被挤出技术细节的归宿 | 操作/排障/契约类 → 各仓库 `docs/design-notes.md`；纯过程性描述丢弃 | 4 个新文件（statusline 沿用已有）；`docs/` 进 `package.json.files` |
| D6 | 本阶段范围 | 只做 5 个插件的双语 README + `docs/` 搬运 | `dsh-plugin-suite` 的 LICENSE 缺口、父仓库 README 不在本阶段 |
| D8 | Release 正文语言（用户 review 追加） | **双语**：英文在前 → `---` → 中文，两半同信息量 | 5 条 Release 正文都双语；格式写进 `.trellis/spec/guides/` 的发版指南 |
| D7 | suite 的 LICENSE 缺口（用户 review 追加） | **现在补**：新增 `dsh-plugin-suite/LICENSE`（MIT，`Copyright (c) 2026 HenTaiCJN`，与其余 4 仓库逐字同文）；README 的 License 段按用户口径保持只写 `MIT` | `files` 里声明的 `LICENSE` 不再悬空（AC5 可过）；docs 的《Provenance and license》同步改写 |

## Background（已核验证据）

### 现有 5 份 README

| 仓库 | 行数/字节 | 语言 | 主要问题 |
|---|---|---|---|
| dsh-plugin-ollama-usage | 205 / 12.3KB | 中文 | 技术细节占比过半，无靠前的使用示例 |
| dsh-plugin-ptc-bash | 172 / 12.2KB | 中文 | 「验证/迭代注意/回滚」是开发者笔记，对使用者无意义 |
| dsh-plugin-suite | 87 / 4.0KB | 英文 | 安装在第 4 节；无中文版；缺使用/卸载/License |
| dsh-plugin-trellis-statusline | 250 / 14.2KB | 英文 | 最长；席位契约与内部路由占大头 |
| dsh-plugin-web-search | 187 / 9.1KB | 中文 | **安装在第 133 行**（文末），首屏全是 wire 格式契约 |

- 语言分布：3 中文 + 2 英文，**没有任何仓库同时具备两种语言**。
- 逐小节 keep / move / drop 的完整清单见 [design.md `3](./design.md)。

### 生态惯例（本机实测）

- `@linxin666/*` 与上游 `@deepseek-ai/dsh` 一律 `README.md`（英）＋ `README.zh.md`（中）＋ `README.i18n.yaml`（两文件 git blob 哈希对账，由上游自家脚本生成）。
- 双语 README 的**标题下一行**即互链：`English | [中文](README.zh.md)`。
- 参考样本 `@linxin666/dsh-client-ui-plugin-manager/README.md`：85 行；结构为 名 → 语言链 → 一句话定位 → What it does → Install（npm/仓库两条）→ Config → Cordis service → Known limitations → Security model → Telemetry → License。
- `dsh-plugin-trellis-statusline` 已有 `docs/design-notes.md`，且 `package.json.files` 已含 `"docs"` —— 仓库内已有「技术细节放 docs/」的先例。
- `awesome-readme`（用户指定参考）的优秀元素：项目图标/截图、清晰描述、徽章、TOC、逐步安装指引、功能列表、延伸阅读、License。5 个仓库均自带 `icon.svg`，可作项目图标。

### 其它约束

- 本机 profile 用 `link:` 指向工作树，**README 改动不影响运行时**，回滚即 `git checkout`。
- `package.json.files`：4 个仓库含 `"README.md"`（不含中文文件）；statusline 额外含 `"docs"`。
- `dsh-plugin-suite` 的 `files` 曾声明 `LICENSE` 而仓库无该文件 —— 已在阶段 A 按 D7 补齐。

## Requirements

- **R1 结构统一**：5 份 README 共用同一骨架且顺序固定：`标题 → 语言互链 → 一句话定位 → 功能 → 安装 → 使用 → 卸载 → 技术说明(可选) → 深入阅读 → License`。安装必须紧跟功能，不得出现在文末。
- **R2 简洁**：以行数设上限（AC1），删掉面向开发者而非使用者的章节（验证步骤、迭代注意、回滚、内部席位/路由契约、散文式原理），原理只保留「介绍形式」的少量要点；被删内容按 D5 处置。
- **R3 双语对**：每仓库产出 `README.zh.md` 与 `README.md`，内容一一对应（同小节、同顺序、同信息量），顶部互链。
- **R4 参考 awesome-readme**：项目图标（复用 `icon.svg`）、一句话定位、要点式功能列表、可复制命令、License 段；徽章/TOC 视篇幅取舍（简洁优先）。
- **R5 事实保留**：README 不得引入与代码不一致的说法；`docs/design-notes.md` 的搬运只删过程化叙述，事实点不得丢。
- **R6 交付节奏**：先交 5 份中文稿供 review；**review 通过后才写英文**，英文不得先行。
- **R7 可核验**：改写后每仓库 `npm test` 复跑；双语小节数/顺序用一次性 diff 校验；`files` 与磁盘比对。

## Acceptance Criteria

- [ ] **AC1** 5 份中文 README 正文 ≤ 90 行，且相对现状行数削减 ≥ 40%；第一屏可见「一句话定位 + 功能 + 安装」。
- [ ] **AC2** 每份 README 的安装段含可直接复制执行的命令（`dsh plugin --profile web add github:CJ-SH/<repo>` 与本地目录两条路径），且与现状 README 里的命令逐字一致。
- [ ] **AC3** 中文稿 review 通过后，每仓库 `README.md` 与 `README.zh.md` 的**标题层级序列**（去掉文字后的 `#` 序列）diff 为空——数量/顺序/层级一致（文字必然不同，按文字 diff 是错的）；顶部互链正确。
- [ ] **AC4** 5 个仓库均有 `docs/design-notes.md`（承载操作/排障/契约类内容），README 末尾有指向它的「深入阅读」链接；纯过程性描述未混入 docs。
- [ ] **AC5** 5 个仓库 `npm test` 全绿；`package.json.files` 与实际文件一致；`git status` 干净。
- [ ] **AC6** 人工逐条核对：README 中的插件名、命令、配置路径、License 与仓库实际一致（结论记录在本任务）。

## Out of Scope（本阶段）

- 版本号改动与 GitHub Release（D1/D2 暂缓）。
- 不改 `lib/`、`locale/`、`cordis.patch.yml`、`test/`，不新增 CI，不发 npm。
- 不生成 `README.i18n.yaml`（D4）。
- `docs/design-notes.md` 不做双语（唯一双语对象是 README）。
- 不写父仓库 `CJ-SH/dsh-plugin` 的 README（D6）。`dsh-plugin-suite` 的 `LICENSE` 缺口已由用户裁决在阶段 A 补齐（D7），不再排除。

## Deferred（原发布计划：暂缓但保留，恢复前需重跑现状核查）

- 5 个包统一 `0.1.0 → 0.2.0`；每仓库一个版本提交；各打 `v0.2.0` annotated tag 并推送。
- 每个 tag 建一条 GitHub Release，正文**双语**（英文在前 → `---` → 中文，D8），可追溯到具体 commit（首次发布覆盖仓库全史），标题含包名与版本。
- 同步 `dsh-plugin-web-search/README.md:137` 的 tgz 版本字样（重写后行号会位移，须重新定位）。
- 发版流程写进 `.trellis/spec/guides/`（tag 命名、正文结构、递增规则、推送命令与一次性 PAT credential helper 注意事项）。
- 父仓库更新 5 个 gitlink 指针并提交（不含 tag/Release）。
- 未决：Q6 —— `0.2.0` 是跟随 dsh 兼容线的号还是这一次的里程碑号，决定未来是否每次 dsh 兼容基线变动就 bump minor。
- 仍未纳入：父仓库 `CJ-SH/dsh-plugin` 无双语 README。

## Technical Notes

- 发版顺序（Deferred 阶段）：先子模块 commit + tag + push，再建 Release，最后父仓库更新指针，否则父仓库会短暂指向远端不存在的 commit。
- 推送凭据：本机 github.com 的 Windows 凭据属于无写权限账号，必须走一次性 PAT credential helper（清空 `credential.helper` 再注入），PAT 带 `repo` + `workflow` 权限；推送前需用户明确同意。
- `package.json.files` 改动：把 `"README.md"` 扩成 `"README*.md"` 或并列两项，并加 `"docs"`（statusline 可直接对照）。
- Trellis 注册的 package 只有 `dsh-plugin-ollama-usage`，本任务跨 5 仓库，`task.json.package` 沿用默认值，不影响验收。