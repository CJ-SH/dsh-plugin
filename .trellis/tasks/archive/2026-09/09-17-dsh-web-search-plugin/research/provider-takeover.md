# Research: "填 URL+key 即自动接管" 的可行性（provider 选择机制）

任务：`09-17-dsh-web-search-plugin`
调研时间：2026-09-17

**问题**：能否让用户在插件配置卡片里只填 SearxNG 的 URL 和 key，就自动接管 DSH 的
搜索 provider，而不必再做 provider 适配 / 手改配置？

---

## 0. 结论

| 问题 | 答案 |
|---|---|
| 能否省掉 provider 适配代码？ | **不能。** DSH 没有通用 HTTP provider，`ctx.web` 只认实现了 `WebSearchProvider` 接口的对象 |
| 能否做到"填完 URL+key 即生效"？ | **能，但必须由插件主动改写"组合平面"的 patch 文件**，不能靠设置 |
| provider 选择存在哪里？ | **只存在 loader 行配置（patch 层）**，且被 `WebRuntime` 在**构造时固化** |
| 改 patch 文件需要重启吗？ | **不需要。** web profile 是 `patchReload: live`，profile 与 home 两个 patch 文件都被 HMR 监听，改完即热重载 `web` 行 |

---

## 1. 三个平面，provider 选择只活在其中一个

```
① 设置平面   ~/.dsh/settings.yaml  (settings document)
   命名空间 = 插件自己 installSection 注册的 ns
   ✗ 不含 provider 选择 —— 见 §2

② 组合平面   loader entry tree = 各层 cordis.patch.yml 叠加
   ✓ provider 选择的唯一来源 —— 见 §3

③ 运行时平面 ctx.web 的 provider 注册表（Map）
   ✗ 只有 4 个公开方法，无法反注册/覆盖别人的 provider —— 见 §4
```

## 2. 设置平面是惰性的（★ 反直觉，但已证）

### 证据 1：只有 `dsh-web` 自己提到 `searchProvider`

在整个 DSH 安装（`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`）里全文检索，只有两个文件命中：
```
dsh-web/lib/index.js
dsh-web/lib/types/index.d.ts
```
→ 没有任何"设置 → provider 选择"的桥接代码。profile 的 node_modules 里也没有社区插件
读写它（已逐个 grep `dsh-better-sidebar` / `dsh-llm-providers-ui` / 三个本地插件 / `@linxin666/*`）。

### 证据 2：没有任何插件注册名为 `web` 的设置命名空间

`settings.register(` 的调用者只有：
`dsh-agent-presets`、`dsh-client-locale`、`dsh-client-ui-chat`、`dsh-client-ui-conversation`、
`dsh-client-ui-settings-general`、`dsh-client-ui-theme`、`dsh-settings`。
`dsh-web` **不使用 settings 服务**，因此不存在 `web` 命名空间。

### 证据 3：设置服务拒绝写入未注册命名空间

`dsh-settings/lib/index.js:443-446`：
```js
write(ns, input, mode, expectedRevision) {
  const registration = this.registrations.get(ns);
  if (registration === void 0) throw new Error(`settings namespace "${ns}" is not registered`);
  ...
```

### 推论 ★

本机 `~/.dsh/settings.yaml:37-42` 里的：
```yaml
web:
  config:
    searchProvider: ollama-cloud
    fetchProvider: ollama-cloud
```
**是惰性数据** —— 没有命名空间认领它，没有代码读它，也无法通过设置 API 写入。
（同段的 `web-search-deepseek: deepseek_search_base_url: ...` 用的是 snake_case，
与 `web-search-deepseek` 插件 schema 的 `baseURL` 不符，同样是手写残留。）

真正生效的是 `profiles/web/cordis.patch.yml` 里那条 `- id: web / config: {...}`。

## 3. 组合平面才是真身，且有热重载（★ 关键发现）

### 3.1 provider 选择在构造时固化

`dsh-web/lib/index.js:53-58`：
```js
searchProviderId;
fetchProviderId;
constructor(ctx, config = {}) {
  super(ctx, "web");
  this.searchProviderId = config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER;
  this.fetchProviderId  = config.fetchProvider  ?? process.env.DSH_WEB_FETCH_PROVIDER;
}
```
→ `search()` **不重新读配置**，用的是构造时缓存的 `searchProviderId`。
→ 改这个值必须让 `web` 行**重新实例化**。

### 3.2 默认行定义

`dsh-base/cordis.patch.yml:437`：
```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
    fetchProvider: http
- id: web-search-deepseek
  name: '@deepseek-ai/dsh-web-search-deepseek'
  config: { apiKeyEnv: DEEPSEEK_API_KEY }
- id: web-fetch-http
  name: '@deepseek-ai/dsh-web-fetch-http'
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
  config: { fetch: true, searchTimeoutMs: 60000 }
```
→ **内置 `http` fetch provider 一直都在**（id 为 `http`）。卸载 `dsh-llm-ollama` 后把
`fetchProvider` 改回 `http` 即可，无需第三方。

### 3.3 patch 是"整体替换 config"，不是深合并

`dsh-app-boot/lib/index.js:102-105`：
```js
for (const [key, value] of Object.entries(overrides)) {
  if (key === "id") continue;
  target[key] = value;      // ← 整个 config 被替换
}
```
`dsh-base/cordis.patch.yml` 顶部注释也明说：
> "A patch replaces the targeted row's whole `config` rather than merging into it"

→ 任何写 `web` 行的 patch **必须同时restate `searchProvider` 和 `fetchProvider`**，
否则漏掉的那个会变回 schema 默认（即"未配置"）。

### 3.4 patch 层叠加顺序（后者覆盖前者）

`lib/profile-boot-Dk-7KqJc.js:212-218` `allPatches()`：
```
bundlePatches   ← 各 bundle 自己的 cordis.patch.yml，按 dsh.profile.bundles 顺序
profile.patches ← ~/.dsh/profiles/web/cordis.patch.yml
homePatches     ← ~/.dsh/cordis.patch.yml   ★ 机器级，优先级高于 profile 层
overlays        ← --patch 指定的文件 + flag 派生 patch
```

> ⚠️ 我们的插件包自带的 patch 属于 **bundlePatches**（最底层），会被 profile 层和 home 层覆盖。

### 3.5 ★ 改 patch 文件会热重载 `web` 行（已完整验证）

**a. 本机 profile 就是 live 模式**：`dsh-app-boot/lib/index.js:848`
```js
const rawPatchReload = manifest.dsh?.profile?.patchReload;
if (rawPatchReload !== void 0 && rawPatchReload !== "live" && rawPatchReload !== "startup") throw new Error(...);
const patchReload = rawPatchReload ?? "live";     // ← 缺省即 live
```
本机 `profiles/web/package.json` 的 `dsh.profile` **没有** `patchReload` 键 → **默认 `"live"`**。
（`PROFILE_TEMPLATES.web.patchReload` 亦为 `"live"`，见 `dsh-app-boot/lib/index.js:333-336`。）

**b. 两个 patch 文件都被监听**：`lib/profile-boot-Dk-7KqJc.js:321-338`
```js
if (composed.profile.patchReload === "live" && ... && ctx.get("loader") !== void 0) {
  if (ctx.get("hmr") === void 0) { ... await ctx.loader.create({ name: "@deepseek-ai/cordis-plugin-hmr", config: { root: [] } }); }
  await watchUserPatches(ctx, { binName: NAME, filename: composed.profile.patchPath, compose: composeLive });
  await watchUserPatches(ctx, { binName: NAME, filename: homePatchPath(),            compose: composeLive });
}
```
→ **profile 的 `cordis.patch.yml` 与 home 的 `~/.dsh/cordis.patch.yml` 都会触发重载。**

**c. 改配置 ⇒ 重新实例化插件**：`cordis-plugin-loader/lib/index.js:386`
```js
if (this.fiber?.uid && (diff.includes("config") || this.options.group)) await this.fiber.update(this.options.config, true);
```
→ entry 的 `config` 变化 ⇒ `fiber.update()` ⇒ `web` 插件被重建 ⇒ **新的 `WebRuntime` 读到新 `searchProviderId`**。

**→ 结论：插件在运行时改写 patch 文件即可完成接管，无需重启、无需用户手动编辑。**

## 4. 运行时平面没有"反注册别人"的正当手段

`ctx.web` 的公开方法只有 4 个（`dsh-tool-cordis` 生成的机器可读服务目录，`lib/index.js:4472+`）：
`registerSearchProvider`、`registerFetchProvider`、`search`、`fetch`。
没有 unregister、没有 setProvider、没有 priority。

服务目录里也**没有 `loader` 服务**（`key: "loader"` 不存在于目录中），
且 `dsh-tool-cordis` 的 README 明确写着它 "does not write repository files, install
dependencies, or change `cordis.yml`" —— 所以也没有程序化改组件的官方 API。

（技术备注：`searchProviders = new Map()` 是**普通属性**而非 `#private`，
所以 `ctx.web.searchProviders.delete('deepseek-official')` 在 JS 层面可行 —— 但这是未文档化
的内部结构，且别人的 provider 可能重新注册，**不建议**。）

## 5. "自动接管" 四条路径对比

| 路径 | 做法 | 自动程度 | 代价 / 风险 |
|---|---|---|---|
| **A. 包内静态 patch** | 插件自带 `cordis.patch.yml` 写 `- id: web / config: {...}` | 安装即生效，但**静态** | 位于 bundlePatches 层，会被 profile/home 层覆盖；用户现有那行 `ollama-cloud` 会赢 |
| **B. 卡片保存时改写 patch 文件** ★ | 保存 URL/key 后，把 `- id: web / config: {searchProvider, fetchProvider}` 幂等写入 `~/.dsh/cordis.patch.yml`（home 层，优先级最高且机器私有） | **全自动、热生效** | 插件要碰用户的配置文件 → 必须做"只增改自己那一条、不动用户其它内容"的幂等处理；文件不存在时能否触发 watcher 需实测 |
| **C. 摸内部 Map** | `ctx.web.searchProviders.delete(...)` 让自动选择只剩自己 | 自动 | 未文档化内部结构，脆弱，静默改变他人行为 —— **不推荐** |
| **D. 禁用其它 provider 行** | patch 里给 `web-search-deepseek` 加 `disabled: true`，则不配置也会自动选中我们 | 一次性声明式 | 破坏性（禁用官方行）；但**语义最干净**，可作为 B 的备选 |

### 重要陷阱：不要只靠"注册 provider"

选择规则里，**未配置且有多个可用 → `WEB_PROVIDER_AMBIGUOUS`**。
本机已注册 `deepseek-official` 与 `ollama-cloud`。我们的 provider 一旦 `available()` 返回 true
而用户没显式配置，`web_search` 会**直接报错**。

反过来，若 `available()` 在未配置 URL 时返回 false，则我们"隐身"，不影响现状；但一旦配置了
URL 就回到 ambiguous 陷阱。**所以"注册 provider"与"解决选择"必须同时做，不能只做前者。**

## 6. 官方卡片扩展点（回答"放哪里"）

`dsh-client-ui-settings-plugins` README（Settings → Plugins → Plugin configuration）：

> "The section declares `settings.plugins.tab` ... The package registers its own `configurable`
> contribution, which declares the nested `settings.plugin.item` slot — keyed on the settings
> namespace a card edits. **A plugin that ships a browser half registers its own card under its
> own namespace and owns every part of it**: chrome, controls, and copy."

关键约束：
- **按"自己的设置命名空间"为 key 注册卡片** → 卡片编辑的是自己的命名空间。这印证了 §2：
  卡片**无法**编辑 `web`（它不是一个被服务的命名空间）。
- **只有 host-plane 插件会出现** —— agent preset 挂载的插件不注册设置命名空间，不会出现在这里。
  我们的插件是 host-plane，符合。
- **卡片需要浏览器半身（`dsh.client`）**，且必须是客户端模块系统的 lazy-CJS factory 格式：
  > "the `clientBundle` preset that emits it lives in `packages/client/tsdown.client.ts` rather
  > than a published package, so a plugin outside this repository has to reproduce that build itself."

  → **仓库外的插件要自己复刻这个构建**。好消息：`dsh-plugin-ollama-usage` 已经在本工作区
  做到了（`lib/client.js` + `dsh.client` 清单），可以直接抄它的构建方式。
- **secret 字段**（`role('secret')`）**走 credentials 域写入，不写设置段**：
  > "A key control starts blank, reports only whether one is configured, and writes through the
  > credentials domain rather than the settings section."
  → 这正好是"只填 URL 和 key"的官方 UX：URL 进设置段，key 进凭证域。

## 7. 路径 B 落地细节（已验证 + 设计约束）

### 7.1 ✅ home patch 文件当前不存在，但创建它会触发重载

实测：`ls ~/.dsh/cordis.patch.yml` → **No such file or directory**。

这不影响热重载，因为 `cordis-plugin-hmr/lib/index.js`：
```js
async function findWatchRoot(filename) {          // :59-77
  let root = dirname(filename); let depth = 0;
  while (true) try { ... return { filename, root: canonicalRoot, depth }; }
  catch (error) { if (error.code !== "ENOENT") throw error;
    const parent = dirname(root); if (parent === root) throw error; root = parent; depth += 1; }
}
async registerConfig(filename, refresh) {         // :118-141
  const target = await findWatchRoot(filename);   // ← 向上找到已存在的祖先目录（~/.dsh）
  const watcher = watch(root, { ..., depth, ignoreInitial: false });
  watcher.on("add", onChange);                    // ★ 文件被"创建"也触发
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);
  const onChange = (path) => { const observed = resolve(path);
    if (observed !== filename && observed !== watchFilename) return;   // 只认这一个文件
    this.refreshConfig(registration, filename, refresh); };
}
```
→ `~/.dsh` 存在 ⇒ root=`~/.dsh`、depth=0 ⇒ **创建 `cordis.patch.yml` 会 fire `add` ⇒ 重载**。✅

### 7.2 ✅ home 层路径与语义

`lib/profile-boot-Dk-7KqJc.js:110-118`：
```js
/** The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load. */
function homePatchPath() { return join(resolveDshHome(), PROFILE_PATCH_FILENAME); }
```
= `$DSH_HOME/cordis.patch.yml`（默认 `~/.dsh/cordis.patch.yml`），**官方定位就是"机器级、覆盖所有 profile"**。

### 7.3 ⚠️ 设计约束：不能解析后重序列化

本机 `~/.dsh/profiles/web/cordis.patch.yml` 含**大量中文注释**（`cat -A` 已确认）。
js-yaml 解析 → 重新序列化会**摧毁用户全部注释**。因此写 patch 文件必须：
- **手术式文本编辑**，只改自己那一个 top-level 列表项；
- 用哨兵注释包裹自己的块，便于幂等增改：
  ```yaml
  # >>> dsh-plugin-searxng (managed block; do not edit) >>>
  - id: web
    config:
      searchProvider: searxng
      fetchProvider: http
  # <<< dsh-plugin-searxng <<<
  ```
- **必须处理 `[]` 情形**：profile 模板产出的文件内容就是注释 + 单行 `[]`。
  在 `[]` 之后追加 `- id: web` 是**非法 YAML**，必须先替换掉那个 `[]`。
  （home 文件当前不存在 → 首次创建无此问题；但用户可能自己按模板建过。）

### 7.4 ⚠️ 未决：patch 会整体替换 `web` 行 config ⇒ 会覆盖用户的 `fetchProvider` 选择

因为 patch 是整体替换（§3.3），写入时**必须**同时给出 `fetchProvider`。
- 硬编码 `http` 会**默默清掉**用户原有的 fetch 选择；
- 想保留就得先读出当前有效值 —— 但**没有 loader 服务**可读（§4）。
- 折中：解析两层 patch 文件找现有的 `- id: web / fetchProvider`，找不到再回落内置 `http`。

### 7.5 剩余待实测项

1. `web` 行重建是否影响**进行中**的 tool call（预期只影响下一次搜索）。
2. `ctx.web` 重建期间 `tool-web` 是否需要配合（预计不需要，它按调用取 `ctx.web`）。
3. 卸载本插件后，home patch 里残留的 `- id: web / searchProvider: searxng` 会让
   `web_search` 报 `WEB_PROVIDER_CONFIGURED_MISSING` —— 需要交付"还原/清理"路径。
