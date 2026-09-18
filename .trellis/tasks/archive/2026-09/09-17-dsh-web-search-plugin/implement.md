# Implement — dsh-plugin-web-search

> **实施状态（2026-09-17）**：阶段 0–5、7.1 已完成；`node --check` 两半通过；
> `npm test` 三套 harness **125/125** 全绿。**阶段 6（安装与端到端）待用户执行**
> —— 安装需重启 dsh，会结束 agent 自己的进程。
>
> 实施中发现并已处理的两件事：
> 1. **`link:` 安装的插件无法 import `@deepseek-ai/*`**（Node realpath 到真实路径，父级查找够不到安装闭包）。
>    已交付 `tools/link-imports.mjs` 把两个 peer 链到 `$DSH_HOME/profiles/node_modules` 的同一份物理文件，
>    保住 `instanceof HarnessError`。该事实已回写 `.trellis/spec/.../plugin-anatomy.md`。
> 2. 自检抓到 `ctx.inject` 自身抛错时 `apply` 会冒泡（违反 AC10）→ 两个 `inject` 调用均已包裹。
>
> 阶段 7.2（spec 回写）已完成本条模块解析事实；其余平台事实（home patch 语义、live reload 链路）
> 已记录在任务 `research/` 中，是否提升进 spec 待定。
>
> 前置：先批准最终的 planning summary，再 `task.py start`。
> 编码前读 `.trellis/spec/dsh-plugin-ollama-usage/frontend/`（平台契约）。
> 参考实现：`dsh-plugin-ollama-usage`（包结构/两半/自检）、
> `dsh-llm-ollama` 的 `lib/index.js:1345-1513`（provider 工程细节）。

---

## 阶段 0：脚手架（不含业务逻辑）

- [ ] 0.1 在 meta-repo 建独立 git 仓库 `dsh-plugin-web-search/`，注册为 submodule
      （对齐 `.gitmodules` 现有三条）。
- [ ] 0.2 `package.json`：`type: module`、`main: lib/index.js`、`exports` 含 `./client`、
      `dsh.bundle.patch`、`dsh.client.{platform:'web',inject:[…]}`、
      **`peerDependencies: { '@deepseek-ai/dsh-web': '*' }`**（见 design §7 T-3）、
      `engines.node: ^22.19.0 || >=24.0.0`、`scripts.test` 串起三个 harness。
- [ ] 0.3 `cordis.patch.yml`：只 `insert` 一行 `- id: web-search / name: 'dsh-plugin-web-search'`。
      **不触碰任何 shipped 行**（自有 route 不需要改 connection 行的 inject）。
- [ ] 0.4 `.gitignore`（`node_modules/`、`*.log`）、`LICENSE`。
- [ ] 0.5 骨架 `lib/index.js`：`name` / `inject` / 不抛的 `apply`。
      **验证**：`node --check lib/index.js`。

## 阶段 1：SearxNG provider（纯函数优先，先可单测）

- [ ] 1.1 `buildRequestUrl(endpoint, query)`：用户 URL 原样 + `?`/`&` + `q=` + `format=json`。
      **不做任何规范化**（不补 `/search`、不去尾斜杠）。
- [ ] 1.2 `parseHeaders(json)`：JSON 解析 + 校验（必须是对象；键值必须是字符串）。
      非法 → 返回可读原因（用于 AC6 与保存拒绝）。
- [ ] 1.3 `sanitizeHeaders(map)`：大小写不敏感剔除保留头（`content-type`/`content-length`/
      `host`/`accept` 等），对齐 `dsh-llm-pi-ai` 的 `requestHeaders` 做法。
- [ ] 1.4 `mapSearxngResponse(body)`：按 design §3.3 映射；容忍字段缺失；
      `url` 缺失/空 → 跳过；`truncated: false`。
- [ ] 1.5 `requestAttempt(signal, timeoutMs)`：合并调用方 signal + 15 s 预算，`timer.unref()`。
- [ ] 1.6 `classifyHttpFailure(status, contentType, bodyText)`：三类可区分诊断（AC5）。
- [ ] 1.7 `createSearxngProvider(read)`：`available()` + `search()`，抛 `WebError`。
- [ ] 1.8 **验证**：`node --check lib/index.js`；`test/host.test.mjs` 覆盖 1.1–1.6。

## 阶段 2：settings 命名空间 + provider 注册

- [ ] 2.1 `Config` schema（`z.dict(providerSettings)` 形态，镜像 `dsh-llm-pi-ai` 的
      `providers: z.dict(profile).default({})` 先例）。
- [ ] 2.2 `PROVIDER_SPECS` 表 + thunk 读取，`ctx.settings.register(...)`（**直接放 apply，不包 ctx.effect**）。
- [ ] 2.3 `ctx.web.registerSearchProvider(spec.build(read))`（**返回 disposer → 包 `ctx.effect`**）。
      id 冲突时降级 `console.error`，不抛。
- [ ] 2.4 **验证**：`ctx.web.search()` 在 endpoint 空时 `available()===false`（AC7）。

## 阶段 3：patch 接管（最高风险，先写测试）

- [ ] 3.1 `readPatchFile()` / `upsertManagedBlock(text, block)` / `removeManagedBlock(text)`。
      必须覆盖：空文件、仅注释、仅 `[]`、已有条目、已含管理块、重复保存幂等（AC3）。
- [ ] 3.2 `detectFetchProvider(profilePatch, homePatch)`：扫 `- id: web` 块取 `config.fetchProvider`，
      取不到回落 `'http'`（AC4）。
- [ ] 3.3 `writePatchAtomic(path, text)`：同目录临时文件 + rename。
- [ ] 3.4 与 `config/save` 串联；`takeover/restore` 删除管理块。
- [ ] 3.5 **验证**：`test/host.test.mjs` 断言"用户注释与其它条目一字未改"（AC3）。
      **手工验证**（用一次性临时 HOME，别碰真实 `~/.dsh`）。

## 阶段 4：Host route

- [ ] 4.1 `ctx.effect(() => ctx.webServer.register({kind:'prefix',path:'/web-search',handler}), label)`。
- [ ] 4.2 handler 顺序：fence（`connection.requestRejection`）→ method → media type → endpoint → body；
      缺 `connection` → `503`；未知 endpoint → `404 unknown-endpoint`；答复 `no-store`。
- [ ] 4.3 三个 endpoint：`state/read` / `config/save` / `takeover/restore`。
- [ ] 4.4 **验证**：`node --check`；`test/host.test.mjs` 断言回包形状与状态码；
      无浏览器时用 `POST /web-search/state/read` 探测（需浏览器 session cookie）。

## 阶段 5：Browser 卡片

- [ ] 5.1 bundle wrapper：`window.__ModuleLoader__.load({id:'dsh-plugin-web-search', factory})`，
      只 `require('react')`，`exports.apply` / `exports.inject`。
- [ ] 5.2 `ctx.slots.inject('settings.plugin.item', …)` + `register({name:'settings.plugin.item', key:'web-search'})`。
- [ ] 5.3 卡片 UI：provider 选择 / endpoint / headers JSON（即时校验）/ fetchProvider /
      接管状态行 / 保存·丢弃·还原。
- [ ] 5.4 `COPY_ZH`/`COPY_EN` 同 key 集 + `ctx.locale.register`。
- [ ] 5.5 **验证**：`node --check lib/client.js`；`test/client.test.mjs` 断言
      bundle id == 包名、只 require react、slot name 与 cell key、**跨半身常量一致**
      （route 前缀 / endpoint 名 / 命名空间）；`test/card.test.mjs` 断言卡片脱离 loading 态。

## 阶段 6：安装与端到端

- [ ] 6.1 `dsh plugin --profile web add <dir>`（**重启 dsh 会结束 agent 自己的进程 → 交给用户**）。
- [ ] 6.2 `dsh --profile web --dump-config` → 出现 `- id: web-search` 行。
- [ ] 6.3 用户在 设置 → 配置 → 插件配置 里填 endpoint + headers 并保存。
- [ ] 6.4 验证 AC2：**不重启**，下一次 `web_search` 走 SearxNG；
      查 `~/.dsh/cordis.patch.yml` 有管理块。
- [ ] 6.5 验证 AC3：该文件里用户原有注释与其它条目未变。
- [ ] 6.6 验证 AC5：临时把 header 值改错 → 卡片保存后搜索应给出"疑似反代拒绝"而非笼统 403。
- [ ] 6.7 验证 AC8：`takeover/restore` 后 `web_search` 回落到原 provider，不报
      `WEB_PROVIDER_CONFIGURED_MISSING`。

## 阶段 7：文档与收尾

- [ ] 7.1 `README.md`：用户面（座位/端点/配置项）、**home 层优先级说明**、
      惰性 `settings.yaml web:` 段的解释、**还原与卸载顺序**、
      `fetchProvider` 为何必须重述。
- [ ] 7.2 把本次学到的平台事实回写 `.trellis/spec/`（新 package 的 layer 或补进现有 layer）：
      home patch 层语义、live reload 链路、patch 整体替换、两种 403 可区分。
- [ ] 7.3 收尾 `.scratch/`。

---

## 验证命令

| 命令 | 证明 |
|---|---|
| `node --check lib/index.js && node --check lib/client.js` | 两半可解析（长片段落盘前必做） |
| `npm test` | 三套 harness 全绿 |
| `dsh --profile web --dump-config` | loader 行已合并 |
| `dsh plugin --profile web add <dir>` | 安装（需用户执行，因为要重启） |
| `POST /web-search/state/read`（带浏览器 cookie） | route 存活，无浏览器也能验 |
| 真实 `web_search` 调用 | 端到端接管生效 |

## 高风险文件 / 回滚点

| 风险 | 说明 | 回滚 |
|---|---|---|
| `~/.dsh/cordis.patch.yml` | 唯一会改用户文件的动作；写错会破坏组合 | 删管理块或整个文件；HMR 即时恢复 |
| `lib/index.js` 的 `apply` | 抛错会让**整棵插件树**启动失败 | `apply` 内全部 try/降级；先在临时 profile 试 |
| `~/.dsh/settings.yaml` | `config/save` 会写自己的命名空间段 | `settings.replace({})` 或手删该段 |
| profile 的 `cordis.patch.yml` | **本插件不写它**；只读它来探测 `fetchProvider` | — |

## `task.py start` 前的复检

- [ ] `prd.md` / `design.md` / `implement.md` 三者一致（无相互矛盾的取值）
- [ ] 用户已**明确批准**最终 planning summary
- [ ] 用户已就 design §7 **T-3**（host 半身允许 import `@deepseek-ai/dsh-web`）表态
- [ ] 用户已就 design §7 **T-1**（写 home 层会压过 profile 层）知情
- [ ] 编码前加载 `trellis-before-dev` 以注入对应 spec
