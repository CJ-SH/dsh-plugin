# Implement — 5 个插件的 README 双语重写与 docs/ 搬运

> Task: `09-29-plugin-releases` · 关联：[prd.md](./prd.md) · [design.md](./design.md)

## 0. 前置

- **未经用户明确同意不 commit、不 push**（AGENTS.md）。
- 本阶段**不写英文稿**：`README.md` 的英文重写只在用户 review 通过中文稿之后开始（R3/R6）。
- 顺序理由：先做 `docs/` 再做 README —— 两者来自同一遍阅读，且 README 的「深入阅读」必须指向已存在的 docs。

## 1. 逐仓库执行（5 个仓库各一遍，顺序：ollama-usage → ptc-bash → suite → trellis-statusline → web-search）

- [ ] 1.1 通读现状 `README.md` 全文，按 design.md `3 的表格逐小节落 keep / move / drop；表格未覆盖的小节按 `3 的分类规则现场判定并记录。
- [ ] 1.2 写 `docs/design-notes.md`：按 design.md `4 的固定结构把 move 类内容逐节搬入，只删过程化叙述，事实点（命令/路径/状态码/席位 id/限制）不得丢。statusline 为增补现有文件，其余 4 个新建。
- [ ] 1.3 写 `README.zh.md`：按 design.md `2 模板；长度 ≤90 行；安装命令与现状逐字一致。
- [ ] 1.4 改 `package.json` 的 `files`：按 design.md `6 的表。
- [ ] 1.5 该仓库自检：`npm test` 全绿；`git status --short` 只出现预期文件；`grep -n docs/design-notes.md README.zh.md` 命中。

## 2. 阶段闸门 A：中文稿 review（用户）

- [ ] 2.1 汇总 5 份 `README.zh.md` 的体量变化与分类结果，连同文件一起交用户 review。
- [ ] 2.2 **停止点**：review 未通过前不写英文、不 commit。用户要求调整结构/取舍时，回到 `1 对应仓库重做并重新提交 review。

## 3. 阶段 B：英文稿（review 通过后）

- [ ] 3.1 逐仓库写 `README.md`：与 `README.zh.md` 小节数量、顺序、信息量一致；顶部互链；不新增小节。
- [ ] 3.2 双语对校验：对每仓库比对两份文件的三级以内标题行，diff 必须为空。
- [ ] 3.3 复跑 `npm test`；核对 `files` 与磁盘一致。
- [ ] 3.4 交用户确认后 commit（子模块各自提交；父仓库 gitlink 指针更新是否同批由用户定）。

## 3.5 阶段 C：提交 + 推送 + 发布（用户 2026-09-29 明确授权）

- [ ] C1 双语对校验：5 仓库的标题层级序列 diff 为空；`npm test` 全绿；`git status` 只含预期文件。
- [ ] C2 子模块提交（每仓库两笔，**不 amend**）：
  - ① README 批次：`README.zh.md`、`README.md`、`docs/`、`package.json`（仅 `files`），外加 suite 的 `LICENSE` 与 ptc-bash 的 `test/manifest.test.mjs`（包布局声明同步）。
  - ② 版本批次：`package.json` 的 `version` `0.1.0` → `0.2.0`。
- [ ] C3 推送 5 个子模块：先清空 `credential.helper` 再注入一次性 PAT helper（本机凭据管理器条目属于无权限账号），**token 不写入任何 .git/config**。
- [ ] C4 打并推送注释 tag `v0.2.0`，指向 ② 的提交。
- [ ] C5 用 REST API 建 5 条 GitHub Release：标题含包名与版本；正文**双语**（英文在前 → `---` → 中文），每条至少 2 处可对应到具体 commit。
- [ ] C6 父仓库更新 gitlink 指针并提交推送（两次指针更新是否合成一笔由用户定）。
- [ ] C7 三向核对：`git ls-remote --tags origin`、`/repos/CJ-SH/<repo>/releases`、`package.json.version` 三者一致；无「有 tag 无 release」。

## 4. 验证命令清单

```bash
# 每仓库
cd <repo> && npm test
git status --short
grep -n "docs/design-notes.md" README.zh.md README.md

# 体量（AC1）
wc -l README.md README.zh.md docs/design-notes.md

# 双语小节一致性（AC3）：只比标题层级序列（去掉文字），diff 必须为空
diff <(grep -E "^#{1,3} " README.md | sed "s/[^#].*//") <(grep -E "^#{1,3} " README.zh.md | sed "s/[^#].*//")

# files 白名单 vs 磁盘（AC5）
node -e "const p=require('./package.json');console.log(p.files)"
```

## 5. 风险文件与回滚点

- 高风险文件：5 份 `README.md`（英文，内容最多）、5 份 `docs/design-notes.md`（搬运最易丢事实）、5 份 `package.json`（只改 `files`）。
- 回滚：未提交时 `git checkout -- <path>`；已提交时 `git checkout <sha> -- <path>`。
- 提交前核对：`git diff --stat` 应只出现 README / docs / package.json。

## 6. 收尾后检查

- [ ] 5 个仓库都满足 AC1–AC6；未达标的仓库单独列出处理，不整批放过。
- [ ] 把本阶段结论回写 `.trellis/spec/guides/`（README 双语骨架 + keep/move/drop 分类规则），供第 6 个插件复用。
- [ ] 发布阶段（Deferred）恢复前重跑一次现状核查：版本字样位置可能因 README 重写而位移（原 R5 的对象）。
## 阶段 A 实施记录（2026-09-29，中文稿 review 前）

- 产出：5 个仓库各新增 `README.zh.md`（82 / 55 / 55 / 74 / 64 行）与 `docs/design-notes.md`（196 / 182 / 179 / 548 / 219 行；statusline 为增补）；`package.json.files` 同步（`README.zh.md` + `docs`）；5 仓库 `npm test` 全绿（ollama 128、ptc-bash 60、suite 59、statusline 254、web-search 212 断言）。
- 主 agent 唯一改动的测试：`dsh-plugin-ptc-bash/test/manifest.test.mjs:23` 目录白名单加 `'docs'`（同步包布局声明，断言语义未放松；其余 4 仓库无同类断言）。
- 空白规范化：ptc-bash / suite 的 `README.zh.md` 在标题后补空行，与其余 3 份对齐。

### 事实纠正（英文稿必须沿用）

1. `dsh-plugin-web-search` 断言数：旧 README 写 194 / 123 / 32，实测 **212 / 131 / 42 / 39**。
2. `dsh-plugin-ollama-usage` 断言数：旧 README 写 120 / 33，实测 **128 / 41**（host 71 / card 10 / hero 6）。
3. `dsh-plugin-ollama-usage` 配置入口：旧 README 称「配置卡片暂不可见」，但 `lib/client.js:975` 实际注册了 `settings.section`（id `ollama-usage`, order 170，装了 suite hub 时让位 `plugin-suite.panel`），测试亦断言该席位 → README 写「设置里的『Ollama 用量』页」。
4. `dsh-plugin-ptc-bash` 安装段：旧 README 是占位符 `<本包目录或 git URL>` → 展开为 `github:...` 与 `./dsh-plugin-ptc-bash` 两条真实命令。
5. `dsh-plugin-web-search` 安装段：旧的 `<插件目录>` / tgz → `./dsh-plugin-web-search`，`npm run link-imports` 保留为额外一步；`npm pack` tgz 路线移入 docs。
6. `dsh-plugin-suite` 的 `package.json.description` 仍写着 read-only status board（状态板已砍）—— 本轮按「只改 files」未动，记入 docs 的已知漂移。

### 用户 review 反馈（2026-09-29，阶段 A）

- **suite 的 LICENSE 缺口现在补**（D7）：新增 `dsh-plugin-suite/LICENSE`（MIT，`Copyright (c) 2026 HenTaiCJN`，与其余 4 仓库逐字同文）；`package.json.files` 早已声明 `LICENSE`，故白名单与磁盘就此一致；`docs/design-notes.md` 的《Provenance and license》已改写（原来那句「files 声明了 LICENSE 但仓库没有该文件」已过期）。README 的 License 段按用户口径**保持只写 `MIT`**。

- **ptc-bash 彻底去掉「梁神模式」表述**（用户：预设与梁神模式已无关系，现在的预设就是 ptc + bash）：`README.zh.md` 与旧 `README.md` 的 intro 均已改写为「以官方 PTC preset 为底座，首个回合即为 PTC」。**英文稿同样不得出现该表述，也不得出现「特殊第一轮」式的对比框架。**
- 仍保留的 `liangshen` 字眼只属于两类，均不得删：① Apache-2.0 **出处/改动声明**（`NOTICE`、`LICENSES/dsh-liangshen-Apache-2.0.txt`、`presets/*/dsh-bash-win.mjs` 与 `workspace-instructions.mjs` 的 provenance 注释、docs 的《出处与许可》）；② **工具链**（`tools/derive-preset.mjs` 的 `LIANGSHEN_PRESET_DIR` / 源路径、docs 的命令示例）。

### 待用户 review 裁决

- suite 原 README 有「不要用 `dsh plugin --profile web add` 装这批 bundle」的警告；中文稿按模板给了两条 add 命令 + 「回查 `dsh.profile.bundles`」一行。是否要恢复更强警告？
- suite 无 `LICENSE` 文件 → 其 License 段只写 `MIT`（其余 4 个为 `MIT © 2026 HenTaiCJN`）。是否本阶段补齐 LICENSE（D6 原本排除）？
- ptc-bash「技术说明」写了具体超时数值（120000 / 600000 / 64000），是否超出「少量介绍性质」？