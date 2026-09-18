# Research: 配置面 / 卡片字段能力

任务：`09-17-dsh-web-search-plugin`
调研时间：2026-09-17

**问题**：能否让用户自设 HTTP header（而不是插件硬编码 `X-API-Key`）？

**答案：能，且官方包已有完整先例 + 接缝对"dict 值型密钥"有专门支持。**

---

## 1. ★ 官方先例：`dsh-llm-pi-ai` 的 `headers` 字典

`D:/Scoop/persist/nvm/nodejs/v24.18.0/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:983-994`（provider profile schema）：
```js
const profile = z.object({
  apiKeyEnv: z.string().role("credential-ref"),
  displayName: z.string(),
  api: z.union(supportedProtocols()),
  baseURL: z.string(),
  models: z.array(modelProfile),
  ...
  headers: z.dict(z.string()),        // ← ★ 用户可配任意 HTTP header
  ...
});
const Config = z.object({ providers: z.dict(profile).default({}) });
```

它不只是声明，而是**完整实现**了：
- `assertValidHeaders(provider, headers)`（`:1036-1037`）—— 校验用户给的 header 名/值
- `requestHeaders(headers)`（`:1722-1727`）—— 合并时**大小写不敏感地剔除保留头**，
  防止用户覆盖 `content-type` 之类的关键头：
  ```js
  function requestHeaders(headers) {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase())))
  }
  ```
- `new Headers(Object.entries(stored.headers))`（`:2291`）—— 应用到实际请求

> 这个包正是给本机 `ollama` 路由供电的官方 LLM 适配器。所以"header 字典"是官方认可的配置形态，
> 不是我们要发明的私有约定。

## 2. ★ `role('secret')` 支持 dict 值（所以密钥可以不进 wire）

`dsh-settings/lib/types/redact.js`：
```js
function walk(node, value, path, secrets) {
  ...
  if (node.meta?.role === 'secret') { secrets.push({ path, set: value !== undefined }); ... }
  switch (node.type) {
    case 'dict': {
      for (const [key, entry] of Object.entries(value ?? {})) {
        const stripped = walk(node.inner, entry, [...path, key], secrets);   // ← 逐 dict 项遍历
      }
    }
  }
}
```

`redact.d.ts` 明确：
> `path` — "Path from the section root to the removed field (**concrete dict keys and array indexes included**)"
> `secrets` — "object properties always (even unset, so a form knows the slot exists),
> **dict entries and array items only where the value has them**"

→ `z.dict(z.string().role('secret'))` 完全可行。**dict 的 key 不会被 redact**（只有带
`role('secret')` 的**值**被剥离），且每个位置带 `set: boolean` —— 卡片因此可以渲染出
"名字 + 是否已配置"的列表，例如 `{path:['headers','X-API-Key'], set:true}`。

## 3. credentials seam 也为"动态键"做了设计

`dsh-credentials/lib/types/index.d.ts` 中 `isCredentialKeySegment` 的文档：
> "Consumers whose addressing units come from somewhere else — **a settings dict key**, a library's
> own provider id — ask this before building a key, because a unit outside the grammar can never
> have stored a record and should read as 'nothing stored' rather than as a thrown error."

→ "settings dict key"被列为合法寻址单位，说明动态键凭证是设计内的一等场景。

## 4. 卡片可用的现成控件

`dsh-client-ui-settings-plugins/lib/types/client/fields.d.ts`：
- `ValueField` —— 普通值字段（label / hint / staged text / overridden badge / reset）
- `SecretField` —— `/** A write-only credential control. The value never rides a response, so
  the control reports only whether one is configured and starts blank; **a blank draft writes
  nothing, which keeps the stored key rather than clearing it.** ```/`

→ 每行 header 的密钥控件可以直接复用 `SecretField` 的交互契约（留空=不改，避免误清空）。

## 5. 三种实现层级

| 方案 | schema | 卡片 | 覆盖能力 |
|---|---|---|---|
| **A. 只让 header 名字可配** | `headerName: z.string().default('X-API-Key')` + `apiKey: z.string().role('secret')` | 2 个固定字段 | 单 header。够当前用法 |
| **B. header map（推荐）** | `headers: z.dict(z.string().role('secret'))` | 动态行编辑器（增/删/改 + 已配置状态） | 任意多 header |
| **C. map 但值不标 secret** | `headers: z.dict(z.string())` | 同 B | 同 B，但值会明文随 `describe` 上线 |

### 为什么 B 优于 A

**Cloudflare Access 用的是两个 header**：`CF-Access-Client-Id` + `CF-Access-Client-Secret`；
Basic Auth 则是单个 `Authorization`。当前实例是单 header，但一旦挂到 CF Access 后面，
方案 A 直接不够用，而 B 无需改代码。

### B 的代价

- 卡片要多写一个动态行编辑器（增删改 + 每行的"留空不改"状态）
- 需要在保存时处理"删除某一行"的语义（与 `SecretField` 的"留空=保留"约定配合）
- settings.yaml 里是一段嵌套 map：
  ```yaml
  web-search-searxng:
    baseURL: https://searx.example.xyz
    headers:
      X-API-Key: <secret>
  ```

### 注意：值标 secret vs 不标

官方先例 `dsh-llm-pi-ai` 用的是 `z.dict(z.string())`（**不标 secret**）—— 值明文存在
settings 文档里，且会随 `describe()` 上 wire。
我们若标 `role('secret')` 则值不进 wire（更安全），代价是卡片必须自己渲染"已配置"状态，
且**不能**依赖通用表单回显。
`dsh-web-search-deepseek` 是两种都给的先例（`apiKey` 标 secret 的字面量 + `apiKeyEnv` 凭证引用）。
