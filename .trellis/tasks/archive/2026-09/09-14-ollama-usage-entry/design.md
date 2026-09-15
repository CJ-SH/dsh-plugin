# Design: Ollama Cloud 用量条目（动态插件原型，自带配置卡片）

## 目标与边界

**Host + Client 两半的动态 Cordis 插件**：Host 半拥有自己的设置命名空间、凭据读写与用量取数；Client 半拥有三处 UI——活动会话 dock 条目、hero 自绘浮层、Settings → Plugins → Plugin configuration 的配置卡片。**不读取、不调用任何第三方插件的配置或运行时**。

## 架构与数据流

```
[Host]
  settings.register('ollama-usage', { baseURL, apiKeyEnv })   ← 命名空间即卡片的 key
  credentials.resolve(apiKeyEnv) / credentials.set(ref,value)
  usage: GET {baseURL}/usage  (Authorization: Bearer <key>)
  harness.handle('config/read' | 'config/save' | 'credential/describe' | 'credential/set' | 'usage/read')

[Browser]
  Client half
    ├─ surface A : conversation.composer.dock  (id 'ollama-usage', order 1)   ← 活动会话
    ├─ surface B : portal overlay (document.body)                             ← 仅 hero 相位
    └─ surface C : settings.plugin.item (key 'ollama-usage') → 配置卡片
         └─ 通过 host.call 读写配置/凭据/用量；不含任何密钥
```

**为什么这样最简**：不再需要「会话当前模型 → 路由 → baseURL → 凭据引用」的推断链（那要依赖别人的配置形状）。配置是显式一次的：我们的命名空间 + 我们的卡片 + 官方凭据 seam。

**配置命名空间（Host）**
- `ns = 'ollama-usage'`；schema：`{ baseURL: string (默认 'https://ollama.com'), apiKeyEnv: string (默认 'OLLAMA_API_KEY') }`。
- 注册即出现在配置页签：该页签按 Host 已注册命名空间派发卡片（`dsh-client-ui-settings-plugins` 机制，见 PRD 事实 4）。
- 写路径：卡片的"保存"经 `host.call('config/save', {patch, expectedRevision})` → owner scope `update()`；stale revision 报错回卡片（沿用官方卡片的"保存被拒绝"语义）。
- 读路径：`host.call('config/read')` → `{ value, revision }`（或直接读 owner scope 的 `get()`）。

**凭据（Host）**
- 卡片密钥输入 → `host.call('credential/set', { value })` → `ctx.credentials.set(apiKeyEnv, value)`；"清除" → `credentials.unset`。
- 卡片显示状态来自 `host.call('credential/describe')` → `{ configured, writable }`（`describe` 不回显值）；输入框永不回显已存密钥。
- 取数时 `credentials.resolve(ref)`（每次操作重新解析，凭据轮换无需重启）。

**取数（Host）**
- 条件：`baseURL` 非空 且 `resolve(apiKeyEnv)` 有值；否则返回 `{ status: 'none' }`（R5）。
- 请求：`GET {baseURL}/usage`，`Authorization: Bearer <key>`，超时 ~10s + AbortSignal；**绝不**把 key 放进 URL/日志/错误串（错误只报状态码与脱敏主机名）。
- 解码：`{ status:'unsupported' } | { status:'ok', usage:{ fetchedAt, session?, weekly?, monthly? } }`；窗口 `{ usage:0..1, models:[{name,requestCount}], resetsAt? }`；任一字段非法 → 丢弃整次结果。
- 刷新：Client 挂载一次 + 打开面板一次 + 5 分钟轮询（Client 触发，Host 无状态）。

**Client 三面**
1. dock 条目（活动会话）与 2. hero 浮层（自绘）共用同一 pill + 面板组件；pill 文案 = 最紧窗口 `Ollama {窗口} {pct}%`，面板列三窗口（百分比条 / 重置时间 / 各模型请求数），Esc 关闭并还焦点。
   - 相位判定：以 dock 占位者挂载状态为信号（占位者只在活动会话渲染，conversation `client.js:16259`）；备选为客户端 session 服务现行 API。
   - 浮层定位复用 composer CSS 变量（`--dsh-composer-height` 等），外层容器不拦截指针，z-index 低于菜单层；`react-dom` 不可用时退化为纯 DOM + CSS。
3. 配置卡片（`settings.plugin.item`, `key: 'ollama-usage'`）：字段 `baseURL`、`apiKeyEnv` + "保存密钥"与"清除"、状态文案（已配置/未配置/不可写）、保存/丢弃按钮、错误提示；沿用设置页既有卡片外观（标题/描述/字段/页脚），自绘表单与状态（官方卡片同样自带 controller）。

**安全与隐私**：key 只在 Host 内存与凭据存储；浏览器只拿 `configured/writable` 状态与解码后的数值；错误路径统一脱敏；不写盘（除 settings/credentials 本身）。

**可移植约束**：仅 `React.createElement`（无 JSX）、不 import 用户模块；Host/Client 分层清晰，迁移进包时替换包内 RPC 入口与构建包装。

## 待实现时用 Inspect 核实的契约

1. Client：`settings.plugin.item` 精确 props（是否注入设置快照/动作、locale、`key` 语义）；`conversation.composer.dock` props；Builtins `react`/`react-dom`。
2. Host：`settings` 的 `register`/owner 写 API（`update`/`replace`/`mutate` 与 `expectedRevision` 语义）、descriptor 列表；`credentials` 的 `resolve/describe/set/unset`；Builtins 是否含 `fetch`（否则 `dsh-web-fetch-http`）。
3. 备选相位判定所需的客户端 `sessions`/`uiSession` API。

## 兼容性、风险与回滚

- 加性槽（dock list 槽 + 卡片 keyed 槽）：内置 `stats` 与官方卡片都不受影响。
- 纯动态插件：`cordis_stop` 即回滚 UI；**注意** settings 命名空间与凭据是持久数据，卸载插件后保留（重装即可复用；不需要时手动清理 settings 段落与凭据）。
- 风险 1：卡片保存语义（revision/校验）与官方卡片不一致 → 按 Inspect 结果对齐；失败保留草稿。
- 风险 2：未公开端点 `GET {baseURL}/usage` 变化 → 一律 `none`，静默。
- 风险 3：hero 浮层定位随窗口/侧栏变化 → resize 重算或纯 CSS 变量；settling 相位短暂显示可接受。
- 风险 4：用户填错 baseURL（非 Ollama 端点）→ 端点无用量接口时按 `unsupported` 静默；卡片错误提示只给结论，不泄露响应体中的敏感内容。

## 后续（不在本任务）

常驻包：Client 模块 + Host 模块 + `dsh.client`（platform web）/包清单 + `dsh plugin --profile web add <spec>`；本原型按"可移植约束"书写，迁移时补包清单与构建即可。
