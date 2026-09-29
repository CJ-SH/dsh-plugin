# 调查网络搜索不可用原因

> 任务 `09-21-web-search-fetch-422`。阶段：**Phase 1 规划（brainstorm）**，尚未实现，未激活。
> 环境：`DSH_HOME=C:\Users\Hasee\.dsh`，profile `web`，插件 `dsh-plugin-web-search`（submodule，commit `49c8767`）。
> 观测时间：2026-09-21。

## Goal

回答"网络搜索/抓取为什么不可用"，给出**可复现的根因**与可选处置方向。

用户价值：以后 `web_fetch` 失败时能立刻分辨是"目标不是 HTML"这类**上游能力限制**，而不是把 `HTTP 422` 当成玄学故障；
并据此决定是否让插件在非 HTML 目标上自动回退。

## 背景与已确认事实（2026-09-21 实测）

### 1. 生效的配置

home patch 层 `~/.dsh/cordis.patch.yml`（插件管理块，压过 profile patch）：

```yaml
- id: web
  config:
    searchProvider: searxng
    fetchProvider: jina
```

插件自身设置 `~/.dsh/settings.yaml` → `web-search`：

- `providers.searxng.endpoint = https://searx.747497.xyz/search`
- `providers.jina.endpoint = https://fetch.747497.xyz/`

### 2. 搜索侧正常 —— "搜索不可用"实际是抓取侧

- 直接请求 `https://searx.747497.xyz/search?q=deepseek&format=json`：**HTTP 200**，37243 字节合法 JSON。
- 本会话内 `web_search` 工具调用成功返回 sources。
- 抓取失败的会话中**没有**任何 `SearxNG：` 报错文本。

⇒ 搜索（SearxNG provider）可用；不可用的是 `web_fetch` 对**非 HTML 目标**的抓取。

### 3. 抓取侧根因：Jina 格式服务只接受 HTML

`web_fetch` 走 jina 格式 provider（`dsh-plugin-web-search/lib/index.js:400-447`），
URL 由 `buildJinaUrl`（`lib/index.js:375-377`）把目标 URL 原样拼到端点之后。

对同一端点、同一 `X-API-Key` 的实测对照：

| 目标 URL | 目标 content-type | 端点响应 |
|---|---|---|
| `https://pypi.org/pypi/amqtt/json` | application/json | **422** `{"code":422,"status":42201,"message":"unsupported content-type: application/json"}` |
| `https://api.github.com/repos/CJ-SH/dsh-plugin-web-search` | application/json | **422** `unsupported content-type: application/json; charset=utf-8` |
| `https://raw.githubusercontent.com/CJ-SH/dsh-plugin-web-search/main/package.json` | text/plain | **422** `unsupported content-type: text/plain; charset=utf-8` |
| `https://example.com` | text/html | 200（markdown，188 B） |
| `https://pypi.org/project/amqtt/` | text/html | 200（markdown，6753 B） |
| `https://en.wikipedia.org/wiki/DeepSeek?x=1&y=2` | text/html | 200（61678 B） |

⇒ `fetch.747497.xyz` 是 Jina Reader 兼容实现，**只把 HTML 转 markdown**；非 HTML 一律 422，
并把真实原因放在 JSON body 的 `message` 里。

### 4. 为什么现象表现为"不可诊断"

`classifyHttpFailure`（`lib/index.js:210-224`）只特判 401/403/429/404 与 `text/html`；
422 + `application/json` 落到兜底分支 `lib/index.js:224`：

```js
return `${label}：HTTP ${status}，服务拒绝了请求。`
```

`requestJson` 其实已经把 body 前若干字节读进 `readBodyExcerpt`（`lib/index.js:233-239`），
但该分支**没有使用** body，上游 `unsupported content-type: application/json` 被丢弃。
`label` 为 `'Jina Reader'`（`lib/index.js:418`）。

### 5. 会话实证（非推测）

- `~/.dsh/sessions/--D-project-dsh-any--/session-d0ae1500-6b52-48bc-a08c-8d30125b105c`，turn 1 step 4：
  `web_fetch({ url: 'https://pypi.org/pypi/amqtt/json' })` → `Jina Reader：HTTP 422，服务拒绝了请求。`；
  模型随后放弃该路径（"Let's just use pip"）。
- `~/.dsh/sessions/--D-project-dsh-dsh-plugin--/session-e89ad82a-775d-411f-8766-79ff81d68a9a`，step 25：同一错误文本。
- 会话日志是**多帧 zstd**（单次 `zstdDecompressSync` 只得到首帧 209 字节），须用 `zstd -dc` 才能搜出这些证据。

### 6. 放大因素：本机上没有可用的 JSON 抓取路径

home patch 把 `fetchProvider` 全局钉成唯一 jina provider，**没有回退**。但"回退到 dsh 内置 `http`"也救不了这台机器：

- 本机 DNS 走代理 **fake-ip** 模式：`example.com → 198.18.1.56`、`pypi.org → 198.18.1.57`（`nslookup` 实测）。
- 内置 `http` provider 的 SSRF 守卫拒绝非公网 IP：`@deepseek-ai/dsh-web-fetch-http/lib/index.js:70`
  → `URL hostname "..." resolves to a non-public IP address`（`WEB_BLOCKED_URL`）。

⇒ 本机两条官方抓取路径对 JSON 目标**都不可用**：jina 返回 422，内置 http 被 SSRF 拦。
**可行旁路**：JSON/文本 API 用 `bash` + `curl`（实测 `curl https://pypi.org/pypi/amqtt/json` → HTTP 200 / 31185 B）。
这正是失败会话里模型的兜底选择（"Let's just use pip" / 改换工具）。

## Requirements

- **R1 结论落地**：把根因（含可复现命令、对照表、file:line 锚点、会话实证）写入本任务研究文档，作为后续任何处置的依据。
- **R2 诊断可读性**：上游返回未特判状态（如 422）时，错误信息必须包含上游 body 中的可读原因
  （如 `unsupported content-type: application/json`），而不是只有 `HTTP 422，服务拒绝了请求。`
- **R3 处置策略**：待 **Q1** 决定后填写；在决定前不写具体行为。

## Acceptance Criteria

- [ ] **AC1** 复现：对 `https://fetch.747497.xyz/` 请求 `https://pypi.org/pypi/amqtt/json` 返回 422，且 body 含 `unsupported content-type`。
- [ ] **AC2** 根因文档明确区分"搜索侧可用"与"抓取侧对非 HTML 失败"，并保留全部 file:line 锚点与会话路径。
- [ ] **AC3**（仅当 Q1 选择含修复）修复后可验证：对 JSON 目标报错信息包含上游 `message`；若含回退，则给出回退成功/失败的判定行为。

## Out of Scope

- 不重建、不调参用户自建的 `searx.747497.xyz` / `fetch.747497.xyz` 服务本体。
- 不改 dsh 内置 provider（`http` / `deepseek-official`）的实现。
- 不承诺"任意 JSON API 都能抓"作为默认能力（是否回退由 Q1 决定）。
- 不改本机代理的 `fake-ip-filter` / `redir-host` 模式（属环境配置，由用户决定；它是内置 `http` 被 SSRF 拦的直接原因）。

## Open Questions

- **Q1（blocking）处置范围**：只出根因结论文档，还是同时做插件侧修复？若修复走哪条路？
  - A 仅调查结论文档，不改代码
  - B 调查 + 透出上游 message（小改 `classifyHttpFailure`）
  - C B + 非 HTML 目标回退到内置 `http` provider
  - D 只改配置（`fetchProvider` 换回 `http`），插件代码不动 —— **实测不可行**：fake-ip DNS + SSRF 守卫（§6）

## 证据文件索引

- `dsh-plugin-web-search/lib/index.js:210-224` HTTP 失败分类；`:233-239` body 摘录；`:375-377` Jina URL 构造；`:400-447` jina provider（label `:418`）
- `~/.dsh/cordis.patch.yml`、`~/.dsh/settings.yaml`
- 会话：`session-d0ae1500-6b52-48bc-a08c-8d30125b105c`、`session-e89ad82a-775d-411f-8766-79ff81d68a9a`
