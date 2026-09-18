# Research: SearxNG 作为 `ctx.web` 搜索后端的契约

任务：`09-17-dsh-web-search-plugin`
调研时间：2026-09-17

**证据来源**
- 官方文档：<https://docs.searxng.org/dev/search_api.html>（原始 rst：`docs/dev/search_api.rst`）
- 默认配置：`searx/settings.yml`（master）
- JSON 序列化实现：`searx/webutils.py:161` `get_json_response()`、`searx/result_types/_base.py:258/368`
- 实测：探测 8 个公共实例（见 §6）

---

## 1. 端点与方法

```
GET  /             GET  /search
POST /             POST /search
```

- **GET**：参数走 URL query
- **POST**：参数走 **`application/x-www-form-urlencoded` 表单**（⚠️ 不是 JSON body）

自建实例建议用 **GET**（最简单，且 `ctx.web` 层没有超长 query 问题）；
POST 只在 query 极长或需要对 URL 做日志脱敏时才有价值。

## 2. 请求参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `q` | ✅ | 查询串。SearxNG 会透传给各引擎，因此支持各引擎语法（如 `site:github.com`） |
| `format` | | **`json` / `csv` / `rss` 默认关闭**，必须在 `settings.yml` 的 `search.formats` 里启用；**请求未启用的 format → `403 Forbidden`** |
| `categories` | | 逗号分隔的类别（general / images / news / …） |
| `language` | | 语言码，默认取 `search.default_lang`（默认 `"auto"`） |
| `pageno` | | 页码，默认 `1` |
| `time_range` | | `day` / `month` / `year` |
| `safesearch` | | `0` / `1` / `2`，默认取 `search.safe_search`（默认 `0`） |
| `theme` | | 仅 `simple` |

> ⚠️ **SearxNG 没有 `max_results` / `limit` / `numResults` 参数** —— 与 Exa/Ollama 不同。
> 只能拿整页结果再由接缝按 `maxResults` 截断（见 §5）。

## 3. 响应结构（get_json_response，master 实测源码）

顶层：
```jsonc
{
  "query": "…",
  "results": [ /* MainResult… */ ],
  "answers":   [ /* 直答，如 wikipedia/计算器 */ ],
  "corrections": [],
  "infoboxes": [],
  "suggestions": [],
  "unresponsive_engines": [ [engine, reason], … ]
}
```

> ⚠️ **master 版本没有 `number_of_results` 字段**（旧版有，已移除）。不要依赖它。

`results[]` 每项 = `Result` + `MainResult` 的全部 struct 字段
（`as_dict()` 直接返回 `{f: getattr(self, f) for f in self.__struct_fields__}`）：

| 字段 | 类型 | 映射到接缝 |
|---|---|---|
| `url` | `str \| None` | → `url`（⚠️ **可为 null，必须跳过**） |
| `title` | `str`（默认 `""`） | → `title`（空串时省略，让 tool 层回退 hostname） |
| `content` | `str`（默认 `""`） | → `snippet`（空串时省略） |
| `publishedDate` | `datetime \| None` | → `publishedAt`（`JSONEncoder` 转 `isoformat()`，见 `webutils.py:151-153`） |
| `pubdate` | `str` | 旧字段，忽略 |
| `engine` / `engines` | `str` / `set[str]`→list | 未使用 |
| `parsed_url` | ParseResult → JSON 数组 | 未使用 |
| `template` | `str`（如 `default.html`） | 可用于过滤非网页类结果 |
| `score` / `positions` / `category` / `priority` | | 未使用 |
| `img_src` / `thumbnail` / `iframe_src` / `audio_src` / `length` / `views` / `author` / `metadata` | | 未使用 |

> ⚠️ **`publishedDate` 的 JSON 形态**：源码里 `datetime → o.isoformat()`（`webutils.py:151-153`），
> 所以是 ISO-8601 字符串或无该键/null —— 正好符合接缝 `publishedAt` 的 "provider-supplied
> ISO-8601 string" 要求。

> ⚠️ **`results` 里可能混有非普通网页结果**（video/file 等模板）。它们一般仍有
> `url`/`title`/`content`，直接映射即可；如需严格可加 `template === 'default.html'` 过滤。

### 可选的增值映射

`answers[]`（SearxNG 的直答，例如 `ip`、计算、wikipedia 摘要）**可以映射到接缝的
`content` 字段** —— 接缝对该字段的定义是 "Optional provider-generated answer text, search
context, or summary"，而官方 deepseek provider 明确不用它、Exa 也不返回。
这是 SearxNG 相对其它后端的一个**免费增值点**（待决策，见 PRD Open Questions）。

## 4. 关键部署前提 ★

`searx/settings.yml` 默认：
```yaml
search:
  formats:
  - html          # ← 只有 html！json 未启用
server:
  limiter: false  # 默认关闭；启用需要 Valkey 数据库
  public_instance: false
```

所以自建实例必须显式加 `json`：
```yaml
search:
  formats:
    - html
    - json
```
否则 `?format=json` 返回 **403 Forbidden**（官方文档原文："Requesting an unset format will
return a 403 Forbidden error"）。

## 5. `maxResults` 的处理

SearxNG 无条数参数，因此：
- **不要试图在 provider 里翻页凑数** —— 一次 GET 拿到整页即可
- 返回全部 `sources`，`truncated: false`，由 `ctx.web` 接缝按 `maxResults` 截断
  （与官方 deepseek provider 的做法完全一致："the service enforces `maxResults` by truncating and flagging"）
- 这**不是**缺陷：接缝本来就会截断，provider 无需重复实现

## 6. 实测：公共实例几乎都不给 JSON ★

探测 8 个公共实例（`GET /search?q=…&format=json`）：

| 实例 | HTTP | 结果 |
|---|---|---|
| searx.be | 200 | `text/html`（返回 HTML 首页，未启用 JSON） |
| baresearch.org | 200 | `text/html` + 标题 "Making sure you're not a bot!" |
| search.inetol.net | 200 | `text/html` + "Security check - Substation" |
| priv.au | 429 | 限流 |
| opnxng.com | 429 | 限流 |
| paulgo.io | 429 | 限流 |
| searxng.site | 403 | format 未启用 |
| search.brave4u.com | 000 | 不可达 |

**两条重要结论**：
1. 这是自建实例的**决定性优势** —— 公共实例基本不可用（限流 / bot 检测 / JSON 关闭）。
2. **provider 必须校验响应内容，不能只看 HTTP 状态码**：实例被 botdetection 拦截时
   会返回 **200 + HTML**。所以解析前要先确认能 `JSON.parse` 成功 / `content-type` 是
   `application/json`，否则应抛 `WEB_PROVIDER_ERROR` 并给出可读原因（例如"实例返回了
   HTML，可能未启用 `search.formats: json` 或触发了 limiter"）。

## 7. 建议的 wire 形态（供后续设计参考，非最终决定）

```
GET {baseURL}/search?q=<encodeURIComponent(query)>&format=json
Headers: accept: application/json
         user-agent: <自定义标识，避免被当爬虫>   ← 可选但建议
无鉴权（自建内网实例）；如需反向代理 Basic Auth / Bearer，再加可配置 header
→ 200 application/json
   results[]: url(必非空) → url
              title(非空)  → title
              content(非空)→ snippet
              publishedDate(非空) → publishedAt
```

错误处理要点：
- 403 → 提示"实例未启用 json format"（最可能的用户错误）
- 429 → 提示"实例 limiter 限流"
- 200 但非 JSON → 提示"疑似 botdetection 拦截"
- 尊重调用方 `signal`，自加 provider 侧超时预算（参考 ollama 的 `requestAttempt`）
- `redirect: 'error'` 保持与其它 credentialed provider 一致（如无凭证可放宽）

## 9. ★ 实测确认（用户实例，2026-09-17）

> 实例地址与 API key **刻意不写入本仓库** —— 它们只在运行时配置（卡片 / settings / credentials）中存在。
> 本节记录的是**契约与行为**，不是凭证。

### 9.1 鉴权形态 = 自定义 header（对应设计方案里的"可选鉴权 ③"）

```
GET /search?q=<query>&format=json
X-API-Key: <secret>
```

- 带正确 key → `200` + `content-type: application/json`
- **不带 key / key 错误 → `403` + `text/html`**
- 实例前面是 **Cloudflare**（`server: cloudflare`、`cf-ray`、`cf-cache-status: DYNAMIC`）
  → 鉴权是 Cloudflare 层做的，**不是** SearxNG 自身
  （SearxNG 的 `server.secret_key` 是 session 签名密钥，与 API 鉴权无关）

### 9.2 ★ 两种 403 可以区分（对错误诊断很关键）

| 情况 | 状态 | content-type | body 特征 | 大小 |
|---|---|---|---|---|
| **key 缺失/错误** | 403 | `text/html` | `<title>Attention Required! \| Cloudflare</title>` | ~4.5 KB |
| **format 未启用** | 403 | `text/html` | `<title>403 Forbidden</title>` | ~213 B |
| `format=html` 或缺省 | 200 | `text/html` | 正常 HTML 页 | — |

→ provider 可以据此给出**精确**诊断，而不是笼统的"403"。

### 9.3 端点必须用 `/search`

`GET /` → **`308` 永久重定向**。配合既有的 `redirect: 'error'` 约定，用根路径会直接失败。
→ 构造 URL 时必须 `{baseURL}/search`，并按 ollama 的做法 `baseURL.replace(/\/+$/, '')` 去尾斜杠。

### 9.4 响应结构（37 条结果 / 33 KB）

顶层键：`query`、`results[37]`、`answers[0]`、`corrections[0]`、`infoboxes[1]`、
`suggestions[8]`、`unresponsive_engines[1]`。

**✅ 确认没有 `number_of_results`** —— 与 master 源码一致，不要依赖它。

`results[]` 字段类型统计（37 条）：

| 字段 | 类型分布 | 映射 |
|---|---|---|
| `url` | string ×37（本样本无 null） | → `url`（schema 仍允许 null，需防御） |
| `title` | string ×37（**无空串**） | → `title` |
| `content` | string ×37（**无空串**） | → `snippet` |
| `publishedDate` | **null ×33，string ×4** | → `publishedAt` |
| `template` | `default.html`×35、**`videos.html`×2** | ← 有非网页结果混入 |
| `engine` / `engines` / `positions` / `score` / `category` / `parsed_url` | 全有 | 未使用 |
| `thumbnail` / `img_src` / `iframe_src` / `audio_src` / `length` / `views` / `author` / `metadata` / `pubdate` / `priority` / `open_group` / `close_group` | 视结果类型出现（媒体类才有） | 未使用 —— **provider 必须容忍字段缺失** |

**`publishedDate` 实测形态**：`"2026-07-27T00:00:00"` —— **无时区后缀**的 ISO-8601。
符合接缝"provider-supplied ISO-8601 string"的要求，**原样透传**，不要自己加 `Z`。

**snippet 长度**：min 31 / median 126 / max 295；37 条合计 5226 字符。
（工具层 `searchMaxResults` 默认 8，实际进入上下文的是其中 8 条。）

`unresponsive_engines` 实测：`[["duckduckgo","CAPTCHA"]]` —— 引擎降级对使用者可见，
但**结果仍然正常返回**，不是错误。

### 9.5 ★ `answers[]` 确认真实存在（此前只是"可以映射"的推测）

```jsonc
// q=ip  →
"answers": [{
  "url": null, "engine": "plugin: self_info", "parsed_url": null,
  "template": "answer/legacy.html",
  "answer": "Your IP is: 172.104.53.203"     // ← 字段名是 answer，不是 content
}]
// q=2+2 / q=sqrt(16) / q="deepseek" → answers: []（多数查询为空）
```

`infoboxes[]` 在实体查询下也有内容：
```jsonc
{"infobox":"SearXNG","id":"https://en.wikipedia.org/wiki/SearXNG",
 "content":"metasearch engine","img_src":null,"urls":[{"title":"Official website","url":"…","official":true}, …]}
```

两者都可以映射到接缝的 `content` 字段（待决策，见 PRD Open Questions）。

### 9.6 参数透传实测（全部生效）

| 参数 | 实测效果 |
|---|---|
| `language=zh` | 结果集变化（43 条，首条 deepseek.com） |
| `categories=news` | 结果集显著变化（91 条） |
| `pageno=2` | 翻页生效（38 条） |
| `time_range=year` | 生效（49 条） |
| `safesearch=2` | 生效（39 条） |
| `!bang` 语法 | `!gh searxng` → 30 条**全部来自 github engine** |
| **POST `/search` form-urlencoded** | **可用**，200 + application/json，37 条 |

→ ⚠️ 但这些**只能在插件配置层设置**，不能按查询变化：接缝的 `WebSearchRequest` 只有
`query` 与 `maxResults` 两个字段，没有透传通道。所以暴露它们 = "固定偏好"，不是"每次可控"。

### 9.7 延迟与超时

实测 `time_total`：**0.65 s / 0.83 s / 1.03 s**（ttfb ≈ total）。
但 `server-timing` 见过 `total;dur=3004.482` —— 引擎慢时单次可达 ~3 s。
→ provider 侧超时预算建议 **15 s**（与 ollama provider 一致）；工具层已有 30 s
`tool-call-timeout-policy` 作为外层兜底。

### 9.8 ★ URL 形态与最小参数集（回答"只给 base url 够不够"）

**结论：参数必须由调用方拼，不能省。** `format=json` 是**硬性必需**：

| 请求 | 实测结果 |
|---|---|
| `/search?q=x` | `200` + **`text/html`** ← 没有 json |
| `/search?q=x&format=json` | `200` + `application/json` |

即 SearxNG 的默认 `search.formats` 是 html 优先，**JSON 必须由请求方显式要求**。
最小参数集 = **`q` + `format=json` 两项**（实测 39 条结果，其余全部可选）。

**URL 形态实测**（这决定了用户该填什么）：

| 用户填的 URL | 实测 |
|---|---|
| `https://<host>` | **308** → `location: /search?q=x&format=json`（query 一并带过去） |
| `https://<host>/` | 同上（308） |
| `https://<host>/search` | ✅ 正确 |
| `https://<host>/search/` | **`404`**（注意：**不**重定向！） |

→ `/` 虽然能靠重定向工作，但与"credentialed provider 一律 `redirect: 'error'`"的既有约定冲突，
**不能用**。尾斜杠会 404，所以规范化时必须去掉。

**推荐的规范化规则**（插件内实现，对用户宽容）：
```js
let base = raw.trim().replace(/\/+$/, '');          // 去尾斜杠
if (!/\/search$/.test(new URL(base).pathname)) base += '/search';
// 然后拼 ?q=<encodeURIComponent(query)>&format=json
```
用户填 `https://host` 或 `https://host/search` 都能工作。

### 9.9 零结果行为

垃圾 query（`zzzqqqxxyywwvv`）仍返回 **20 条**（SearxNG 的模糊匹配/兜底引擎）。
→ 真正的空 `results[]` 很少见，但 provider 仍必须正确处理空数组（返回
`{sources: [], truncated: false}`，不抛错）。

---

## 8. 与现有三个 provider 的对照

| | 条数参数 | 返回摘要字段 | 生成答案 | 鉴权 |
|---|---|---|---|---|
| deepseek-official | ❌（`max_uses`≠条数） | `citations[].cited_text`（需关联） | ❌（刻意不用） | API key |
| ollama-cloud | ✅ `max_results ≤ 10` | `results[].content` | ❌ | Bearer key |
| Exa | ✅ `numResults` | `highlights[0]` | ❌ | `x-api-key` |
| **SearxNG** | ❌ | `results[].content` | ✅ `answers[]`（可选映射） | 通常无 |
