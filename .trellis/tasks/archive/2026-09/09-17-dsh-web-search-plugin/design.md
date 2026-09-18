# Design — dsh-plugin-web-search

## 1. 边界与职责

```
┌─────────────────────────────────────────────────────────────────────┐
│ 模型 → @deepseek-ai/dsh-tool-web (web_search / web_fetch)            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ ctx.web.search({query,maxResults}, signal)
┌───────────────────────────▼─────────────────────────────────────────┐
│ @deepseek-ai/dsh-web  (service ctx.web)                             │
│   注册表 + 执行时选择 + maxResults 截断                              │
│   searchProviderId 在【构造时】固化 → 换 provider 必须重建 web 行     │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ registerSearchProvider(provider)
┌───────────────────────────▼─────────────────────────────────────────┐
│ ★ dsh-plugin-web-search （本插件）                                    │
│   host 半身 lib/index.js                                             │
│     · settings 命名空间 web-search（provider 选择 + 各 provider 配置） │
│     · provider 表 PROVIDER_SPECS → 本期只有 searxng                   │
│     · 自有 route /web-search/*（写 patch 接管 + 读状态）               │
│   browser 半身 lib/client.js                                         │
│     · settings.plugin.item 卡片（key = web-search）                   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ 幂等写入（含哨兵块）
                  ~/.dsh/cordis.patch.yml  (home 层, 优先级最高)
                            │ HMR live reload
                  loader 重建 web 行 → 新 searchProviderId
```

**本插件不碰**：工具层、接缝层、其它 provider 的注册、`web_fetch` 的实现、
SearxNG 实例本身的配置。

### 1.1 ★ 入参适配层在哪里（本插件的核心职责边界）

```
① 模型面   web_search({ queries: ["a","b"] })      ← 数组，1..searchMaxQueries(默认 4)
                 ↓ [tool-web] 校验 + 精确去重
② 编排层   单 query → 原样透传
           多 query → 并发 fan-out，【每个都带完整 maxResults】
                    → mergeSearchResults：按 rank 轮转合并 + 按 url 去重 + 总量截到 maxResults
                      失败会 abort 兄弟查询并重抛第一个错误
                 ↓
③ 兼容层   ctx.web.search({ query:"a", maxResults:8 }, signal)
           ★ 就是 @deepseek-ai/dsh-web 这一层，做三件事：
              · provider 选择（执行时、与注册顺序无关）
              · maxResults 结果侧强制截断
              · WebError 错误码
           ✗ 不做参数映射、不做协议翻译、不做字段重命名
                 ↓
④ 我方     searxngProvider.search({ query, maxResults }, signal)
           ★ 入参类型与 ③ 完全相同（同一个 WebSearchRequest）
                 ↓
⑤ wire     GET <endpoint>?q=<encodeURIComponent(query)>&format=json
```

**结论：接缝对 provider 是"原样透传"，参数适配完全落在 provider 里。**
provider 的 `search()` 收到的就是 `ctx.web.search()` 收到的那个 `WebSearchRequest`——
"把接缝入参变成 SearxNG 入参"这件事就是本插件唯一真正的业务逻辑（design §3.3）。

**窄接口的三个后果**：

| # | 后果 | 影响 |
|---|---|---|
| 1 | 只有 `query` + `maxResults` 两个字段可透传 | 模型**无法**要求语言/分类/时间范围/引擎 → SearxNG 额外参数只能是**配置层常量**（Out of Scope 的根因） |
| 2 | `maxResults` 对 SearxNG **无处可传**（它没有条数参数） | provider **不传也不自行截断**；接缝反正会在结果侧截。与官方 deepseek provider 一致 |
| 3 | 反向也不适配：`answers[]`/`infoboxes[]`/`unresponsive_engines[]` 在接缝里**没有容器**（只有 `content` 勉强能装 `answers`） | 这是 Out of Scope 的原因；也说明**将来启用只需改 provider 的映射**，不动任何别处 |

**两个实用细节**（源码实测，`dsh-tool-web/lib/index.js:189-241`）：
- **多 query 时每个查询都带完整 `maxResults`** → 过取后由 merge 截断。所以 provider 不必按
  `maxResults` 精简，一次 HTTP 拿整页更快（SearxNG 无条数参数，精简也要本地做，纯浪费）。
- **单 query 结果原样透传**；多 query 时各 provider 返回的 `content` 会加 `### <query>` 前缀后拼接
  —— 这决定了将来若启用 `answers[]`→`content`，单查直接可见、多查带查询前缀。

## 2. 包结构与命名

```
dsh-plugin-web-search/          ← 独立 git submodule
├── package.json                manifest（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml            loader 行（只 insert 自己）
├── lib/index.js                host 半身（普通 ESM）
├── lib/client.js               browser 半身（module-loader bundle）
├── test/host.test.mjs          伪造 cordis ctx + 服务桩
├── test/client.test.mjs        伪造 window.__ModuleLoader__ + React 桩
├── test/card.test.mjs          最小 hook 运行时
├── README.md / LICENSE / .gitignore
```

| 项 | 取值 |
|---|---|
| 包名 | `dsh-plugin-web-search` |
| loader 行 id / settings 命名空间 / 卡片 key | `web-search` |
| bundle id（`__ModuleLoader__.load({id})`） | `dsh-plugin-web-search`（= 包名） |
| route 前缀 | `/web-search` |
| provider id | `searxng` |
| CSS 类 | `.web-search-*` |

## 3. Host 半身

```js
export const name = 'web-search'
export const inject = ['web', 'settings', 'connection', 'webServer']
export function apply(ctx) { /* 全部注册都在这里 */ }
```

- `inject` 是硬要求：未声明的服务读取会被拒绝（`ctx.settings` 抛错，`ctx.get()` 静默 undefined）。
- `web` 是核心能力，**声明式注入**（不同于 `dsh-llm-ollama` 的 `ctx.get('web')` —— 那里的 web 是可选的）。
- **`apply` 不得抛**：任何可选面缺失都降级为 `console.error` 并让启动继续。
- **只注册自有 route**，不用 `connection.rpc.handle`
  （后者把物理路由挂在 connection 行上，需要改 shipped 行的 `inject`，脆弱）。

### 3.1 settings 命名空间（可扩展的关键）

镜像 `dsh-llm-pi-ai` 已验证的 `z.dict(...)` 形态：

```js
const providerSettings = z.object({
  endpoint: z.string().default(''),   // 完整可达 URL，用户负责路由
  headers: z.string().default(''),    // JSON 字符串，例如 {"X-API-Key":"…"}
})
const Config = z.object({
  provider: z.string().default('searxng'),
  providers: z.dict(providerSettings).default({}),
  fetchProvider: z.string().default(''),  // 空 = 用检测值/内置 http
})
```

**扩展点**：新增 provider = 在 `PROVIDER_SPECS` 加一条 + 卡片加一个选项，
settings schema **不需要改**（`providers` 是 dict）。

```js
const PROVIDER_SPECS = {
  searxng: {
    id: 'searxng',
    labelKey: 'providerSearxng',
    build: (read) => createSearxngProvider(read),   // 读 thunk，每次调用取最新配置
  },
}
```

### 3.2 ★ adapter 表：身份是「格式」，不是「厂商」

> 2026-09-18 转向。原设计把 provider 等同于厂商（"SearxNG provider"），
> 与 `llm-pi-ai` 的既有约定不一致——那里是 `api: 'openai-completions'` + 用户自填 `baseURL`。
> 现在 provider 的身份 = **它说哪种 wire 格式**，任何实现该格式的服务都能接。

```js
export const ADAPTERS = [
  { id: 'searxng',   kind: 'search', labelKey: 'adapterSearxng',   build: createSearxngSearchProvider },
  { id: 'jina',      kind: 'fetch',  labelKey: 'adapterJina',      build: createJinaFetchProvider },
  { id: 'firecrawl', kind: 'fetch',  labelKey: 'adapterFirecrawl', build: createFirecrawlFetchProvider },
]
```

| id | kind | 卡片显示 | 目标 URL 位置 | 信封 |
|---|---|---|---|---|
| `searxng` | search | 兼容 SearxNG 格式 | query string | `results[]` |
| `jina` | fetch | 兼容 Jina 格式 | URL 路径（`<端点>/<目标>`） | `data.{title,url,content,...}`（或 text/plain） |
| `firecrawl` | fetch | 兼容 Firecrawl 格式 | JSON body | `data.{markdown,metadata.sourceURL,metadata.statusCode}` |

**每条 adapter 只做三件事**：拼它那个格式的请求、解码它那个格式的信封、给出可区分的失败诊断。
共享的 `requestJson()` 承担超时/取消/重定向与 401·403·404·429 分类。

- `available()` 在 `endpoint` 为空时返回 `false`，配置用 **thunk** 读取（避免注册时快照）。
- **宽容回退**：格式字段缺失时按 `content`/`text`/`markdown`/`body`/`data.*` 再找一遍
  （"兼容"服务常是近似兼容）；**一个都没有则报错并列出实际键名**（`describeShape`）——
  这是让用户能适配自己服务的唯一线索。
- **加一个格式**：写一个 `build`、往表里加一条、卡片补一个 `labelKey`；
  **schema / patch / 卡片结构都不用改**（`providers` 是按 adapter id 的 dict）。

### 3.2b 多注册的必然代价

同一能力注册多个 provider 后，接缝的"未配置时自动选中唯一可用者"失效
（`http` + `jina` + `firecrawl` 并存 → `WEB_PROVIDER_AMBIGUOUS`）。
所以 **`searchProvider` 与 `fetchProvider` 必须始终显式写入**，卡片不提供"留空"语义。
两者都由接管块 restate —— 这也正是 patch 整体替换 config 所要求的形式。

卡片据 `ctx.web.searchProviders` / `fetchProviders`（普通 `Map`，**只读**）列出本部署真正可服务的
provider，让选择项与运行时一致；读不到则降级为自由输入。

### 3.3 请求与映射

```
GET <endpoint>（用户原样提供，不做任何规范化）
    + (含 '?' ? '&' : '?') + 'q=' + encodeURIComponent(query) + '&format=json'
headers: 解析后的自定义 header map（大小写不敏感剔除保留头）
         + accept: application/json
```

- **URL 规范化 = 不做**（用户负责路由，不能假定 `/search`）。
- 只拼 `q` + `format=json` 两个官方参数。
- `fetch(..., { redirect: 'error', signal: attempt.signal })`。

响应映射（`mapSearxngResponse`）：
| SearxNG | 接缝 | 规则 |
|---|---|---|
| `results[].url` | `url` | 非空字符串才收，否则**整条跳过** |
| `results[].title` | `title` | 空串**省略该键** |
| `results[].content` | `snippet` | 空串省略 |
| `results[].publishedDate` | `publishedAt` | 非空字符串**原样透传**（不加 `Z`） |
| — | `content` | **不映射** `answers[]`/`infoboxes[]`（Out of Scope） |
| — | `truncated` | 恒 `false`，截断交给接缝 |

字段缺失/类型不符一律跳过，**不抛**（媒体类结果字段集不同）。

### 3.4 超时与取消

复用 `dsh-llm-ollama` 的 `requestAttempt` 模式：把调用方 `signal` 与 provider 侧预算
（常量 `REQUEST_TIMEOUT_MS = 15_000`）合并成一个内部 `AbortController`，`timer.unref()`。

### 3.5 错误（可区分诊断）

| 情形 | code | 消息要点 |
|---|---|---|
| 调用方取消 | `WEB_ABORTED` | "SearxNG search aborted" |
| provider 侧超时 | `WEB_PROVIDER_ERROR` | 超时毫秒数 + endpoint |
| 403 且 body 含 Cloudflare 特征 | `WEB_PROVIDER_ERROR` | **"疑似反向代理拒绝（检查自定义 header / API key）"** |
| 403 且 body 含 SearxNG `403 Forbidden` | `WEB_PROVIDER_ERROR` | **"实例未启用 json 输出格式"** |
| 200 但非 JSON | `WEB_PROVIDER_ERROR` | **"实例返回了 HTML，可能未启用 json 或触发 botdetection"** |
| 传输失败 | `WEB_PROVIDER_ERROR` | endpoint + 原因 |
| endpoint 未配置且被选中 | `WEB_PROVIDER_CREDENTIAL_MISSING`（语义最接近）或自定义码 | 指引去卡片填写 |

⚠️ **必须抛 `instanceof HarnessError`** 才能让 `dsh-tools` 产出结构化 `{name,code}` 元数据
（`dsh-tools/lib/index.js:2515-2518`）。见 §7 权衡 T-3。

### 3.6 接管写入（patch 手术式编辑）

**管理块格式**（哨兵注释，幂等锚点）：
```yaml
# >>> dsh-plugin-web-search (managed; do not edit) >>>
- id: web
  config:
    searchProvider: searxng
    fetchProvider: http
# <<< dsh-plugin-web-search <<<
```

**算法**（永不解析后重序列化 → 保住用户全部注释）：
1. 读 `~/.dsh/cordis.patch.yml`；不存在 → 用简短文件头 + 管理块创建。
2. 存在且**含 BEGIN 哨兵** → 替换 `[BEGIN..END]` 整段（幂等）。
3. 存在但无哨兵 → 追加到文件末尾；
   **特例**：若最后一个有效行是裸 `[]`（模板产出的空流序列），替换该行为管理块
   —— 直接在 `[]` 后追加是**非法 YAML**。
4. 写入用 **同目录临时文件 + rename**（原子替换）：避免 watcher 看到半截内容，
   临时文件名的 `add` 事件会被 HMR 的文件名过滤丢弃。

**`fetchProvider` 取值**（patch 整体替换 config，必须 restate）：
1. 扫 profile patch 与 home patch 的 `- id: web` 块，取 `config.fetchProvider`；
2. 取不到 → `'http'`（`dsh-base` 内置）；
3. 卡片把**将要写入的值显示出来**（只读展示 + 可编辑字段），杜绝"静默清掉用户选择"。

### 3.7 Host 自有 route

```js
ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/web-search', handler }),
           'web-search: route')
```
handler 内顺序即契约：**fence → method → media type → endpoint → body**。

| endpoint | 入参 | 返回 |
|---|---|---|
| `state/read` | `{}` | `{ provider, providers, fetchProvider, takeover:{active,path}, detectedFetchProvider }` |
| `config/save` | `{ provider, endpoint, headers, fetchProvider }` | 同 state |
| `takeover/restore` | `{}` | 同 state（删除管理块） |

- 回包恒为 `{ok:true,value}` / `{ok:false,error:{code,message}}`（lowercase-kebab code）。
- 每个答复前先 `connection.requestRejection(req)`；拿不到该 seam 时回 `503`。
- 答复带 `cache-control: no-store`。
- `config/save` 顺序：**先校验 headers JSON** → 再写 settings → 再写 patch → 读回状态。
  校验失败即拒绝，不写半截配置（AC6）。

## 4. Browser 半身

```js
window.__ModuleLoader__.load({
  id: 'dsh-plugin-web-search',
  factory: (require) => { const React = require('react'); /* … */ },
})
```
- 只 require `react`（平台基线）。**不** `inject` `connection`：走自有 route 的裸 `fetch`。
- `inject = ['slots', 'locale']`。
- 注册：`ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'web-search' }, Card))`
  —— `name` 是 slot key，`key` 是自己的 cell 身份，两者不可混。
- 文案 `COPY_ZH` / `COPY_EN` 同 key 集，经 `ctx.locale.register('web-search', …)`。

**卡片内容**：
1. provider 选择控件（本期仅 SearxNG 一项，仍保留控件以便扩展）
2. `endpoint` 文本框（hint：完整可达 URL，含你自己部署的路由；插件只追加 `q` 与 `format=json`）
3. `headers` JSON 文本框（等宽；即时校验反馈；hint 给 `{"X-API-Key":"…"}` 示例）
4. `fetchProvider` 文本框（hint：因 patch 整体替换 config 而必须重述）
5. 状态行：当前是否已接管 + 管理块文件路径
6. 保存 / 丢弃 / 还原

保存成功 → 折叠卡片并刷新状态；失败 → 保持展开、保留草稿、显示原因。

## 5. 数据流（一次"填完即接管"）

```
用户填写 → [浏览器] 校验 JSON → POST /web-search/config/save
   → [host] fence → 校验 → settings.update()（持久化到 settings.yaml）
   → 写 ~/.dsh/cordis.patch.yml 管理块（原子 rename）
   → [HMR] watcher 触发 → loader 更新 entry → fiber.update()
   → [web 行重建] 新 WebRuntime 读到 searchProvider: 'searxng'
   → [下一次 web_search] ctx.web.search() 选中 searxng provider
```
**全程无重启。** 下一次搜索即生效。

## 6. 兼容与迁移

| 场景 | 行为 |
|---|---|
| 与 `dsh-llm-ollama` 并存 | 两个 provider 都注册着；我们的接管把 `searchProvider` 指向 `searxng`。不冲突 |
| 用户卸载 `dsh-llm-ollama` | `fetchProvider: ollama-cloud` 会失效；**卡片显示该值**，用户改为 `http` |
| `settings.yaml` 的惰性 `web: config:` 段 | **不清理**（无害），README 说明它是死数据、可手删 |
| 用户的 profile patch `- id: web` | 被 home 层压过（home 官方语义即"覆盖所有 profile"）→ README 必须讲清优先级 |
| 卸载本插件 | 先 `takeover/restore` 删管理块；README 给手删说明（AC8） |

## 7. 重要权衡

- **T-1｜写 home 层**：优先级最高、机器私有、不进仓库，且当前不存在（首次创建即热生效）。
  代价：**压过用户 profile 层的 `- id: web`**，可能造成"卡片显示 A、实际 B"的困惑 → 用状态行 + README 缓解。
- **T-2｜手术式文本编辑 vs YAML 解析**：解析后重序列化会摧毁用户中文注释（实测确认注释存在）。
  代价：要自己处理 `[]` 特例与缩进，需专门的可重入测试。
- **T-3｜结构化错误码需要 `@deepseek-ai/dsh-web` 导入**：`instanceof HarnessError` 是
  `dsh-tools` 产出结构化元数据的唯一判据；纯 `Error` 不产生 `code`。
  workspace 的"host 半身零 import"约定为此放宽为**只允许 `@deepseek-ai/dsh-web`**（peerDependency）。
  与 `dsh-llm-ollama`、官方 `dsh-web-search-deepseek` 的做法一致。
- **T-4｜provider 选择是配置层而非模型层**：接缝只给 `query`+`maxResults`，
  所以检索偏好只能是固定配置（本期干脆不暴露）。

## 8. 运维与回滚

- **回滚**：删除 `~/.dsh/cordis.patch.yml` 里的管理块（或整文件）→ 下一次 HMR 即恢复到
  原本的 provider 选择。或用卡片的"还原"。
- **风险点**：写 patch 文件是唯一会改动用户文件的动作 → 必须幂等、原子、且只碰管理块。
- **不可逆动作**：无。所有写入都可通过删除管理块回退。
- **观测**：host 半身只在降级时 `console.error('[web-search] …')`；不记录任何 header 值。
