# Design — 5 个插件的 README 双语重写与 docs/ 搬运

> Task: `09-29-plugin-releases` · 阶段：README（发布暂缓）· 关联：[prd.md](./prd.md) · [implement.md](./implement.md)

## 1. 边界

**改**（仅这四类，全部在 5 个插件子模块仓库内）：

| 文件 | 动作 |
|---|---|
| `README.zh.md` | 新建（中文门面，review 对象） |
| `README.md` | 重写（英文门面，中文稿通过后才动） |
| `docs/design-notes.md` | 新建 4 份（statusline 已存在，沿用并增补） |
| `package.json` | 仅 `files` 白名单：补 `README.zh.md`、补 `docs` |

**不改**：`lib/`、`locale/`、`cordis.patch.yml`、`test/`、版本号、LICENSE、父仓库任何文件。

## 2. README 模板（唯一骨架，5 仓库共用）

中文稿 `README.zh.md`（英文稿 `README.md` 为同一骨架的英文镜像）：

```markdown
# <包名>

[English](README.md) | 中文

<一句话定位：谁、在哪里、看到什么>

## 功能
- 3–6 条要点，每条一句话，写「用户得到什么」而不是「内部怎么实现」

## 安装
### 从 GitHub 安装（推荐）
```bash
dsh plugin --profile web add github:CJ-SH/<repo>
```
### 从本地目录安装
```bash
dsh plugin --profile web add ./<repo>
```
<仅 ollama-usage / web-search 需要：link: 安装的额外一步命令>

## 使用
- 入口在哪（设置 → … / 会话页哪个位置）
- 你会看到什么（一两句，必要时保留现状的 ASCII 示意）
- 配置在哪（指路，不展开配置模型）

## 卸载
```bash
dsh plugin --profile web remove <包名>
```

## 技术说明
- ≤5 条介绍性质要点（有则写，无则整节删除）

## 深入阅读
契约、排障与内部结构见 [docs/design-notes.md](docs/design-notes.md)。

## License
MIT
```

### 小节顺序（Key Decision）

`功能 → 安装 → 使用 → 卸载 → 技术说明 → 深入阅读 → License`。安装紧跟功能，因为「使用」以已安装为前提；web-search 现状把安装压到第 133 行是本阶段要修的主要毛病。

**执行细则（实施中裁决，2026-09-29）**：

- **安装路径只保留两条**：`github:CJ-SH/<repo>`（推荐）与本地目录 `./<repo>`。现状 README 里的 npm 安装（`dsh plugin --profile web add <包名>`）与 `npm pack` tgz 路线一律移入 `docs/design-notes.md` —— 这 5 个包在 npm 上都是 404，写进 README 是假指令。
- **License 行统一** `MIT © 2026 HenTaiCJN`（与各仓库 `LICENSE` 的版权行一致）；`dsh-plugin-suite` 没有 LICENSE 文件，只写 `MIT`。
- **编辑注释块**（如截图 TODO 的 HTML 注释）判定 drop，属作者过程笔记。

### 写作规则

1. **第一屏**：标题 + 语言链 + 一句话定位 + 功能前 2 条必须在 GitHub 首屏内可见（安装紧随）。
2. **一句话定位**：`<插件> 在 <位置> 显示/提供 <能力>`，不用「本插件旨在……」这类空话。
3. **功能**要点用「能力」句式；现状 README 里的契约、席位 id、状态码一律不进这一节。
4. **命令必须可直接复制**，且与现状 README 里的命令逐字一致（R2/AC2）。
5. **技术说明**最多 5 条，只写「用的时候要知道什么」（如凭据模式名称、已知限制），不写机制。
6. **深入阅读**在每份 README 里都必须出现，且链接目标存在（AC4）。
7. 长度预算：正文 ≤ 90 行；相对现状行数削减 ≥ 40%（AC1）。

## 3. 各仓库的 keep / move / drop 分类

分类规则：**keep** = 使用者读它是为了用；**move** = 操作、排障、契约、内部结构、开发流程 → `docs/design-notes.md`；**drop** = 当初怎么一步步做出来的过程叙述（git 历史足够）。

### dsh-plugin-ollama-usage（205 行，中文）

| 现状小节 | 处置 |
|---|---|
| 你会看到什么 | keep → 功能 + 使用（示意保留） |
| 要求 | keep 一行 → 安装前的前置要求 |
| 安装 / link: 额外一步 / 卸载 | keep（额外一步只留命令，原理 move） |
| 配置住在哪里（dsh 0.2 起） | keep 一句指路；配置模型 move |
| 凭据：两种模式 | keep 模式名一句；机制 move |
| 取数口径 | move |
| 不碰别人的行 | move（席位契约） |
| 数据保留 | keep 一句；细节 move |
| 结构 / 自检 | move（开发信息） |
| 故障排查 | move；README 由「深入阅读」承接 |
| License | keep |

### dsh-plugin-ptc-bash（172 行，中文）

| 现状小节 | 处置 |
|---|---|
| 预设里有什么 | keep → 功能 |
| 安装 | keep（含「重启后新会话可见预设」一句） |
| 验证 | move |
| 迭代注意 / 回滚 | move（开发流程） |
| bash 工具（dsh-bash-win） | move |
| 会话身份（DSH_*） | move |
| 派生脚本 | move |
| 出处与许可 | keep → License/出处一段；派生链细节 move |

### dsh-plugin-suite（87 行，英文）

| 现状小节 | 处置 |
|---|---|
| Why it exists | keep → 一句话定位 + 功能（压缩成 1 段） |
| How plugins join | move（席位契约） |
| What was cut | move |
| Install / Verify | Install keep；Verify move |
| — | 新增：使用、卸载、深入阅读、License（现状缺失，补上） |

### dsh-plugin-trellis-statusline（250 行，英文）

| 现状小节 | 处置 |
|---|---|
| What it is | keep → 一句话定位 + 功能 |
| Requirements | keep 一行 |
| Install / Uninstall | keep |
| No other bundle’s row is touched | move（契约） |
| The read-only status route | move |
| What you will see | keep → 使用（示意保留） |
| Where the task comes from | keep 一句；解析细节 move |
| What it does not do | keep 2–3 条（边界对使用者有价值） |
| Troubleshooting | move |
| Development | move |
| License | keep |

### dsh-plugin-web-search（187 行，中文）

| 现状小节 | 处置 |
|---|---|
| 核心概念：按格式兼容 | keep 压缩成 1 段（介绍形式） |
| 三个格式的契约 | move |
| 为什么要显式选择 | keep 2 条；论证 move |
| 接管与优先级 / 还原 / 卸载顺序 | move（操作顺序细节），README 只留卸载命令 |
| http 还是远端抓取 | move |
| 常见失败与含义 | move |
| 安装 | keep，**上移到功能之后** |
| 自检 | move |
| 扩展点：加一个格式 | move |
| 已知限制 | keep ≤3 条；细节 move |
| 许可 | keep |

## 4. `docs/design-notes.md` 的组织

- 每仓库一份，结构固定：`# <包名> 技术笔记` → `## 契约`（席位/路由/格式）→ `## 操作与排障` → `## 内部结构` → `## 开发与验证` → `## 出处与许可`（有则写）。
- **例外（实施中裁决）**：`dsh-plugin-trellis-statusline` 已有 447 行的 `docs/design-notes.md`，**只增补不重排**（重排会移动既有内容并放大丢失风险）；要求在每个 bucket 标题里标出映射，使五个 bucket 齐全。新建的 4 份按上面的顺序组织。
- 搬运纪律：**逐节搬，只删过程化叙述**；事实点（命令、路径、状态码、席位 id、限制）不得丢失；搬完在 README 的「深入阅读」里链接它。
- docs 的语言 = 被搬内容的原语言，**不强制双语**（本阶段唯一双语对象是 README）；statusline 的 `docs/design-notes.md` 保持英文。

## 5. 双语对规则与校验

- 落盘：`README.md`（英文）＋ `README.zh.md`（中文），顶部互链；**不生成 `README.i18n.yaml`**（没有上游的哈希脚本，手抄哈希是新的漂移源）。
- 对齐要求：两份文件**小节数量与顺序完全一致**、信息量一致（不是逐字直译，但不得一侧多出内容）。
- 校验（一次性命令，不新增脚本文件）：抽取两份 README 的标题**层级序列**（去掉文字、只留 `#` 个数）做 diff，必须为空——数量、顺序、层级一致；文字本身当然不同（中英）。**按标题文字 diff 是错的**（中英必然不同），命令写进 implement.md 的验证清单。

## 6. `package.json.files` 变更

| 仓库 | 现状 | 目标 |
|---|---|---|
| ollama-usage | `README.md` | `README.md`, `README.zh.md`, `docs` |
| ptc-bash | `README.md` | 同上 |
| suite | `README.md` | 同上 |
| statusline | `docs`, `README.md` | 再加 `README.zh.md` |
| web-search | `README.md` | 同 ollama-usage |

## 7. 回滚与风险

- 回滚：本阶段只动文档与 `files` 白名单，`git checkout -- <file>` 即可；无运行时影响（本机 profile 走 `link:`，加载不读 README）。
- 风险 1：**信息丢失** —— 靠 D5 的两桶分类 + `4 的搬运纪律缓解；AC4/AC6 是它的验收面。
- 风险 2：**命令失真** —— 精简时改坏安装命令；AC2 要求与现状逐字一致。
- 风险 3：**白名单遗漏** —— 新增文件没进 `files`，将来发版缺文件；AC5 比对 `files` 与磁盘。
- 风险 4：**双语漂移** —— 先写中文、后写英文，中间若改了中文；`5 的小节 diff 是兜底，且英文阶段严禁新增小节。