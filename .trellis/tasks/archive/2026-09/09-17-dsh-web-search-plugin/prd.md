# DSH 自定义 Web Search Provider 插件

> 状态：**planning 收敛完成，待用户批准**。批准后才 `task.py start` 与实现。

## Goal

让用户能在插件配置卡片中**选择并覆盖 DSH 默认的 web search provider**。
本期只提供 **SearxNG** 一个 provider；架构上支持后续添加 provider。

## Background（已确认事实）

调研文档：
[`web-search-mechanism.md`](research/web-search-mechanism.md) ·
[`searxng-api.md`](research/searxng-api.md) ·
[`provider-takeover.md`](research/provider-takeover.md) ·
[`config-surface.md`](research/config-surface.md)

### 架构：三层，本插件只碰最底层

1. **工具层** `@deepseek-ai/dsh-tool-web`：模型可见的 `web_search(queries[])` / `web_fetch(url)`。
   只调 `ctx.web.search()` / `ctx.web.fetch()`，自身不发 HTTP；负责多 query fan-out、去重合并、
   按 `searchMaxResults`（默认 8）截断、`title ?? hostname` 展示回退、错误包装。
2. **接缝层** `@deepseek-ai/dsh-web`（service `ctx.web`）：provider 注册表 + 执行时选择 +
   `maxResults` 强制截断 + `WebError` 错误码。
3. **provider 层**：真正发 HTTP 的地方。**本任务实现的唯一一层。**

### 接缝契约（有规定）

- `WebSearchProvider { id: string; available(): boolean; search(req, signal?): Promise<WebSearchResult> }`
- `WebSearchRequest = { query: string; maxResults?: number }` —— **单 query**
- `WebSearchResult = { content?: string; sources: WebSearchSource[]; truncated: boolean }`
- `WebSearchSource = { url: string; title?: string; snippet?: string; publishedAt?: string }`
- `available()` 必须廉价且**禁止发网络请求**；必须尊重 `signal`
- `truncated` 由 provider 返回 `false`，截断交给接缝
- **wire 层无规定**：HTTP 方法、URL、鉴权、请求/响应体全部是 provider-private

### provider 选择规则（★ 关键约束）

执行时决定、与注册顺序无关：配置了 id → 用它；未配置且**恰好一个**可用 → 自动选中；
**未配置且有多个可用 → `WEB_PROVIDER_AMBIGUOUS`**；配置的 id 未注册 → `WEB_PROVIDER_CONFIGURED_MISSING`。

配置入口：`web` 行的 config `{ searchProvider, fetchProvider }`
（或环境变量 `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER`）。

→ 本插件注册 provider 后会与 `deepseek-official`、`ollama-cloud` 并存，
**必须同时接管选择，否则 `web_search` 直接报 ambiguous。**

### 接管机制（已选定路径 B，已验证）

- provider 选择**只存在于 loader 行配置（patch 平面）**：全安装只有 `dsh-web` 提到 `searchProvider`；
  没有任何插件注册名为 `web` 的设置命名空间；`settings.write()` 拒绝写未注册命名空间
  （`dsh-settings/lib/index.js:443-446`）→ `settings.yaml` 里的 `web: config: {...}` 是**惰性残留**。
- `WebRuntime` 在**构造时**缓存 `searchProviderId`（`dsh-web/lib/index.js:53-58`）→ 改它必须让 `web` 行重建。
- patch 层序（后者覆盖前者）：bundle → profile → **home（`~/.dsh/cordis.patch.yml`，优先级最高）** → `--patch`。
- **patch 整体替换 config**，不是深合并（`dsh-app-boot/lib/index.js:102-105`）→ 必须 restate 两个键。
- **改 patch 文件会热重载**：默认 `patchReload: live`（`dsh-app-boot/lib/index.js:848`），
  profile 与 home 两个 patch 文件都被 HMR 监听（`lib/profile-boot-Dk-7KqJc.js:321-338`），
  entry config 变化触发 `fiber.update()`（`cordis-plugin-loader/lib/index.js:386`）→ `web` 行重建。
  **无需重启。**
- home 文件当前**不存在**，但创建它会 fire watcher 的 `add` 事件 → 首装同样热生效
  （`cordis-plugin-hmr/lib/index.js:59-77,118-141`）。

### SearxNG 契约（已实测）

- 端点：`GET <endpoint>?q=<encodeURIComponent(query)>&format=json`；
  **`format=json` 是硬性必需**（不传返回 `text/html`）；最小参数集就这两项
- **URL 由用户负责**：路由不假定为 `/search`（自部署可能挂任意路径/前缀），插件不做规范化
- 映射：`results[].url`→`url`（可为 null 须跳过）、`title`→`title`（空串省略）、
  `content`→`snippet`（空串省略）、`publishedDate`→`publishedAt`（**无时区 ISO-8601**，原样透传）
- `results[]` 字段**随结果类型变化**（媒体类才有 `audio_src`/`length`/`views` 等）→ 必须容忍缺失；
  `template` 有 `default.html` 与 `videos.html` 混入
- 响应**无 `number_of_results`**；有 `answers[]`（`q=ip` 类查询，字段名 `answer`）、
  `infoboxes[]`、`unresponsive_engines[]`、`suggestions[]`、`corrections[]`
- **鉴权由用户自定义 header 提供**（本机实例是 Cloudflare 前置 + `X-API-Key`）
- **403 有两种且可区分**：CF 的 `Attention Required! | Cloudflare`（key 问题，~4.5 KB）
  vs SearxNG 的 `403 Forbidden`（format 未启用，~213 B）→ 可做精确诊断
- **200 也可能是 HTML**（botdetection 拦截）→ 解析前必须确认响应确为 JSON
- 延迟 0.65–1.03 s，最坏见过 ~3 s → provider 超时 15 s

### 本机现状

- profile：`~/.dsh/profiles/web`；`cordis.patch.yml` 把 `web` 行指向 `searchProvider: ollama-cloud`
- `~/.dsh/settings.yaml:37-42` 的 `web: config:` 段**惰性无效**
- `dsh-base/cordis.patch.yml:437` 定义 `web` 行默认 `{searchProvider: deepseek-official, fetchProvider: http}`，
  并内置 `web-fetch-http`（id `http`）→ **fetch 有内置答案**

## Requirements

- **R1｜交付形态**：可发布插件（独立 git submodule）。**不复刻 `dsh-llm-ollama` 的形态**
  （用户明确否决其设计且将卸载它）；它只作技术参考。
- **R2｜配置入口**：设置 → 配置 → 插件配置。走官方扩展点
  `settings.plugins.tab` → `configurable` → `settings.plugin.item`（以插件设置命名空间为 key）。
- **R3｜provider = 格式适配器**（2026-09-18 转向）：provider 的**身份是它说哪种 wire 格式**，
  不是厂商 —— 与 `llm-pi-ai` 的 `api: 'openai-completions'` + 用户自填 `baseURL` 同构。
  卡片按「兼容 X 格式」显示，端点由用户填。本期实现三个格式：
  | id | kind | 格式 | 目标 URL 位置 |
  |---|---|---|---|
  | `searxng` | search | `GET <端点>?q=…&format=json` | query string |
  | `jina` | fetch | `GET <端点>/<目标URL>` | URL 路径 |
  | `firecrawl` | fetch | `POST <端点>` body `{url,formats:['markdown']}` | JSON body |
  ⚠️ 注册多个 provider 后接缝**无法自动选中** → `searchProvider` 与 `fetchProvider` **必须显式写入**。
- **R3b｜响应宽容回退**：三个格式都额外识别 `content`/`text`/`markdown`/`body`/`data.*` 等
  同义字段；一个可识别字段都没有时**报错并列出实际键名**，便于用户适配自己的服务。
  架构上 provider 以表/注册表形式组织，后续可增。
- **R4｜接管**：保存后把 `- id: web / config: { searchProvider, fetchProvider }`
  **幂等写入 `~/.dsh/cordis.patch.yml`（home 层）**，靠 live reload 热生效。
- **R5｜配置项**：`endpoint`（完整可达 URL，**用户负责路由**，插件不规范化）+ `headers`
  （自定义 header，**用户直接给 JSON 字符串**，解析成 map 并入请求）。
- **R6｜header 字段不标 `role('secret')`**（用户裁定）：JSON 明文存 `settings.yaml`（0600），
  可随 `describe()` 回显 → 卡片可读可增量编辑。
- **R7｜请求只拼 `q` + `format=json`**；其余检索参数交给实例自己的 `settings.yml`。
- **R8｜`fetchProvider` 必须被 restate**（patch 整体替换）：读现有 patch 层取回原值，无则回落内置 `http`。
- **R9｜工程约定**：遵循 `.trellis/spec/dsh-plugin-ollama-usage/frontend/` 的平台契约
  （两半模块形态、`inject` 规则、自有 route + 信任栅栏、`apply` 不得抛、无构建步骤、
  自检 harness 风格、JSDoc + 运行时收窄、零依赖浏览器半身）。

## Acceptance Criteria

- [ ] **AC1** `ctx.web.search()` 能通过 `searxng` provider 返回归一化 `sources[]`
      （`url` 必填；`title`/`snippet`/`publishedAt` 按实测映射；`truncated: false`）。
- [ ] **AC2** 用户在卡片填 `endpoint` + `headers`（JSON）并保存后，**无需重启**，
      下一次 `web_search` 即走 SearxNG（`web` 行被 home patch 接管并热重载）。
- [ ] **AC3** 保存后 `~/.dsh/cordis.patch.yml` 出现哨兵包裹的 `- id: web` 块，
      且**用户原有注释与其它条目一字未改**；重复保存不产生重复块。
- [ ] **AC4** `fetchProvider` 被保留为保存前的有效值（读不到时回落 `http`），
      用户的 fetch 选择不被静默清掉。
- [ ] **AC5** 三类失败给出**可区分**的诊断：CF 403（key 问题）、SearxNG 403（format 未启用）、
      200 + 非 JSON（botdetection / 未启用 json）。
- [ ] **AC6** `headers` JSON 非法时**保存被拒绝**并给出可读原因，不写入半截配置。
- [ ] **AC7** provider 未配置（`endpoint` 为空）时 `available()` 返回 `false`，
      **不干扰**当前可用的 provider，也不触发 `WEB_PROVIDER_AMBIGUOUS`。
- [ ] **AC8** 卸载/还原路径可用：`web_search` 不再因残留的 `searchProvider: searxng` 而报
      `WEB_PROVIDER_CONFIGURED_MISSING`。
- [ ] **AC9** `node --check` 两半通过；`npm test` 全绿；`dsh --profile web --dump-config` 出现本插件行。
- [ ] **AC10** `apply` 在任何可选服务缺失时**不抛**（降级 `console.error`），插件树正常启动。
- [ ] **AC11** provider 的 `search()` **只消费 `query`**（`maxResults` 可忽略、不自行截断），
      且不引入任何不在配置里的 SearxNG 参数（设计见 design §1.1）。
- [ ] **AC12** 抓取侧提供两个**格式适配器**：`兼容 Jina 格式`（`GET <端点>/<目标URL>`）与
      `兼容 Firecrawl 格式`（`POST <端点>` + `{url,formats:['markdown']}`），各自解码其信封。
- [ ] **AC13** 卡片显示的是**格式**标签而非厂商名（`兼容 Jina 格式`），且两个格式都能被选中并
      各自配置端点/header；选中非本插件的 provider 时不出端点字段。
- [ ] **AC14** 一个 200 响应里没有任何可识别文本字段时，报错**列出实际看到的键名**。

## Out of Scope

- 除三个格式之外的**其它**格式（`ADAPTERS` 表与 `providers` dict 已留好扩展点）
- 检索偏好参数（`language` / `categories` / `safesearch` / `time_range` / `engines` / `pageno`）
- `answers[]` / `infoboxes[]` → 接缝 `content` 映射（对齐官方 deepseek/Exa：不映射）
- 请求超时的配置项（用固定常量 15 s）
- 接管的图形化"还原"按钮（先交付文档化的还原说明）

> ~~`WebFetchProvider`~~ —— 已于 2026-09-18 移出 Out of Scope：以 `jina` / `firecrawl`
> 两个格式适配器实现（R3）。

## 已知设计约束（已证据化）

- **不可解析后重序列化 patch 文件**：用户 profile patch 含中文注释 → 必须手术式文本编辑 + 哨兵块。
- **必须处理 `[]` 情形**：模板产出的 patch 文件是注释 + 单行 `[]`，其后追加 `- id: web` 是非法 YAML。
- **无 loader 服务可读当前有效 config**（服务目录里没有 `loader`）→ 只能解析 patch 文件取回 `fetchProvider`。
- **多个 provider 注册后接缝无法自动选中** → 两个选择键必须始终显式写入；这是注册多 adapter 的必然代价。
- **provider 注册表只读枚举**：`ctx.web.searchProviders` / `fetchProviders` 是普通 `Map`（非 `#private`），
  卡片据此列出本部署真正可服务的 provider。**只读、无副作用**，读不到则降级为自由输入。
- **结构化错误码需要 `instanceof HarnessError`**（`dsh-tools/lib/index.js:2515-2518`），
  而 workspace 约定"host 半身不得 import `@deepseek-ai/*`" → 见下方风险 R-1。

## 风险

- **R-1｜host 半身的 `@deepseek-ai/dsh-web` 导入**：要产出结构化错误码（`WEB_PROVIDER_ERROR` 等），
  必须抛 `instanceof HarnessError`；纯 `Error` + `code` 属性**不会**被 `dsh-tools` 识别为结构化错误。
  参考实现 `dsh-llm-ollama` 与官方 `dsh-web-search-deepseek` 都 import `WebError`。
  **建议**：声明 `@deepseek-ai/dsh-web` 为 peerDependency 并 import `WebError`，
  把 workspace 的"零 import"断言放宽为"只允许 `@deepseek-ai/dsh-web`"。**需用户确认。**
- **R-2｜`web` 行重建期间的进行中调用**：预计只影响下一次搜索，需实测（见下）。
- **R-3｜home patch 是机器级、覆盖所有 profile**：会压过用户 profile 层的 `- id: web`，
  可能造成"配置页显示 A、实际是 B"的困惑 → README 必须讲清优先级。

## 待实测验证（不改 MVP 行为）

1. `web` 行重建是否影响**进行中**的 tool call（预期只影响下一次搜索）。
2. `ctx.web` 重建期间 `tool-web` 是否需要配合（预计不需要，它按调用取 `ctx.web`）。
3. home patch 首装创建 → watcher `add` → 热生效的端到端确认。
