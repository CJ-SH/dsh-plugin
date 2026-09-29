# 技术设计：自建插件适配 dsh 0.2.0-rc.1

> 配套 `prd.md`（需求与验收）。本文件只写**技术设计**：边界、契约、数据流、兼容/迁移、取舍、回滚。
> 所有上游锚点以装机根 `<U> = D:\Scoop\persist\nvm\nodejs\v24.18.0\node_modules\@deepseek-ai\dsh` 为基准。

## 1. 架构与边界

### 1.1 交付物

| # | 包 | 角色 | 本次改动性质 |
|---|---|---|---|
| 1 | `dsh-plugin-web-search` | 能力插件（SearxNG/Jina/Firecrawl provider + 接管 `web` 行） | 配置模型迁移 + 座位迁移 + 恢复可用 |
| 2 | `dsh-plugin-ollama-usage` | 能力插件（Ollama 用量 pill + 配置） | 配置模型迁移 + 座位迁移 + 恢复可用 |
| 3 | `dsh-plugin-ptc-bash` | 预设交付包 | **交付机制重做**（磁盘发现 → 声明式注册）+ 守卫恢复 |
| 4 | `dsh-plugin-trellis-statusline` | 能力插件（会话标题旁状态） | 仅加固：peer / 元数据 / 反假绿 |
| 5 | `dsh-plugin-suite` | **新增**：统一管理 hub | 全新，最小实现 |

### 1.2 层次职责（关键边界）

```
插件自身 Config（Host 侧，schemastery schema, .volatile()）
   │  值持久化于 profile patch：~/.dsh/profiles/web/cordis.patch.yml 的 - id: <row> / config:
   │
   ├─► [路径 A] 官方 Plugins 行页（免费获得：声明 Config 即有）
   │
   ├─► [路径 B] 插件自己的 settings.section 页（独立 navList）
   │        └─ Panel 组件用 ctx.configForms.get('<entryId>') 读写
   │
   └─► [路径 C] hub 的聚合座位（hub 存在时，路径 B 自动撤销）
            └─ 同一个 Panel 组件，同一个 configForms.get('<entryId>')
```

**核心不变量**：配置的**归属**永远在插件自己的 `Config` / 自己的 entryId 上。
hub 与插件页面都只是**视图 + 写入代理**。因此 hub 损坏不会导致配置丢失或不可达（仍可走路径 A 或直接改 patch）。
这是 D2/D3 能成立的前提，也是本设计拒绝"hub 托管配置"的原因。

### 1.3 明确不做

- 不把配置搬进 hub 自己的 Config。
- 不改壳（`dsh-client-ui-*`）、不给上游提 PR。
- 不为 `ptc-bash` / `trellis-statusline` 建配置页（无配置可配，见 prd B1）。

## 2. 契约

### 2.1 Host 半边导出形态

统一为官方形态（`references/host-plugin.md:49-54`）：

```js
export const name = 'dsh-plugin-web-search'
export const inject = ['web', 'connection', 'webServer']   // 注意：不再列 'settings'
export const Config = z.object({ … 全部叶子 .volatile() … })
export function apply(ctx, config) { … }
```

**移除**：`ctx.settings.register(...)`（ollama-usage `lib/index.js:586`）、
`settingsCtx.settings.installSection(...)`（web-search `lib/index.js:1088-1102`）。
**移除** `inject` 里的 `'settings'`（两个插件都不再需要该服务）；仅在确实要读别人的配置时才用
`ctx.inject(['settings'], …)` 软注入。

### 2.2 Config schema 约定

- 每个叶子字段 `.volatile()`；**dict 节点也要 `.volatile()`**——`isVolatilePath` 只下钻 `schema.dict`
  （`<U>/dsh-settings/lib/index.js:153-158`），`providers.<id>.endpoint` 这类嵌套路径否则过不了
  `validatePaths`（`:513-523`）。
- 凭据用 `role('secret')` / `role('credential-ref')`（对照官方
  `<U>/dsh-web-search-deepseek/lib/index.js:276-283`），脱敏由宿主负责（`dsh-settings/lib/index.js:104-110, :440-450`）。
- 无 `Config` 的插件（ptc-bash / trellis-statusline）**不得**凭空声明 Config——否则会在 Plugins 页出现空配置页。

### 2.3 客户端注册契约

**座位**：`settings.section`（list；`id` / `order` / `label`）。owner props 仅 `{ close }`。

**配置读写**：`ctx.configForms.get('<entryId>')` → `ConfigForm`
（`getSnapshot / subscribe / set / unset / mutate(ops, expectedRevision?)`）。
`entryId` = loader row id（web-search 是 `web-search`，ollama-usage 是 `ollama-usage`）。
写入必须带上 `getSnapshot().revision`，否则可能 `SETTINGS_CONFLICT`。

**hub 探测（D4）**：
```js
const HUB_SLOT = 'plugin-suite.panel'      // hub 声明的聚合子座位（list）

// 1) 默认形态：自己的 navList 条目
let own
const mountOwn = () => { if (!own) own = ctx.slots.register({ name: 'settings.section', id: NS, order: ORDER, label }, Panel) }
const dropOwn  = () => { own?.(); own = undefined }

// 2) hub 在 → 让位；hub 卸载 → 恢复
ctx.effect(() => ctx.slots.inject(HUB_SLOT, () => {
  dropOwn()
  const cell = ctx.slots.register({ name: HUB_SLOT, id: NS, order: ORDER, label }, Panel)
  return () => { cell(); mountOwn() }
}))
mountOwn()
```
`slots.inject` 的语义保证收敛：座位已声明则**同步**回调（hub 先加载的情况），
座位后来声明则在 `register()` 内回调（hub 后加载的情况），座位塌缩时执行返回的 disposer 并**恢复**自身条目。
Panel 组件在两个挂载点完全相同，因此"让位"不引入第二套 UI 代码。

### 2.4 hub 契约

- 包名 `dsh-plugin-suite`，navList id `my-plugins`，aggregation slot `plugin-suite.panel`（list）。
- hub 页面 = `renderSlot('plugin-suite.panel')`（各插件面板，按 order）+ 固定"状态"区。
- **hub 不认识任何具体插件**：插件自己 push 面板进来，新增插件无需改 hub。
- 状态区数据来源（只读）：
  - 各插件 row 是否激活 → host `Config.listConfigs name=<pkg>`（或 client 侧对应只读面）；
  - peer 兼容 → profile manifest 的 `peerDependencies` 与运行时版本比对结果；
  - ptc-bash 预设是否已声明 → 预设注册表（`ctx.agentPresets.list()`）里是否存在 `ptc-bash`；
  - `searxng` / `jina` 的 `available()` → 经插件自己的只读端点（`web-search` 已有
    `listRegisteredProviders`，`lib/index.js:638-648`）；
  - trellis 活动任务 → 复用 `trellis-statusline` 已有只读端点。
  状态区**只读**，不提供任何写入动作。

### 2.5 ptc-bash 预设注册契约（D5）

```js
// 激活时：读本包 presets/ptc-bash/{preset.yml, agent.cordis.yml}
// → 解析为行数组 → 相对行 './x.mjs' 转成 file URL（registry 按"声明方 loader 的基准"挂载）
// → ctx.agentPresets.register({ id: 'ptc-bash', name, description, order, plugins })
```
- 依赖 `@deepseek-ai/dsh-agent-preset-registry`（服务 `agentPresets`）；用 `inject` 声明，
  缺该服务的 profile 里**不激活**而非抛错（`practices.md:20`）。
- **删除** `$DSH_HOME/.agent-presets` 同步逻辑（`lib/index.js` 的 sync/validate 路径）与 README 相应声明。
- `id` 冲突时 registry 会抛 `Duplicate agent preset`（`dsh-agent-preset-registry/lib/index.js:502-503`），
  不再有"内置根优先、静默忽略"——失败必须显式可见。

## 3. 数据流与迁移

### 3.1 配置迁移（一次性，手工，不可重复）

旧的 legacy 导入已经消耗（`settings.yaml` 已改名），**必须手工迁移**：

| 来源（`~/.dsh/settings.yaml.imported`） | 目标（`~/.dsh/profiles/web/cordis.patch.yml`） |
|---|---|
| `web-search.provider: searxng`、`fetchProvider: jina` | `- id: web-search` → `config.provider` / `config.fetchProvider` |
| `web-search.providers.searxng.{endpoint,headers}` | `config.providers.searxng.{endpoint,headers}` |
| `web-search.providers.jina.{endpoint,headers}` | `config.providers.jina.{endpoint,headers}` |
| `ollama-usage.{baseURL,apiKeyEnv,credentialMode}` | `- id: ollama-usage` → `config.*` |

注意 `~/.dsh/cordis.patch.yml`（home patch 层）里的受管块 `- id: web`（`searchProvider`/`fetchProvider`）
**仍然有效**（`<U>/dsh-app-boot/lib/index.js:1025-1030` 在 profile patch 之后加载它），
所以"接管默认 provider"的设计不需要改，只需保证 provider 的 `available()` 为真。

header 里含真实 API key：迁移脚本**不得**把 key 写进任何会被 commit 的文件（`.trellis/`、插件仓库都不行）。
key 只应存在于用户级配置（profile patch / credentials）。迁移动作由用户在自己的配置里执行，
或由本任务提供一个只写入 `$DSH_HOME` 的脚本。

### 3.2 配置读取路径（迁移后）

```
apply(ctx, config)  ──►  config 即 profile patch 合并后的行配置（含用户覆盖）
                          │
面板/卡片读值 ───────────► ctx.configForms.get(entryId).getSnapshot()
写值 ────────────────────► .set() / .mutate(ops, revision)
```
插件内部**不再**需要 `read()` thunk + `installSection` 那套"设置源"间接层。

## 4. 兼容性与回滚

### 4.1 兼容性

- **向前**：四个插件将声明 `peerDependencies` 指向 `0.2.0-rc.1` 兼容区间。pnpm 对 `link:` 安装的 peer 解析
  尚未验证（子代理标记 unverified）——**实施前必须先验证**（见 `implement.md` 的前置检查 P1），
  若 `link:` 下 peer 会导致解析失败，则退化为只声明 `@deepseek-ai/dsh` 并接受启动期检查。
- **向后**：不做版本探测、不保留 0.1.x 分支。0.2.0-rc.1 是唯一目标（`latest` 仍是 0.1.7-rc.2，
  `next` 才是 0.2.0-rc.1；用户已升级，故跟 `next`）。
- **让位行为**：hub 缺席时插件行为与"从未有 hub"完全一致——这是 AC8 要真机验证的双向性。

### 4.2 回滚

| 步骤 | 回滚点 |
|---|---|
| 配置迁移 | 迁移前备份 `~/.dsh/profiles/web/cordis.patch.yml`；`settings.yaml.imported` 保持不动（天然备份） |
| 各插件改动 | 每个插件是独立 git 仓库（子模块），子任务粒度的 commit 即可回退 |
| hub 新增 | 禁用 bundle 即回到"无 hub"世界；插件会自动恢复自身 navList 条目 |
| ptc-bash 机制切换 | 保留旧 `presets/` 目录内容不变，只换激活路径 |

**顺序约束**：先做配置迁移（3.1）让能力恢复，再做座位/UI 迁移，最后做 hub。
这样任一阶段中断都不会让工具能力比现在更差。

## 5. 关键取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| hub 托管配置 vs 只做视图 | **只做视图** | hub 托管会把配置变成单点故障，正是本次事故形态；视图方案下 hub 损坏仍可走 Plugins 行页或直接改 patch |
| 每个插件独立 navList vs 只有 hub | **两者都要，条件让位** | 用户选定；且默认形态保证 hub 缺席时仍可用 |
| ptc-bash 包内自注册 vs patch 插声明行 | **包内自注册** | 保持"派生 + 守卫"形态；patch 行方案要求把 35 行 plugins 数组写进 YAML，丢失派生的单一真源 |
| 保留自制 `validateComposition` vs 改用上游 API | **优先上游 `entryListProblem`**，自制守卫退为补充 | 上游只验形状不解析包名，故包名解析仍需自建——但必须真解析，不能像现在这样恒返回空 |
| 声明 peer vs 不声明 | **声明** | 不声明 = 门禁静默放行，正是本次"无声失效"的机制 |

## 6. 风险与未知（实施前必须消除）

| # | 风险 | 处置 |
|---|---|---|
| 1 | `link:` 安装下声明 `@deepseek-ai/dsh` peer 可能被 pnpm 判为无法解析 | 前置检查 P1：在 hub 或任一插件上先试一次，看 `dsh` 启动是否报 `incompatible-version` |
| 2 | `plugins.row.config` 之外的路径 A（官方行页）是否真的自动出现，未经真机确认 | AC3/AC7 真机确认；不成立也不影响 R4/R5（B 路径自足） |
| 3 | hub 聚合座位名与 id 一旦发布即需稳定 | 在 `design.md` 固定为 `plugin-suite.panel` / id 用各插件包名，写入 spec |
| 4 | ptc-bash 相对行转 file URL 后能否真的挂载（子代理标记 unverified） | AC4 真机新建会话验收；这是本任务唯一无法用离线检查替代的验收 |
| 5 | 迁移脚本可能把 API key 带进仓库 | 迁移只写 `$DSH_HOME`；`.gitignore`/提交前 grep 检查 key 前缀 |
| 6 | 0.2.0-rc.1 是 RC，契约可能再变 | spec 记录"以装机 `<U>` 为唯一权威"，并在 R12 写入升级复检清单 |
