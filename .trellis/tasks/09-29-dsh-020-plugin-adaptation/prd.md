# 自建插件适配 dsh 0.2.0-rc.1

> 任务 `09-29-dsh-020-plugin-adaptation`。阶段：**Phase 1 规划（已收敛，待用户批准）**，状态 `planning`，**未激活**。
> 环境：`DSH_HOME=C:\Users\Hasee\.dsh`，profile `web`；装机根
> `D:\Scoop\persist\nvm\nodejs\v24.18.0\node_modules\@deepseek-ai\dsh`（下称 `<U>`，287 个 `@deepseek-ai/*` 包）。
> 观测时间：2026-09-29（dsh 当日 10:15 升级到 **0.2.0-rc.1**）。全部结论带 `file:line` 或实测输出。

## Goal

把四个自建插件从 dsh 0.1.x 契约迁到 **0.2.0-rc.1**，恢复真机可用性，新增一个统一管理 hub，
并把配置界面落到 0.2.0 的官方承载面上，使**下一次 dsh 升级不再静默失效**。

用户价值：升级 dsh ≠ 自建插件集体变砖。当前实际状态是"**测试全绿、三个插件功能已死**"。

## Background：损伤全景（实测）

### B1 健康度总表

| 插件 | 真机状态 | 决定性证据 |
|---|---|---|
| `trellis-statusline` | ✅ **健康** | `conversation.session.header.actions` 活占位者含 `id: trellis-statusline, order: 10, active: true` |
| `ollama-usage` | ❌ 宿主 `apply()` 抛错 | `lib/index.js:586` `ctx.settings.register` 不存在（该行**未被 try/catch 包裹**） |
| `web-search` | ❌ 整条能力死亡 | `web_search` → `"searxng" is registered but unavailable`；`web_fetch` → `"jina" …` |
| `ptc-bash` | ❌ 预设已不可选 | host `Config.listConfigs name=@deepseek-ai/dsh-agent-preset` 只有 `preset-standard/ptc/minimal/cordis`，**无 `preset-ptc-bash`** |

### B2 `ctx.settings` 服务被整体替换（两个插件失能的共同根因）

0.2.0-rc.1 的 `SettingsForms`（`<U>/dsh-settings/lib/types/index.d.ts:62-117`）只暴露
`configure / describe / update / replace / mutate / prepareDocument / writable / documentPath`。
**已删除**：`register(ns, schema)`、`installSection(...)`——后者在整个 0.2.0 装机树命中 **0 次**。
语义也变了：`describe()` 按 **profile entry id** 返回，schema 由该 row 模块导出的 `Config` 派生
（`<U>/cordis/lib/index.js:1631`）；`update(ns, …)` 的 `ns` 是 entry id。

- `web-search/lib/index.js:1090` 调 `installSection` → 抛 `TypeError` → 被 `:1096-1098` 吞掉 →
  `read()` 退回 loader 行 config（该行无 config）→ `available()`（`:336-339`/`:405-408`/`:485-488`）返回 `false`
  → `<U>/dsh-web/lib/index.js:124` 抛 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
  进程内复现输出：`[web-search] settings section unavailable: settingsCtx.settings.installSection is not a function`
- `ollama-usage/lib/index.js:586` 调 `register` → `apply()` 抛错 → row fiber 失败 → `POST /ollama-usage/*` 从未注册
  → 两个用量 pill 永远渲染不出值（`lib/client.js:533` 要求 `phase==='ok'`）。
  非必需启动项的 row 失败**只写 stderr**（`<U>/dsh-app-boot/lib/index.js:3836-3844, :4009-4020`），故 dsh 照常启动——故障无声。

**第二个独立阻塞**：只有 `.volatile()` 字段可被表单读写。`web-search` 的 `Config`（`:600-607`）**无任何 `.volatile()`**
⇒ `describe()` 直接跳过该 entry（`<U>/dsh-settings/lib/index.js:417-419`），`update()` 抛 `has no volatile fields`
（`:502-507`）。嵌套 `providers.<id>.endpoint` 还要求 **dict 节点本身**带 `meta.volatile`
（`isVolatilePath` 只下钻 `schema.dict`，`:153-158`；`validatePaths` `:513-523`）。

**第三个独立阻塞**：座位 `settings.plugin.item` **已删除**（全树仅剩 1 处过时注释
`<U>/dsh-client-ui-settings-models/lib/types/client/slot-contract.d.ts:11`）。
两个插件的配置卡片因此**静默不注册**（`slots.inject` 回调只在座位被声明时才跑，
`<U>/dsh-client-ui-renderer/lib/client.js:1343-1402`；注册未声明座位会抛，
`<U>/dsh-client-ui-slots/lib/types/index.d.ts:762`）。

### B3 `settings.yaml` 被移除，第三方 section 未能迁移

`<U>/dsh-settings/lib/index.js:302-363`：`settings.yaml` 先被 rename 成 `.imported`，再按
`LEGACY_SECTION_ENTRIES`（只映射 `ui-developer-tools`/`ui-onboarding`/`shell`）+ **entry id** 逐段 `update()`；
失败的段**只留在改名后的文件里**。本机 `~/.dsh/settings.yaml` 已不存在，两个插件的值都滞留：
- `settings.yaml.imported` 的 `web-search:` 段：`provider: searxng`、`fetchProvider: jina`、
  `providers.searxng.endpoint = https://searx.747497.xyz/search` + `headers`、
  `providers.jina.endpoint = https://fetch.747497.xyz/` + `headers`。
- 同文件 `ollama-usage:` 段：`baseURL`、`apiKeyEnv: OLLAMA_API_KEY`、`credentialMode`。
旧导入是**一次性且已消耗**，必须手工迁移（R3）。

### B4 ptc-bash：预设发现机制被整体移除

0.2.0-rc.1 **不再从磁盘发现预设**：`discoverPresets` / `SHIPPED_PRESET_ROOT` / 任何 `agent.cordis.yml`、
`preset.yml` 在 287 包 + dsh 核心中命中 **0 次**；`$DSH_HOME/.agent-presets` **无人扫描**
（`~/.dsh/.agent-presets/ptc-bash/` 4 文件仍在磁盘上，被忽略；`liangshen` 同）。

新机制为声明式注册：
- `<U>/dsh-agent-preset/lib/index.js:10-26`：row `static inject = ["agentPresets"]`，
  `Config = { id(必需), name?, description?, order?, plugins(必需数组) }` → `ctx.agentPresets.register(config)`。
- `<U>/dsh-agent-preset-registry/lib/types/index.d.ts:21-127`：`register / list / resolve / compositionInventory`。
- 离线校验只剩 `entryListProblem(rows, at?)`（`definition.d.ts:19`，实现 `definition.js:6-28`）——**只验形状，不解析包名**；
  `AgentPreset.broken?`（`preset.d.ts:4-10`）改为**挂载期**产生（`dsh-agent-preset/lib/index.js:529-544`）。
- 官方 ptc 预设现为 loader patch：`<U>/dsh-web-app/presets/ptc.patch.yml:1-9`（插 `preset-ptc` 行）；
  显示元数据从 `preset.yml` 移入声明 config 键。
- 旧诊断字符串（`names a plugin that cannot be resolved`、`not valid YAML`）已消失，测试正则指向死字符串。

**组合内容零漂移**：ours 35 行 vs 上游 33 行，多出的恰是 `workspace-instructions` 与 `dsh-bash-win`
（本包的价值），**逐行 deep-equal 漂移 0**；27 个行包名全部仍存在。要换的是**交付机制**，不是内容。

**守卫已离线**：`test/composition-health.test.mjs` 4 条权威用例全 skip，真因是 `:75-82` 的
`require.resolve('@deepseek-ai/dsh-agent-presets/package.json')` → `MODULE_NOT_FOUND`
（`:84/:85/:92` 另引用已删包、`lib/types/discovery.js`、`SHIPPED_PRESET_ROOT`）。
skip 文案的"harness missing"是假象：`~/.dsh/profiles/node_modules/@deepseek-ai/` 是升级遗留旧镜像
（249 junction 中 **13 个悬空**，含 `dsh-agent-presets`）。
`tools/derive-preset.mjs:23+:93` 锚点同样失效（`ENOENT`），且行锚点缺失时只打印 `PROBLEMS` 却**仍 exit 0**（`:179-180`），
两处写盘非原子（`:175-176`）。`lib/index.js:87-122` 的 `validateComposition` **不解析包名**——实测对
`@deepseek-ai/dsh-workflow-worker-thread`、`@deepseek-ai/dsh-agent-presets` 都返回 `problems: []`，
即**会把引用已删包的组合写进 `$DSH_HOME`**。

### B5 版本门禁：0.2.0 新增 peer 强制校验，而四个插件全部"无门禁"

`dsh-better-sidebar@0.19.1` 因 peer 指向 `^0.1.5-rc.1` 被**拒绝**（`.../logs/operation-JJbhVm/pnpm.log`）：
> `dsh: installation rejected: Plugin dsh-better-sidebar@0.19.1 is incompatible with dsh 0.2.0-rc.1 …`

契约：`<U>/dsh-plugin-manager/README.md:60-69`；实现 `<U>/dsh-app-boot/lib/index.js:286-313`
（**未声明 peer 则早退、不校验**）。四插件中只有 `web-search` 声明了 peer，且是 `"*"` ⇒ 门禁**放行但静默**。

### B6 官方插件契约（装机自带 skill，权威）

- `<U>/dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md:49-54`：
  `apply(ctx, config)` + 可选 `export const inject` / `export const Config`；**"A plugin that declares `Config` validates the row's `config` at activation."**
- 同目录 `references/practices.md:22`：**"Put tunable values in the plugin's `Config` so users change them in `cordis.patch.yml`; the user's patch layer survives upgrades."**
- `references/practices.md:20`：可选服务放 `inject`，缺该服务时**不激活**而非抛错。
- `references/host-plugin.md:29-45`：显示元数据 = `package.json` `meta` + `locale/<lang>.json` + 顶层 `icon`。
- `references/practices.md:33-37`：只用 `--dsw-alias-*` token；**不得** require 任何 Harness Client 包。

### B7 设置界面的可用座位（本会话 `Slots` inspect 实测）

| 座位 | kind | 契约要点 | 采用 |
|---|---|---|---|
| `settings.section` | list | **navList 本体**：*"Registrant options carry the **nav identity**: `id` (section key), `order` (**nav position**), `label`… Sections render inside the panel content column."* owner props 只有 `{ close }`。本机已 10 条，含 3 条第三方（`dsh-usage`/`dsh-workshop`/`archived-sessions`） | ✅ 插件自身页 + hub 页 |
| 插件自声明子座位 | 任意 | 先例：`settings.section` 的子座位含 `dsh-workshop.panel`（`@linxin666/dsh-client-ui-market` 自建） | ✅ hub 的聚合座位 |
| `plugins.item` | list | *"One **official** plugin… **OCCUPIED by the official settings pages**… a bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead."* 实占 `shell/agent-loop/subagent/web-search` | ❌ 官方保留位 |
| `plugins.row.config` | keyed | key = `<包名>#<行id>`；*"the row on the bundle's page gains a configure control…"*；`keyDomain`: "open… none are taken yet" | ⭕ 保留为免费的第二入口（声明 `Config` 即有） |
| `settings.plugin.item` | — | **已删除** | ❌ |

**配置读写服务**：`ctx.configForms`（客户端 cordis Service，
`<U>/dsh-client-ui-settings/lib/types/client/config-form.d.ts:94-157`）：
- `get<T>(entryId)` → `ConfigForm`（`getSnapshot/subscribe/set/unset/mutate(ops, expectedRevision)`，`:53-89`），
  文档：*"Get the shared form values and write queue for one Host plugin entry."*
- `whileServed(namespaces, register)`，文档：*"A plugin whose page edits a namespace **another plugin owns** registers the page through this, so a deployment that never composed the owner shows no trace of the page."*（`:143-156`）

**hub 探测原语**：`ctx.slots.inject(key, cb)` 契约原文
（`client` Service `slots`）：
> *"Install an effect for each declaration lifetime of a slot. The callback runs synchronously when the declaration already exists; otherwise it runs inside the declaring `register()` call after the declaration is committed. **Collapse disposes the effect and a later declaration runs it again.**"*

⇒ "hub 是否存在" ≡ "hub 的座位是否被声明"，自带双向响应，无需自定义探测服务。
另有 `specDynamic(key)` / `declarationEpoch(key)` / `subscribeDeclaration(key, fn)` 可做一次性同步判断。

### B8 测试全绿但无检出能力（本任务的验收硬约束）

| 插件 | `npm test` | 实际 |
|---|---|---|
| ollama-usage | 44+33+10+6 = **93 全绿** | 宿主 `apply()` 抛错；卡片无座位 |
| ptc-bash | `pass 34 / fail 0 / **skipped 4**` | 4 条**权威守卫**静默跳过 |
| web-search | host 123 + client 32 + card 39 = **194 全绿** | 能力 100% 死亡 |
| trellis-statusline | 77+20 = **97 全绿** | 真机健康（但同样无检出能力） |

**结构性假绿**：`client.test.mjs:71-80` / `card.test.mjs:71` / `hero.test.mjs:75` 把 `slots.inject` 伪造成
**立即回调**（真实语义是"座位被声明后才回调"）；`host.test.mjs:23-45` 的假 settings 服务**自己实现了 `register`**；
`host.test.mjs:279` 断言的是插件自己源码里的字符串。
`web-search/test/host.test.mjs:406` 之所以绿，**仅仅因为假件手写了上游已删的 `installSection`**——这就是本次静默失效的直接成因。

## Requirements

- **R1 恢复可用性**：`web_search` 与 `web_fetch` 真机恢复；`ollama-usage` 的 row 不再抛错、用量 pill 能渲染出值。
- **R2 配置模型迁移**：两个需要配置的插件改为 `apply(ctx, config)` + `export const Config`（叶子字段与
  `providers` **dict 节点**均 `.volatile()`）；配置值存放于 profile patch
  （`~/.dsh/profiles/web/cordis.patch.yml`），删除对 `installSection` / `settings.register` 的一切用法。
- **R3 存量配置迁移**：把 `~/.dsh/settings.yaml.imported` 中 `web-search` 与 `ollama-usage` 两段的值
  手工迁入新载体，并保留原 header/凭据不丢失。
- **R4 配置界面（插件侧）**：两个插件各自注册一条 `settings.section`（独立 navList 条目，order 相邻），
  页面用 `ctx.configForms.get('<自己的 entryId>')` 渲染表单；**同一个 Panel 组件**同时支持挂到 hub。
- **R5 hub 包**：新建第 5 个包 `dsh-plugin-suite`，注册**唯一**一条 `settings.section`（id 建议 `my-plugins`）
  并对外声明一个**聚合子座位**；hub 页面 = 各插件面板聚合 + **全部四个自制插件的状态区**
  （row 是否激活、peer 是否兼容、ptc-bash 预设是否已声明、`searxng`/`jina` 的 `available()`、
  trellis 是否解析到活动任务）。
- **R6 hub 感知与让位**：插件默认注册自己的 navList 条目；同时
  `ctx.slots.inject(HUB_PANEL_SLOT, () => { 撤销自身条目; return ctx.slots.register({name: HUB_PANEL_SLOT, …}, Panel) })`
  —— hub 在则让位，**hub 卸载则自动恢复自身条目**。hub 未装时行为与"没有 hub"完全一致。
- **R7 预设交付机制重做（ptc-bash）**：改为声明式注册——本包激活时读自身
  `presets/ptc-bash/{preset.yml,agent.cordis.yml}` 并调用 `ctx.agentPresets.register({id, name, description, order, plugins})`；
  相对行 `./dsh-bash-win.mjs`、`./workspace-instructions.mjs` 必须发**文件 URL**（registry 按**声明方 loader 的基准**挂载）。
  **废弃** `$DSH_HOME/.agent-presets` 同步路径及 README 中相应声明。
- **R8 守卫恢复（ptc-bash）**：4 条权威用例改为可在 0.2.0 运行（离线 `entryListProblem` 形状校验 +
  一条真实会话级验收），删除指向死字符串的两条正则；`derive-preset.mjs` 换锚点、拒绝写入时**非零退出**、
  两处写盘原子化；`validateComposition` 必须真解析包名或退位给上游 API。
- **R9 版本门禁**：四个插件 + hub 声明 `@deepseek-ai/dsh`（及实际用到的 seam 包）的 `peerDependencies`，
  使不兼容升级**显式拒绝**。
- **R10 元数据与新约定**：补 `meta` / `locale/*.json` / 顶层 `icon`；复核只用 `--dsw-alias-*` token、不 require Client 包。
- **R11 反假绿**：每插件每条关键行为至少 1 条**会因真机失效而变红**的证据；假 `slots.inject` 与假 settings 服务必须改造。
- **R12 spec 回写**：`.trellis/spec/` 增补 0.2.0 契约（settings 迁移 / `Config` + volatile / 座位迁移 /
  `configForms` / 预设声明式注册 / peer 门禁 / legacy `settings.yaml` 导入规则）。

## Acceptance Criteria

- [ ] **AC1** 真机 `web_fetch('https://example.com')` 成功；一次 `web_search` 返回 sources。
- [ ] **AC2** `web-search` 与 `ollama-usage` 的存量配置值（端点/header/凭据引用/baseURL）不丢失，可从各自 navList 页读写。
- [ ] **AC3** 四个插件 + hub 的 row 在 0.2.0-rc.1 上全部激活成功，无 `apply` 抛错、无对已删 API 的调用。
- [ ] **AC4** 新会话的预设选择器里 `ptc-bash` **可见且可选**，用该预设新建会话成功。
- [ ] **AC5** ptc-bash 权威守卫不再 skip，且对"引用已删包的行"**会变红**（负向用例）。
- [ ] **AC6** 四插件 + hub 声明 peer；实测把某插件 range 改成不兼容值后，profile startup 确实拒绝该行。
- [ ] **AC7** hub 的 navList 条目可见，聚合两个配置面板；**全部四个插件**的状态区显示正确
      （含"ptc-bash 预设已声明"这一项）。
- [ ] **AC8** 真机验收 hub 让位：卸载/禁用 hub 后，两个插件各自的 navList 条目**重新出现**且配置可读写；
      重新启用 hub 后两条独立条目消失、内容出现在 hub 内。
- [ ] **AC9** 每插件至少 1 条反假绿断言，且做过**伪证检验**（破坏实现后该断言确实失败）。
- [ ] **AC10** spec 回写完成。

## Out of Scope

- 不改 dsh 装机产物、不提上游 PR。
- 不重建/不调参用户自建的 `searx.747497.xyz` / `fetch.747497.xyz`。
- 不修复第三方插件（`@linxin666/dsh-web-all`、`dsh-better-sidebar`）的兼容性。
- 不处理 `@linxin666/dsh-usage`（`dsh-usage` navList 条目）与 `ollama-usage` 的功能重叠——**记录为后续观察项**。
- 不改本机代理的 fake-ip / `redir-host` 模式。
- 不 commit / push（按 AGENTS.md 需用户明确同意）。

## Key Decisions

- **D1 配置承载面**：插件声明 `Config`（volatile），值存 profile patch；UI 走 `settings.section`。
  **放弃** `settings.plugin.item` / `installSection` / `settings.register`。
- **D2 hub 一并交付**（用户 2026-09-29 选定）：新建 `dsh-plugin-suite`。用户原话：
  "需要配置的插件拥有自己的独立navlist，但是如果检测到有hub，则不再渲染自己的独立navlist，而是由hub内配置"。
- **D3 hub 内容**（用户选定 B）：配置聚合 + **全部四个自制插件的状态**。理由：ptc-bash 无配置却正是本次
  "静默消失"最严重者，纯配置 hub 抓不到它。
- **D4 让位机制**：用 `ctx.slots.inject` 的"声明生命周期"语义做 hub 探测（B7），
  **不**自建探测服务、**不**用 `specDynamic` 做一次性判断后再手工订阅。
- **D5 ptc-bash 交付形态**：包内自注册（读自身 preset 文件 → `ctx.agentPresets.register`），
  而非在 bundle patch 里插 `@deepseek-ai/dsh-agent-preset` 行——保持本包"派生 + 守卫"的既有形态与唯一价值。
- **D6 任务结构**：本任务转为**父任务**，下挂 5 个子任务（每插件一个 + hub 一个），各自可独立验收与归档。
- **D7 两个旧活动任务的处置**：`09-21-web-search-fetch-422` 的 R1/R2/R3 被本任务完全覆盖 → 迁入并归档；
  `09-20-dock-seats-difference` 的结论在 0.2.0 仍成立（B1），其待办 AC7 真机复核改基准到 0.2.0 并在本任务内完成 → 归档。
- **D8 验收纪律**：AC9 的伪证检验强制——本任务的立项理由就是"测试全绿而功能全死"。

## Open Questions

（无阻塞项。所有用户侧决策已由 2026-09-29 的四轮问答解决：D2 / D3 为用户直接选定，
其余为基于实测证据的建议，见 `design.md` / `implement.md`。）

## 实现记录（2026-09-29）

### 已完成

- **`dsh-plugin-web-search`**（宿主 + 客户端两半）
  - 宿主：删除 `settings.installSection` 整块；`Config` 三个字段加 `.volatile()`
    （`provider` / `fetchProvider` / `providers` **dict 节点**，叶子保持非 volatile）；
    新增 `unwrapField()` 兼容"解析后引用"与"纯 JSON"两种取值形状；`read()` 改为读
    `ctx.settings.describe()` 的活文档，失败回退到 `apply` 的 row config。
  - 客户端：座位 `settings.plugin.item` → `settings.section`（id `web-search`, order 160），
    并实现 hub 让位（`plugin-suite.panel`）。
  - 清单：`peerDependencies` 加 `@deepseek-ai/dsh@^0.2.0-rc.1` 并把 `dsh-web` 从 `"*"` 收紧；
    `dsh.client.inject` 的 `ui-settings-plugins` → `ui-settings`；新增 `icon.svg` / `locale/{zh,en}.json`。
  - 测试：host **123 → 131**，client **32 → 40**，card 39；合计 **194 → 210**。
    新增守卫：0.2 对 `Config` 的 volatile 契约（复刻 `volatileForm` / `isVolatilePath`）、
    源码级"不得再出现 `installSection`"、hub 让位三态（无 hub / hub 先加载 / hub 后加载并塌缩）、
    清单的 gated-peer 收紧。**伪证检验各 2 组，均确认变红后恢复。**
- **配置迁移**：`.scratch/migrate-020-config.mjs` 把 `settings.yaml.imported` 的 `web-search`
  （searxng/jina 端点 + header）与 `ollama-usage`（baseURL / credentialMode / apiKeyEnv）写入
  `~/.dsh/profiles/web/cordis.patch.yml` 的受管块。密钥只落 `$DSH_HOME`，未进仓库。
- **`dsh-plugin-suite`（hub，新包）**：宿主只读状态路由 `GET /plugin-suite/status`
  （fence → method → JSON；`web` / `agentPresets` 走**软注入**，缺服务时才报得出"缺"）；
  客户端注册 `settings.section`（id `my-plugins`, order 140）并声明子 list 座位
  `plugin-suite.panel`；页面 = 状态板 + 聚合面板。测试 host 34 + client 24 = **58**，伪证检验通过。
- **spec 回写**：新增 `.trellis/spec/guides/dsh-0.2-plugin-contract.md`（settings 服务替换 /
  volatile 契约 / 座位迁移 / 预设声明式注册 / peer 门禁 / 升级复检清单）；
  旧指南 `dsh-upgrade-derived-assets.md` 标注 SUPERSEDED 并指向新页；guides 索引登记。

### 与批准计划的偏差（均已验证后修订）

1. **`design.md` §2.3 的"卡片用 `ctx.configForms` 读写"未采用**：改为**宿主经
   `ctx.settings.update(rowId, patch)` 写入**。理由：`applyTakeover`（写 home patch 的受管块）
   本来就必须留在宿主，若配置再走客户端 `configForms`，同一次保存会出现两条写路径；
   而宿主侧 `update()` 是官方写入口，其 `write()` 结尾会重跑 `describe()`
   （`dsh-settings/lib/index.js:536`），所以保存响应里的状态已经是新值。
2. **子代理审计给出的 volatile 建议是错的**：它建议"每个叶子 + `providers` dict 节点都打 volatile"，
   但 schemastery 的 `validateVolatileSchema` 明确禁止 volatile 嵌套
   （*"volatile fields require a fixed object path without an enclosing volatile field"*）。
   正确做法是**只打 dict 节点、叶子保持非 volatile**——既是规则要求，也正是
   `isVolatilePath` 在第一个 volatile 祖先处停止所需要的。
3. **新发现：`.volatile()` 会包裹取值**。`apply` 收到的 `config` 是"解析后引用"（须 `.get()`），
   而 `describe().value` 是纯 JSON。原先"直接读 `config.providers[id]`"的写法在 0.2 下必然读到
   `undefined`——这是继 `installSection` 之后**第二个**会让 provider 变成 unavailable 的原因。
4. **真实 bug（由忠实假件抓出）**：`slots.inject` 在座位已声明时**同步**回调，所以
   "先 inject 再注册自身条目"会让两条同时存在。必须**先注册自身条目、再 inject**。
   假件若沿用"立即回调"的旧写法就抓不到它。

### 待完成

- 子任务 D（ptc-bash）、E（trellis-statusline）、C（ollama-usage）由并行子代理实施中，报告待并入。
- **真机验收 AC1 / AC4 / AC7 / AC8 需要重启 dsh**（宿主半边的改动不会被 HMR 重载），
  且会中断当前会话的 Web 服务——由用户决定何时执行。
- 两个旧活动任务的归档（D7）与提交（需用户明确同意）。
