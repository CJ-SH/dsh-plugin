# Research: DSH Web Search 运作机制

任务：`09-17-dsh-web-search-plugin`
调研时间：2026-09-17
调研者：HenTaiCJN（AI 协助）

**证据基线**
- DSH 自身代码：`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（`@deepseek-ai/dsh@0.1.5-rc.2` 自带的嵌套 node_modules）
- 运行中的 profile：`C:/Users/Hasee/.dsh/profiles/web/`
- 用户设置：`C:/Users/Hasee/.dsh/settings.yaml`

---

## 0. 结论速览

1. **DSH 的 web search 是可插拔的**，走一个叫 `ctx.web` 的 capability seam（能力接缝）。
   `web_search` 这个模型可见工具**不直接调任何 REST API**，它只调 `ctx.web.search()`。
2. **接缝层有严格规定**：`WebSearchProvider` 接口 + `WebSearchRequest`/`WebSearchResult` 归一化词表。
   **wire 层没有任何规定** —— HTTP 协议、请求体、响应体完全由 provider 自己决定（provider-private）。
   所以自定义插件可以用**任意**搜索后端（自建 SearxNG、Bing、Brave、Tavily、内部网关…），
   只要把结果映射成 `{ url, title?, snippet?, publishedAt? }[]` 即可。
3. **默认 provider 不是通用 REST 调用**，而是 `deepseek-official`：借道 DeepSeek 的
   **Anthropic 兼容 Messages API**，用服务端原生 tool `web_search_20250305` 触发搜索。
   一次搜索 = 一整次模型 turn（贵、慢）。
4. **本机当前并没有用默认 provider**：profile 已把 `ctx.web` 的搜索/抓取都指向
   `ollama-cloud`（社区插件 `dsh-llm-ollama` 注册的）。这就是现成的"自定义 web search 插件"范本。

---

## 1. 三层架构

```
┌──────────────────────────────────────────────────────────────┐
│ 模型看到的工具层   @deepseek-ai/dsh-tool-web                  │
│   web_search(queries: string[]) / web_fetch(url)             │
│   - 合并多 query、去重、按 maxResults 截断                    │
│   - 只管渲染与错误包装，不碰任何 HTTP                          │
└───────────────────────────┬──────────────────────────────────┘
                            │ ctx.web.search(request, signal)
                            │ ctx.web.fetch(request, signal)
┌───────────────────────────▼──────────────────────────────────┐
│ 能力接缝层（service）  @deepseek-ai/dsh-web                    │
│   ctx.web : WebRuntime                                        │
│   - 维护 search/fetch 两个 provider 注册表                     │
│   - 执行时才选 provider（与注册顺序无关）                       │
│   - 强制 maxResults 截断、统一 WebError 错误码                 │
└───────────────────────────┬──────────────────────────────────┘
                            │ registerSearchProvider(provider)
                            │ registerFetchProvider(provider)
┌───────────────────────────▼──────────────────────────────────┐
│ provider 实现层（本任务要写的就是这一层，可多个共存）             │
│   · @deepseek-ai/dsh-web-search-deepseek  id=deepseek-official │
│   · dsh-llm-ollama                        id=ollama-cloud      │
│   · @deepseek-ai/dsh-web-search-exa       id=?（npm 已发布）    │
│   · @deepseek-ai/dsh-web-fetch-http       （默认 fetch）        │
│   · 自定义插件（本任务目标）                                    │
│   wire 格式 = provider 私有，随便定                             │
└──────────────────────────────────────────────────────────────┘
```

关键点：**provider 层可以注册多个**，但 `ctx.web` 一次只会选一个执行（见 §3 选择规则）。

---

## 2. 接缝契约：规定了什么，没规定什么

来源：`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web/lib/types/types.d.ts`

### 2.1 有规定（必须遵守）

```ts
interface WebSearchProvider {
  readonly id: string;                 // 唯一 id，同 capability 内不可重复
  available(): boolean;                // 廉价本地可用性检查；禁止发网络请求
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}

interface WebSearchRequest {
  readonly query: string;              // ★ 一次请求只带一个 query
  readonly maxResults?: number;        // 上界；接缝会再截断一次
}

interface WebSearchResult {
  readonly content?: string;           // 可选：provider 生成的答案/摘要
  readonly sources: readonly WebSearchSource[];
  readonly truncated: boolean;         // 接缝截断时置 true（provider 通常返回 false）
}

interface WebSearchSource {
  readonly url: string;                // ★ 唯一必填字段
  readonly title?: string;             // 展示用；缺省时 tool 层回退到 hostname
  readonly snippet?: string;           // 摘要片段
  readonly publishedAt?: string;       // ISO-8601 字符串
}
```

设计意图（原文注释）：
- `url` 必填、其余可选 —— 因为"不是每个 provider 都返回这些字段，强迫 adapter 编造会让接缝说谎"。
- `content` 可选 —— Exa / DeepSeek 都不返回（于是省略），Perplexity 这类会返回生成答案。
- `maxResults` 是 `dsh-tool-web` 层的上界，**原样透传**给 provider；provider 若其 API 有
  result-count 参数（如 Exa 的 `numResults`）应该主动用上作为成本优化，但接缝无论如何都会再截断。
- `available()` 必须廉价且不发网络 —— 所以"异步取 key"这类检查不能放在这里。

错误类型：`WebError extends HarnessError`，带机器可路由的 open-string `code`。
共享码：`WEB_PROVIDER_UNAVAILABLE` / `_MISSING` / `_AMBIGUOUS` / `_CONFIGURED_MISSING` /
`_CONFIGURED_UNAVAILABLE` / `WEB_ABORTED` / `WEB_PROVIDER_ERROR` / `WEB_DUPLICATE_PROVIDER`。
`code` 是开放字符串，provider 可以自定义（ollama 就定义了 `OLLAMA_WEB_TIMEOUT`、
`OLLAMA_WEB_TRANSPORT`、`OLLAMA_WEB_BAD_REPLY`、`OLLAMA_WEB_MISSING_CREDENTIAL`）。
消费者必须容忍 provider 私有码。

### 2.2 没有规定（provider 自由）

- HTTP 方法、URL 路径、header、鉴权方式
- 请求体 JSON 结构
- 响应体 JSON 结构、字段名
- 结果条数上限、超时、重试策略（provider 自己实现）
- 是否复用 LLM 的 baseURL / credential（provider 自己决定）

> 也就是说：**"API 的格式、请求内容、返回内容"在 DSH 层面没有规定**。
> 唯一被规定的是"归一化后的返回结构"。用户预测"通过 API 调用"是对的，
> 但那个 API 的格式是**由 provider 作者自定**的，DSH 不介入。

### 2.3 fetch 侧（同名接缝）

```ts
interface WebFetchProvider { id; available(); fetch(req: {url}, signal?): Promise<WebFetchResult> }
interface WebFetchResult {
  url: string;                 // 最终 URL（允许的重定向之后）
  statusCode: number;          // 非 2xx 也算 result，不算 error
  body: { kind: 'html'; content: string } | { kind: 'text'; content: string };  // 封闭联合
  truncated: boolean;
}
```
`WebFetchBody` 是**封闭**联合（注释明确写了：新增 kind 是跨包协同变更，不是插件扩展点）。
默认实现是 `@deepseek-ai/dsh-web-fetch-http`（`web-fetch-http`，含 URL 长度上限 2048、
字节/字符双截断、SSRF/重定向处理）。

---

## 3. provider 选择规则（执行时决定，与注册顺序无关）

来源：`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js:34-130`、`dsh-web/lib/types/index.d.ts`

| 场景 | 结果 |
|---|---|
| 配置了 id 且已注册且 `available()` | 用该 provider |
| 配置了 id 但未注册 | `WEB_PROVIDER_CONFIGURED_MISSING` |
| 配置了 id 但 `available()` 为 false | `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 未配置，恰好一个可用 | 自动选中 |
| 未配置，多个可用 | **`WEB_PROVIDER_AMBIGUOUS`** |
| 未配置，零个可用 | `WEB_PROVIDER_UNAVAILABLE` |

配置入口（同一组字段，不是隐藏优先级链）：
- 配置字段：`WebRuntimeConfig.searchProvider` / `.fetchProvider`
- 环境变量：`$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER`

> ⚠️ 对本任务最关键的约束：**我们的自定义插件一旦注册，就与已注册的
> `deepseek-official`、`ollama-cloud` 形成"多 provider 并存"局面。
> 如果用户没有显式配置 `web.config.searchProvider`，就会 `WEB_PROVIDER_AMBIGUOUS` 报错。
> 所以插件落地必须同时改 profile 的 provider 选择配置。**

`registerSearchProvider` 的细节（`dsh-web/lib/index.d.ts`）：
- id 重复 → `WEB_DUPLICATE_PROVIDER`
- 返回 disposer，随调用方 fiber 一起释放（所以插件里要用 `ctx.effect` 管理生命周期）

---

## 4. 默认 provider：`deepseek-official`（web-search-deepseek）

来源：`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-search-deepseek/lib/index.js`、`lib/types/provider.d.ts`、README.md

### 4.1 为什么是这个设计

DeepSeek **没有**专用检索 endpoint。所以它借道 **Anthropic 兼容的 Messages API**，
用服务端原生 tool 触发搜索。注释原话：
> "One search is heavier than a dedicated retrieval endpoint: DeepSeek runs the search inside
> a full model turn, so expect one Messages call's latency and generated tokens per search."

### 4.2 wire 细节（这是"格式规定"的实际答案）

**Endpoint**：`{baseURL}/messages`，默认 `https://api.deepseek.com/anthropic/v1/messages`
（注意 **不是** chat-completions 的 `https://api.deepseek.com`，所以**不复用** `$DEEPSEEK_BASE_URL`，
只用它的 API key。专用环境变量是 `DEEPSEEK_SEARCH_BASE_URL`。）

**Headers**（`lib/index.js:136-143`）：
```
x-api-key: <apiKey>
authorization: Bearer <apiKey>          ← 两个都发
anthropic-version: 2023-06-01
content-type: application/json
accept: application/json
user-agent: deepseek-harness/0.0.1
```
请求 `redirect: 'error'`（拒绝重定向，防止带凭证被劫持）。

**Request body**（`lib/index.js:109-124`）：
```json
{
  "model": "deepseek-v4-flash",
  "max_tokens": 4096,
  "messages": [
    { "role": "user",
      "content": [ { "type": "text",
                     "text": "Perform a web search for the query: <query>" } ] }
  ],
  "tools": [
    { "type": "web_search_20250305", "name": "web_search", "max_uses": 5 }
  ]
}
```
注意：`request.query` 是被**拼接进一句自然语言 prompt**的，不是结构化字段。

**Response 解析**（`mapAnthropicResponse`, `lib/index.js:60-82`）：
```jsonc
{
  "content": [
    { "type": "web_search_tool_result",
      "content": [                        // ← sources 的来源
        { "type": "web_search_result",
          "url": "https://...", "title": "...", "page_age": "..." } ] },
    { "type": "text",
      "text": "模型散文…",
      "citations": [                      // ← snippet 的来源
        { "url": "https://...", "cited_text": "…摘录…" } ] }
  ]
}
```
- `sources[]` ← `web_search_tool_result` blocks 里的 `web_search_result` items
- `snippet` ← **另取** `text` block 的 `citations[].cited_text`，按 URL 关联（首次出现胜出）
  —— 因为 `web_search_result` 本身通常**没有**行内摘要
- `publishedAt` ← `page_age`
- 按 `url` 去重
- **没有 `web_search_tool_result` block 就直接抛 `WEB_PROVIDER_ERROR`**（strict，不降级去爬散文）
- `content` **永远省略**（不信任 provider 散文作为答案）
- `truncated` 永远是 `false`（截断交给接缝）

### 4.3 配置项（`Config`, `lib/index.js:244-252`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKey` | — | 字面 key（不推荐，会进配置文件） |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 凭证引用，**每次搜索重新解析**（轮换 key 下次搜索即生效） |
| `baseURL` | `https://api.deepseek.com/anthropic/v1` | 回落 `$DEEPSEEK_SEARCH_BASE_URL` |
| `model` | `deepseek-v4-flash` | Anthropic 格式模型名 |
| `apiVersion` | `2023-06-01` | header 值 |
| `maxTokens` | `4096` | 正整数 |
| `maxUses` | `5` | 单次请求内服务端搜索次数上限 |

### 4.4 其它设计细节

- 凭证解析优先级：`ctx.credentials` 服务（若挂载）→ 启动进程环境变量 → 配置里的 `apiKey` 字面量。
  缺失 → `WEB_PROVIDER_CREDENTIAL_MISSING`，错误文案会告诉模型引导用户去
  Settings > Plugins > Plugin configuration > Web search 改 Endpoint。
- **请求可观测**：dispatch 前 append 一个 log-only session event
  `web/deepseek-search-llm-request`（含 endpoint、apiVersion、脱敏后的 body，不含 header/凭证）。
- 设置命名空间：`web-search-deepseek`，通过 `ctx.inject(['settings'], …)` 安装
  `settings.installSection`，并用 `setSource` 让 provider **每次搜索读最新配置**
  （而不是注册时快照 —— 否则改配置需要重新注册 provider，用户会看到闪烁）。

---

## 5. 本机实际运行的是什么

`C:/Users/Hasee/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里含 `dsh-llm-ollama`。

`C:/Users/Hasee/.dsh/profiles/web/cordis.patch.yml`：
```yaml
- id: web
  config:
    searchProvider: ollama-cloud
    fetchProvider: ollama-cloud
```

`C:/Users/Hasee/.dsh/settings.yaml:37-42` 是同一份配置的 settings 投影：
```yaml
web:
  config:
    searchProvider: ollama-cloud
    fetchProvider: ollama-cloud
```

**结论：当前 web_search 实际走 Ollama Cloud，不是 DeepSeek。**

---

## 6. `dsh-llm-ollama` 如何把 Ollama web search 接进 DSH（★核心参考）

包：`C:/Users/Hasee/.dsh/profiles/web/node_modules/dsh-llm-ollama`（`dsh-llm-ollama@0.6.23`，社区包，作者 NOirBRight）
源码：`lib/index.js:1345-1513`（provider）、`lib/index.js:1716-1730`（注册）

### 6.1 它做了什么

这是一个**同时做三件事**的"大"插件：LLM 适配器（ollama-cloud 聊天路由）+ 模型发现 +
**web search/fetch provider**。其中 web 部分正好就是我们要做的模式。

### 6.2 注册代码（原文结构，`lib/index.js:1716-1730`）

```js
ctx.effect(() => {
  const web = ctx.get("web");
  if (web === void 0) return () => {};
  const shared = {
    baseURL: () => options().baseURL,          // ← thunk：每次调用读最新配置
    resolveApiKey: storedApiKey,               // ← 复用 LLM 路由的凭证引用
    requestTimeoutMs: options().webRequestTimeoutMs
  };
  const disposeSearch = web.registerSearchProvider(new OllamaWebSearchProvider(shared));
  const disposeFetch  = web.registerFetchProvider(new OllamaWebFetchProvider(shared));
  return () => { disposeSearch(); disposeFetch(); };
}, "llm-ollama: web providers");
```

要点：
- `ctx.get("web")` 而不是静态 `inject: ['web']` —— 因为 web 是**可选**能力，
  插件主职责是 LLM 适配器（`inject = ["llm"]`），不该因为没装 web 就起不来。
- `ctx.effect` 注册 + 返回 disposer —— 随 fiber 释放自动 unregister，避免 id 重复。
- `shared` 里放 **thunk**（`baseURL: () => …`）而不是值 —— 这样用户改设置后**下一次调用即生效**，
  不需要重新注册 provider（重新注册会导致 provider id 闪烁/选择抖动）。

### 6.3 provider 实现（`lib/index.js:1473-1513`）

```js
var OllamaWebSearchProvider = class {
  options;                       // 构造注入的 shared
  id = OLLAMA_WEB_PROVIDER_ID;   // "ollama-cloud"（★ 与 LLM provider id 同名）
  constructor(options) { this.options = options; }
  available() { return URL.canParse(this.options.baseURL()); }   // 廉价、无网络
  async search(request, signal) {
    const { body } = await postJson(this.options, "/web_search", {
      query: request.query,
      ...request.maxResults === void 0 ? {} : { max_results: Math.min(request.maxResults, MAX_SEARCH_RESULTS) }
    }, signal);
    return decodeSearchResponse(body);
  }
};
```

**wire 格式（Ollama Cloud，与 DeepSeek 完全不同）**：
- Endpoint：`{baseURL}/api/web_search`（`POST`）
- Header：`authorization: Bearer <key>`、`content-type`、`accept`、`redirect: 'error'`
- Request：`{ "query": "...", "max_results": N }`（`N ≤ 10`，Ollama 硬上限）
- Response：`{ "results": [ { "url", "title", "content" } ] }`

**映射**（`decodeSearchResponse`, `lib/index.js:1366-1381`）：
```js
function decodeSearchResponse(body) {
  if (!Array.isArray(body.results))
    throw new WebError('ollama-cloud web search answered without a "results" array', "OLLAMA_WEB_BAD_REPLY");
  const sources = [];
  for (const entry of body.results) {
    if (typeof entry !== "object" || entry === null
        || typeof entry.url !== "string" || entry.url.length === 0) continue;   // ← 丢弃无 URL 项
    sources.push({
      url: entry.url,
      ...typeof entry.title   === "string" && entry.title.length   > 0 ? { title:   entry.title }   : {},
      ...typeof entry.content === "string" && entry.content.length > 0 ? { snippet: entry.content } : {}
    });
  }
  return { sources, truncated: false };
}
```

**错误处理与韧性**（值得抄的工程细节）：
- `requestAttempt()` 把**调用方 signal** 与**provider 侧超时预算**（`webRequestTimeoutMs`，默认 15s）
  合并成一个内部 `AbortController`；`timer.unref()` 不阻塞进程退出。
- 自定义错误码：`OLLAMA_WEB_TIMEOUT` / `OLLAMA_WEB_TRANSPORT` / `OLLAMA_WEB_BAD_REPLY` /
  `OLLAMA_WEB_MISSING_CREDENTIAL`；调用方取消 → 共享码 `ABORTED`。
- **只对"响应到达前的瞬时传输失败"重试一次**（`lib/index.js:1462-1472`），
  超时/传输错误且调用方未取消时才重试。
- 非 2xx → 先 `response.body?.cancel()` 再抛（避免连接泄漏）；401/403 附加 "check the API key" 提示。
- 凭证缺失 → `OLLAMA_WEB_MISSING_CREDENTIAL`，文案指向 Plugin configuration 页。
- `fetch` provider 的 request 也是 POST `/api/web_fetch` `{url}`，响应 `{content}`；
  **返回的 `body.kind` 恒为 `'text'`**（Ollama 已抽好正文），`statusCode` 用 HTTP 状态码。

### 6.4 挂载方式

`dsh-llm-ollama/package.json` 里声明：
```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [ ... ] },
  "compatibility": { "dshReleases": { "0.1.5-rc.1": "compatible" } }
}
```
`cordis.patch.yml` 只 insert 一个 loader 行（`id: llm-ollama`），然后由 profile 的
`dsh.profile.bundles` 收录该包。profile 自己的 `cordis.patch.yml` 再覆盖 `web` 行的 config
把 provider 指过去。

---

## 7. 第三个参考：`@deepseek-ai/dsh-web-search-exa`（npm 已发布，最小范式）

版本 `0.0.1-rc.1`，npm 公开。README 自述是"implementation package"：
> "it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not
> register a model-facing tool. … a function/namespace plugin (`inject: ['web']`) that
> registers its backend, not a default-export service."

- Endpoint：`POST {baseURL}/search`，默认 `https://api.exa.ai`
- Config：`apiKey`(`$EXA_API_KEY`)、`baseURL`、`searchType`(auto/keyword/neural)、
  `numResults`(未设则不发)、`highlightsPerResult`(1)
- 映射：`snippet` ← 首个非空 `highlights[]`；**无 highlight 的结果整条丢弃**；
  `publishedAt` ← `publishedDate`；`content` 省略（Exa 不返回生成答案）
- `maxResults` 覆盖配置的 `numResults` 默认值，作为成本优化发给 Exa

**这是"最小可用自定义 provider"的模板**：一个包、一个 provider 类、一个 config schema、
一个 `apply(ctx, config)`。

---

## 8. 模型可见工具层的约束（`dsh-tool-web`）

来源：`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-web/lib/index.js`、`README.md`

Config 默认值：
| 字段 | 默认 | 含义 |
|---|---|---|
| `search` | `true` | 注册 `web_search` |
| `fetch` | `true` | 注册 `web_fetch` |
| `searchMaxResults` | `8` | 单次 `web_search` 返回 source 上界（作为每个 seam 请求的 `maxResults`） |
| `searchMaxQueries` | `4` | 单次 `web_search` 接受的 query 数上界 |
| `searchTimeoutMs` | `30000` | 协作式 tool-call 超时预算 |
| `fetchTimeoutMs` | `30000` | 同上 |
| `fetchMaxOutputChars` | `200000` | 单次 `web_fetch` 输出字符上限 |

行为要点：
- 工具签名是 `queries: string[]`（1..`searchMaxQueries`），**不是单个 query**；
  `runSearchQueries` 会去重后**并发 fan-out** 到 `ctx.web.search()`（每个 seam 请求带 `maxResults`），
  再用 `mergeSearchResults` 合并去重并截断到 `maxResults`。
- 所以 provider 的 `search()` 只需处理**单 query**，多 query 编排在工具层。
- `title ?? hostname(url)` 是展示回退规则。
- 空结果也会正常渲染（依赖 provider 返回空数组，而非抛错）。
- 超时由 `@deepseek-ai/dsh-tool-call-timeout-policy` 强制执行 `ToolDefinition.timeoutMs`，
  并把产生的 signal 转发给 provider —— **provider 必须尊重 `signal`**。

---

## 9. 插件工程约定（本工作区）

现成范本：`dsh-plugin-ollama-usage`（`D:/project/dsh/dsh-plugin/dsh-plugin-ollama-usage`）
- ESM（`"type": "module"`），`main: lib/index.js`，`files` 白名单含 `lib`、`cordis.patch.yml`、`README.md`、`LICENSE`
- `package.json` 的 `dsh.bundle.patch` 指向自己的 `cordis.patch.yml`
- `cordis.patch.yml` 只 `insert` 自己的 loader 行（`- insert: [ { id, name, config? } ]`）
- `engines.node: ^22.19.0 || >=24.0.0`
- 用 `link:` 方式装进 profile（`C:/Users/Hasee/.dsh/profiles/web/package.json` 里
  `"dsh-plugin-ollama-usage": "link:D:/project/dsh/dsh-plugin/dsh-plugin-ollama-usage"`）
- 本仓库把它作为 **git submodule** 管理（`.gitmodules`），每个插件是独立 git 仓库

---

## 10. 对自定义插件的直接启示（约束清单，非设计）

1. **只需实现 `WebSearchProvider`（可能外加 `WebFetchProvider`）**，wire 自定 —— 门槛很低。
2. **必须处理"多 provider 并存"**：注册后若未显式配置 `web.config.searchProvider`，
   会 `WEB_PROVIDER_AMBIGUOUS`。安装说明/补丁里要带上 provider 选择配置。
3. **`id` 必须全局唯一**，且**不可与 `ollama-cloud`/`deepseek-official` 冲突**（重复注册会抛）。
4. **`available()` 必须廉价**：不能异步查凭证存储。想"没有 key 就不可用"只能检查
   "resolver 是否存在"，真正的 key 缺失要在 `search()` 里抛。
5. **必须尊重 `signal`**（工具层超时会 abort）。
6. **不要自己截断**：`truncated` 返回 `false`，交给接缝按 `maxResults` 截断即可
   （若后端支持条数参数则顺手传，作为成本优化）。
7. **配置读取要用 thunk / 每次调用重解析**，不要注册时快照 —— 否则改配置要重启。
8. **生命周期用 `ctx.effect`**，返回 disposer 清理注册。
9. **凭证优先走 `ctx.credentials` seam**（回落进程环境变量 / 字面配置），
   这样 Web 设置页可写；错误码语义化，文案要指引用户去哪里配置。
10. **错误码开放**：可用自定义码，但共享语义（取消/不可用/provider 失败）应尽量用共享码。
11. `redirect: 'error'` 是既有 credentialed provider 的一致做法（防止凭证被重定向泄露）。
12. 单 query 语义 —— 不要试图在 provider 里做多 query 编排。

---

## 11. 待用户决定的问题

1. **搜索后端选谁？**（决定 wire 格式、凭证来源、是否需要付费 key / 自建服务）
2. 是否同时实现 `WebFetchProvider`，还是只做 search？
3. 是否需要 Plugin configuration 设置页（Web UI 卡片，如 `dsh-llm-ollama` 那样），
   还是纯 YAML 配置即可？
4. 分发方式：本仓库 git submodule + `link:`（与现有三个插件一致），还是发 npm / GitHub Release tgz？
