# dsh 0.2 插件契约：从 settings.yaml 到 Config

> **Purpose**: 记录 dsh **0.2.0-rc.1** 相对 0.1.x 的破坏性变更，以及本 workspace 踩中的真实故障。
> 全部结论以**装机产物**为唯一权威：`<U> = <nvm>\node_modules\@deepseek-ai\dsh`，
> 包在 `<U>\node_modules\@deepseek-ai\`。**每次升级 dsh 后按文末清单复检。**

---

## Triggers

- [ ] 升级 dsh 后插件静默失效：测试全绿、真机功能没了
- [ ] `configured web provider "<id>" is registered but unavailable`
- [ ] `Plugin entry "<ns>" has no volatile fields` / 设置页看不到某个插件
- [ ] 预设选择器里少了自建预设
- [ ] 装机日志出现 `incompatible-version`

## 1. `ctx.settings` 被整体替换（最致命）

0.1.x 的 `settings.register(ns, schema)` 与 `installSection(...)` **在 0.2.0-rc.1 已完全不存在**
（全装机树 `installSection` 命中 0 次）。`SettingsForms` 只提供
`configure / describe / update / replace / mutate / prepareDocument / writable / documentPath`
（`dsh-settings/lib/types/index.d.ts`）。

| 概念 | 0.1.x | 0.2.0-rc.1 |
|---|---|---|
| 命名空间 | 插件自持（`register(ns, …)`） | **就是 loader row id**（`describe()` 的 `ns`） |
| schema | 插件自己传 | **就是该 row 模块导出的 `Config`**（`dsh-settings/lib/index.js:539`） |
| 值存放 | `settings.yaml` | **profile patch**（`~/.dsh/profiles/<p>/cordis.patch.yml`） |
| 读 | `describe()` | `describe()`（同名，语义已变） |
| 写 | `update(ns, …)` | `update(ns, patch, expectedRevision?)`，`ns` = row id |

### 1.1 每个可编辑字段必须 `.volatile()`

`describe()` 会**跳过**任何 `volatileForm()` 为 `undefined` 的 entry（`dsh-settings/lib/index.js:417-419`），
`update()` 随后抛 `Plugin entry "<ns>" has no volatile fields`（`:505-507`）。

```js
function volatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema)
  if (schema.type === 'object') { /* 递归 schema.dict 的每个字段 */ }
}
function isVolatilePath(schema, path) {
  if (schema.meta.volatile) return true          // ← 在第一个 volatile 祖先处停止
  const [key, ...rest] = path
  const child = key === undefined ? undefined : schema.dict?.[key]
  return child !== undefined && isVolatilePath(child, rest)
}
```

⇒ **dict/嵌套对象要把标记打在那个节点上**，不是打在叶子上：`providers` 打 volatile 之后
`['providers']` 整条路径即可写，而 `isVolatilePath` 不会继续往下钻。

⇒ **但 volatile 不能嵌套 volatile**：schemastery 的 `validateVolatileSchema` 会抛
*"volatile fields require a fixed object path without an enclosing volatile field"*。
所以 volatile dict 的**叶子必须保持非 volatile**。这是"打节点、不打叶子"的第二个理由。

### 1.2 `.volatile()` 会包裹取值：读要用 `.get()`

schemastery README §"Volatile configuration"：`.volatile()` 把值解析成一个稳定引用，用 `.get()` 读。

| 来源 | 形状 |
|---|---|
| `apply(ctx, config)` 的 `config` | **已解析**，volatile 字段是引用对象 → 必须 `.get()` |
| `settings.describe().value` | **纯 JSON**（`dsh-settings/lib/index.js:436` 走 `plainConfig(...)`） |

⇒ 两处都读的代码要一个**同时容忍两种形状**的取值助手。上游写法见
`dsh-web-search-deepseek/lib/index.js:329-337`（`config.apiKey.get()`）。

### 1.3 `settings.yaml` 已被移除

`dsh-settings/lib/index.js:343-363`：文件先被 rename 成 `settings.yaml.imported`，再逐段
`update(LEGACY_SECTION_ENTRIES[section] ?? section, values)`。映射表只含
`ui-developer-tools` / `ui-onboarding` / `shell`（`:303-308`）。

**第三方 section 只有在名字恰好等于某个 row id 时才会被搬过去**；否则只留在改名后的文件里
（日志仅 `logger.warn`）。本 workspace 的 `web-search` 与 `ollama-usage` 两段就这么滞留了。

⇒ **一次性、不可重复**：`settings.yaml` 已改名即已消耗，迁移必须手工做，且**先声明 `Config`**，
否则 `config:` 写进去也没有 schema 接。

## 1.4 一行 `apply` 抛错是**隔离**的——这才是它危险的原因

实测（0.2.0-rc.1，2026-09-29，真机启动日志）：

```
web boot: 1 entry did not activate
dsh-plugin-web-search: failed
[web-search] settings section unavailable: settingsCtx.settings.installSection is not a function
dsh: warning: 1 entry did not activate
ollama-usage (dsh-plugin-ollama-usage): TypeError: ctx.settings.register is not a function
    at new apply (…/dsh-plugin-ollama-usage/lib/index.js:586:16)
```

⇒ 抛错的 row **被隔离、只被报告**：dsh 照常启动，同一棵树里其他插件全部正常。
本 workspace 旧 spec 写的是"会失败整棵插件树、dsh 无法启动"——**那是错的**。

⇒ 真相更糟：唯一的痕迹是**启动日志**。界面无提示、测试无感知——插件只是死了，而一切看起来正常。
所以：**启动日志属于发布门**；`apply` 里所有可选面都必须 `console.error` 降级，必需面注册不了也要显式喊出来。

## 2. 座位迁移：`settings.plugin.item` 已删除

| 座位 | kind | 用途 | 谁能用 |
|---|---|---|---|
| `settings.section` | list（`id`/`order`/`label`） | **Settings navList 本体**；owner props 只有 `{ close }` | ✅ 任何插件（本机已有第三方先例） |
| 自声明子座位 | 任意 | 先例：`settings.section` 的子座位 `dsh-workshop.panel`（`@linxin666/dsh-client-ui-market/lib/client.js:2457-2470`） | ✅ |
| `plugins.row.config` | keyed `<包名>#<行id>` | 给 bundle 的行配置页；`keyDomain` 开放、无人占用 | ✅ bundle 的正确去处 |
| `plugins.bundle.config` | keyed `<包名>` | 同上，粒度到 bundle | ✅ |
| `plugins.item` | list | 目录原文：*"One **official** plugin… **OCCUPIED by the official settings pages**… a **bundle's configuration belongs in `plugins.bundle.config` or `plugins.row.config` instead**"* | ❌ 官方保留位 |
| `settings.plugin.item` | — | **已删除**（全树仅剩一处过时注释） | ❌ |

声明子座位的写法（照抄先例）：

```js
ctx.slots.inject('settings.section', () =>
  ctx.slots.register({
    name: 'settings.section', id: SECTION_ID, order, label: () => …, locale: NS,
    children: { 'my.panel': { kind: 'list', scope: 'root' } },   // ← 子座位在这里声明
  }, Section))
```

### 2.1 用"座位声明"作为存在性信号

`slots.inject(key, cb)` 的契约：**座位已声明则同步回调**，否则在声明方的 `register()` 内回调；
**塌缩时执行返回的 disposer，之后再声明会再次回调**。

⇒ "某个插件在不在" ≡ "它的座位被声明了没有"，自带双向响应，不需要自建探测服务。

⇒ **顺序陷阱**：因为已声明时是**同步**回调，先 `inject(...)` 再注册自己的备用条目，会让两者**同时存在**。
必须**先注册备用条目，再 `inject`**。这是真实踩中的 bug，已由客户端测试的"hub 先加载"用例固化。

### 2.2 `ctx.configForms`（客户端）

`dsh-client-ui-settings/lib/types/client/config-form.d.ts`：`get<T>(entryId)` → `ConfigForm`
（`getSnapshot/subscribe/set/unset/mutate(ops, expectedRevision?)`），以及
`whileServed(namespaces, register)`——文档原文即为*"A plugin whose page edits a namespace **another plugin owns**"*
设计，所以"跨插件页面"是上游支持的形态，不是 hack。

## 3. 预设不再从磁盘发现

`discoverPresets` / `SHIPPED_PRESET_ROOT` / 任何 `agent.cordis.yml`、`preset.yml` 在 0.2.0-rc.1 中命中 **0 次**；
`$DSH_HOME/.agent-presets` **无人扫描**。

| | 0.1.x | 0.2.0-rc.1 |
|---|---|---|
| 包 | `@deepseek-ai/dsh-agent-presets` | `@deepseek-ai/dsh-agent-preset`（声明）+ `@deepseek-ai/dsh-agent-preset-registry`（服务 `agentPresets`） |
| API | `discoverPresets(roots, harnessBase)` | `ctx.agentPresets.register({id, name?, description?, order?, plugins})`（`register/list/resolve/compositionInventory`） |
| 离线校验 | 逐级包查找 | `entryListProblem(rows, at?)`——**只验形状，不解析包名** |
| `broken?` | 离线扫描产出 | **挂载期**产出 |

- 官方 ptc 预设现在是 loader patch：`dsh-web-app/presets/ptc.patch.yml`（插 `preset-ptc` 行）。
- **相对行（`./x.mjs`）必须发文件 URL**：registry 按**声明方 loader 的基准**挂载。
- 旧的诊断字符串（`names a plugin that cannot be resolved`、`not valid YAML`）**已消失**——
  针对它们的测试正则指向死字符串，是假绿的经典来源。

## 4. 版本门禁：不声明 peer 就静默放行

`dsh-app-boot/lib/index.js:286-313`：**只看 `peerDependencies`，没有该字段直接早退**。
只校验 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`；`includePrerelease: true`；
`workspace:^|~|*` 视为当前运行时。

⇒ **不声明 = 无声通过**，这正是"升级后静默失效"的机制成因。
⇒ **声明了但区间不满足 = 该 row 被拒绝**（日志 `installation rejected` / 启动 `denies it`），
所以区间必须真的匹配运行时。

## 5. 升级后复检清单

- [ ] `dsh --version` 与每个插件 `peerDependencies` 的区间是否相容
- [ ] 每个带 `Config` 的 row：`describe()` 里**在不在**（不在 = 没有 volatile 字段）
- [ ] 每个 row 的 `apply()` 是否抛错——**只写 stderr，界面无提示**
- [ ] 每个 UI 座位：在 client `Slots.listSubTree` 里**还存不存在**；`settings.plugin.item` 就是前车之鉴
- [ ] 自建预设是否出现在 `Config.listConfigs name=@deepseek-ai/dsh-agent-preset` 的名册里
- [ ] 测试是否仍在"假绿"：假件里有没有手写上游已删的方法、有没有把 `slots.inject` 伪造成立即回调

## Rules

- **测试里的假件必须模仿真实契约**。`installSection` 的假件、立即回调的 `slots.inject`，
  让 194 条断言在功能 100% 死亡时保持全绿——这是本类故障唯一真正的成因。
- 每条守卫都要做**伪证检验**：故意破坏被守卫的东西，确认断言变红，再恢复。
- 报告结论时区分"测试通过"与"真机可用"：只有后者算数。
- 配置的**归属**留在插件自己的 `Config`；管理界面只做视图与写入代理，不做托管。
- **注册座位必须包在 `slots.inject` 里**。往**未声明**的座位 `register` 会**抛**
  （`slot "<id>" is not declared`），整个浏览器半边随之失败，界面只显示 `did not activate`。
  这个失败**只在打开页面时出现**，而进程启动、`--dump-config`、宿主 `apply` 全都干净——
  所以"启动正常"不能证明客户端正常。每个客户端半边都该有一条断言：
  **座位全未声明时，`apply` 不得注册任何东西、也不得抛。**
- **一个管理页不要自带取数**。`dsh-plugin-suite` 的状态区曾挂 `GET /plugin-suite/status`
  （路由本身已验证正常、返回正确数据），但它成了整页唯一的失败路径，最终被砍掉。
  聚合页只渲染别人 push 进来的东西时，它就没有可失败的路径。
- **别用 `location.origin ?? '…'` 兜底**：origin 可能是**字符串 `"null"`**，`??` 不会接住，
  `new URL(path, 'null')` 直接抛。要显式判断 `origin !== 'null'`（trellis-statusline 与
  web-search 都这么做）。
- **诊断纪律**：连续几轮基于局部证据推断机制（"`dsh plugin add` 丢包"、"被拒包触发回滚"、
  "`--preserve-symlinks` 解析"）全部是错的，浪费了用户时间。**先把能直接取到的原始输出拿到手
  （启动 stderr、浏览器 Console、路由响应的状态码），再解释**。尤其：
  "在某状态下验证通过"必须先确认那个状态**包含**被测对象——曾在一个已被用户卸载掉问题插件的
  profile 上做冷启动验证，得到的"零错误"毫无意义。
