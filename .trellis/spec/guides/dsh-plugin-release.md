# dsh 插件发版流程（tag + GitHub Release）

> 适用：本元仓库 `CJ-SH/dsh-plugin` 下的 5 个插件子模块仓库（ollama-usage / ptc-bash / suite / trellis-statusline / web-search），以及将来新增的同族插件。
> 一次完整发版的实测产物见 `.trellis/tasks/09-29-plugin-releases`（2026-09-29，v0.2.0）。

## 何时发版

插件对外**有可见变化**（功能、兼容基线、安装方式）时才发；纯内部重构可攒着。本族的版本号口径是**与 dsh 兼容基线同号**：

- `peerDependencies.@deepseek-ai/dsh` 写 `^0.2.0-rc.1` ⇒ 包版本走 `0.2.x` 线；
- 兼容基线跨到 dsh `0.3.x` 时，插件 minor 跟着走到 `0.3.0`；兼容线内的修复走 patch。

## 前置检查（缺一不可）

- [ ] 工作树干净：`git -C <repo> status --porcelain` 为空（或只剩本次要提交的改动）。
- [ ] `npm test` 全绿。
- [ ] 双语 README 对：`README.md` 与 `README.zh.md` 的**标题层级序列**一致——
      `diff <(grep -E "^#{1,3} " README.md | sed "s/[^#].*//") <(grep -E "^#{1,3} " README.zh.md | sed "s/[^#].*//")` 无输出（按标题**文字** diff 是错的，中英必然不同）。
- [ ] `docs/design-notes.md` 与 README 的「深入阅读」链接存在。
- [ ] 文档里的版本字样同步（例：web-search 的 `docs/design-notes.md` 里 `npm pack` 的 tgz 文件名含版本号）。

## 步骤

### 1. 版本提交（单独一笔，不改别的东西）

```bash
sed -i 's/^  "version": "0.1.0",$/  "version": "0.2.0",/' <repo>/package.json
git -C <repo> add package.json
git -C <repo> commit -m "chore(release): v0.2.0"
```

文档批次（README / docs / 白名单）应与版本批次**分开提交**，便于回溯。

### 2. 推送分支与 tag

本机 github.com 的 Windows 凭据管理器条目属于**无写权限**的账号，直接 push 会 403（`denied to <别的账号>`）。必须清空 `credential.helper` 再注入一次性 PAT：

```bash
export GIT_TERMINAL_PROMPT=0
gitc() { git -c credential.helper= -c credential.helper='!f() { echo username=CJ-SH; echo password="$TOKEN"; }; f' "$@"; }
gitc -C <repo> push origin <branch>          # 4 个仓库是 main，suite 是 master
git -C <repo> tag -a v0.2.0 -m "v0.2.0"      # 注释 tag，指向版本提交
gitc -C <repo> push origin v0.2.0
```

**token 绝不能写进任何 `.git/config`**：用 `-c credential.helper` 传，不要 `git remote set-url` 带 token。

### 3. 建 GitHub Release（REST API，实测可用）

PAT 需要 `repo` 权限；`gh` CLI 不一定装。正文用 JSON 文件避免引号地狱：

```bash
node -e 'const fs=require("fs");const body=fs.readFileSync("notes.md","utf8");fs.writeFileSync("payload.json",JSON.stringify({tag_name:"v0.2.0",name:"<repo> v0.2.0",body,draft:false,prerelease:false}))'
curl -s -o resp.json -w "%{http_code}\n" -X POST \
  -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/CJ-SH/<repo>/releases" --data-binary @payload.json   # 期望 201
```

**正文格式（本族口径）**：双语，**英文在前 → `---` → 中文**；首版写「首个公开版本 + 主要能力 + 兼容范围 + 安装命令」，后续版本写相对上一版的差异。每条变化要能在 `git log` 找到对应 commit。

**正文里的链接必须用仓库的真实分支**：4 个仓库是 `main`，suite 是 `master`——写死 `/blob/master/` 会让 4 条中文链接 404。

### 4. 父仓库更新指针

```bash
git add <5 个子模块路径> .trellis/tasks/<task>
git commit -m "feat(readme): …（子模块指针 + 任务记录）"
gitc push origin master
```

### 5. 三向核对（发版完成的判据）

- [ ] 每个仓库：`git ls-remote origin refs/tags/v0.2.0^{}` 的 SHA == 本地 `HEAD` == 远端分支头。
- [ ] 每个仓库：`GET /repos/CJ-SH/<repo>/releases` 恰好 1 条，`tag_name` 与 `package.json.version` 一致（无「有 tag 无 release」或反向）。
- [ ] 父仓库 gitlink 指向的 commit 等于各子模块的 tag 提交。

## 坑（都踩过）

1. **403 `denied to <另一个账号>`**：本机凭据管理器里的 github.com 条目属于无写权限账号，且它**优先于**命令行注入的 helper——必须先 `-c credential.helper=` 清空。
2. **Release 正文链接分支写错**：默认分支不统一（main / master），链接要按仓库取。
3. **tag 与 release 不同步**：只推 tag 不建 release（或反之）肉眼难查，用第 5 步的三向核对兜底。
4. **版本字样散落**：README/docs 里的 tgz 文件名、示例版本号要跟着版本提交一起改，否则文档说谎。
5. **npm 上并没有这些包**：本族的对外分发是 `dsh plugin --profile web add github:CJ-SH/<repo>`，README 不要写 `add <包名>` 这种未发布的路线。
