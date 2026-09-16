# 两个插件都改造后的 profile 实测（2026-09-16）

R6 之后，仓库里两个插件都不再 patch `connection` 行。这一步记录**真实 profile 的后果**，
命令与观测都可复现。

## 1. 组合结果（离线，不启动进程）

```bash
dsh --profile web --dump-config | grep -A4 '^\- id: connection'
```

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject:
    - webRuntime          # ← 回到出厂值：不再有任何一个 bundle 拓宽它
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
```

## 2. 并行实例探针（无任何 `--patch` 叠加层）

```bash
dsh --profile web --no-open --port 8793 > .scratch/f8-probe3.log 2>&1 &
# 等 /no-such-route 不再返回 000 之后再探
```

| 请求 | 状态 | 含义 |
|---|---|---|
| `GET /trellis-statusline/task/read`（带/不带 query 各一次） | **401** | 本插件新路由已注册、栅栏拦下未鉴权请求 |
| `HEAD /trellis-statusline/task/read` | **401** | 同上（fence 与 method 检查都在） |
| `POST /ollama-usage/config/read` | **401** | 第二个插件的新 `prefix` 路由同样已注册 |
| `GET /api` | 401 | 出厂共享路由不受影响 |
| `GET /ollama-cloud` | **404** | 第三方 `dsh-llm-ollama` 的通道**失效**（它仍走 `connection.rpc`） |
| `GET /trellis-statusline`、`/trellis-statusline/`、`/trellis-statusline/task/read/` | 404 | 我们注册的是 **exact** 路由，没有前缀泄漏 |
| `GET /no-such-route` | 404 | 回退处理器基准 |

401 的响应体是 `unauthorized`（栅栏原文）。boot log 干净：没有 `route unavailable`，也没有
`RPC channel unavailable`（两个插件都注册成功，没有再依赖那一行）。

## 3. 一个容易误判的点：启动窗口内的 404

第一次探针在实例刚 ready 时打 `GET /trellis-statusline/task/read`（不带 query）拿到过 404，
而同一实例稍后同样的请求是 401。原因不是路由缺陷：`webServer` 先监听、各插件行随后 apply 注册，
**未被认领的请求在启动窗口里由回退席位答 404** —— 这是 `dsh-host-webserver` 文档写明且刻意设计的行为
（"the fallback handler answers anything not yet claimed during startup with 404 until its owner registers"）。
浏览器加载页面必然晚于行注册，所以线上不会看到这个窗口。

## 4. `dsh-llm-ollama` 失效的缓解办法（待用户决定，PRD Q7）

在**用户层**（profile 自己的 patch，单一所有者）保留一行拓宽即可让它复活：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: connection
  inject:
    - webRuntime
    - webServer
```

这不会影响我们两个插件（它们已不读 `connection.rpc`），只是给仍在读的插件续命；
更彻底的办法是上游那类插件改用同一套「自开路由 + `requestRejection`」模式。
