# implement.md — 执行清单

> 前置：`design.md` §2 取舍表已落盘（AC3）。逐条执行，每步后跑对应校验。

1. [x] **host 半边**（`lib/index.js`）
   - 常量：`ROUTE_PREFIX = "/trellis-statusline"`、`ENDPOINT_READ = "task/read"`、`ROUTE_PATH = ROUTE_PREFIX + "/" + ENDPOINT_READ`。
   - 工具：`sendJson(res, status, body)`、`rejected(req, res)`（栅栏 + 503 fail-closed）、`querySessionId(req)`。
   - `apply`：`ctx.effect(() => ctx.webServer.register({ kind: "exact", path: ROUTE_PATH, handler }), "trellis-statusline: task/read route")`，包 `try/catch` 只降级。
   - 重写 `inject` 注释（`connection` = 栅栏；`webServer` = 路由载体）。
   - 校验：`node --check lib/index.js`；`node test/host.test.mjs`。
2. [x] **client 半边**（`lib/client.js`）
   - `hostBase()`、`request(endpoint, query)` 用 `fetch` + `new URL(...)`；非 200 / `ok!==true` / 解析失败 ⇒ `null`。
   - client `inject` 去掉 `connection`。
   - 校验：`node --check lib/client.js`；`node test/client.test.mjs`；`node test/cell.test.mjs`。
3. [x] **清单**（`cordis.patch.yml`）：删 `- id: connection` 块；`dsh --profile web --dump-config` 抽查 `- id: connection` 回到 `[webRuntime, webServer]`（由 ollama-usage 提供）且 `- id: trellis-statusline` 仍在。
4. [x] **测试**：host harness 换假 `webServer`/`connection.requestRejection`/假 `req-res`；client harness 换 `globalThis.fetch` 桩；integration 换成"捕获路由 → 假 fetch 打到 handler"。
   - 校验：`npm test` 全绿。
5. [x] **文档**：`README.md`（删 connection override 小节）、`docs/design-notes.md`（记录换路径的理由与出处）。
6. [x] **spec（R3）**：`.trellis/spec/dsh-plugin-ollama-usage/frontend/halves-contract.md` 写入 F2–F5 + 官方三条路径对照 + 本插件的选择。
7. [x] **收尾**：真机重启目视（用户执行）→ 记录到 `prd.md` 的 AC1/AC2；提交需用户明确同意（AGENTS.md）。
8. [x] **R6：`dsh-plugin-ollama-usage` 同款改造** —— host 自开 `prefix` 路由 + 栅栏 + 方法/媒体类型/请求体校验；
   client 改 `fetch`；删除 `connection` 覆盖；四个 harness 改假 `webServer` / 假 `requestRejection` / `fetch` 桩。
   - 校验：`npm test` 87/87；`dsh --profile web --dump-config` 见 `connection` 回到 `[webRuntime]`；
     并行实例实测两条新路由 401、`/ollama-cloud` 404（更正记录见 prd）。
9. [ ] **Q7 待定**：是否在 profile patch 保留一行拓宽，让 `dsh-llm-ollama` 的通道复活。

## 校验命令速查

```bash
cd dsh-plugin-trellis-statusline
node --check lib/index.js && node --check lib/client.js
npm test
```
