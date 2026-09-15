# implement.md — Trellis statusline（dsh web 插件）

> 执行清单。每一步都以"可验证"结束；失败即停并回到上一步。

## 0. 前置确认（30 分钟内的实测，决定后面怎么写）

1. 席位实况复核：确认 `conversation.session.header.utilities` 仍为 `kind: list, scope: session`，
   且 cell 组件确实收到 `sessionId`（对照 `dsh-client-ui-jobs` 的 `JobListAction`）。
2. 会话身份复核：确认 client 拿到的 `sessionId` 等于磁盘目录名 `session-<uuid>`；
   若不等，记录实际形态并在下一步改为"会话服务返回 id"。
3. host 服务复核：确认 host 侧能否查到会话的 `cwd`；不能则确定 client 传 `cwd` 的取法。
   **这一步的结论必须回写 design.md 的 §2.1。**

## 1. 包骨架

- 建目录 `dsh-plugin-trellis-statusline/`：`package.json`（`type: module`、`main`、`exports` 的
  `.` 与 `./client`、`dsh.bundle.patch`、`dsh.client`、`scripts.test`）、`cordis.patch.yml`（insert 一行）、
  `README.md`（三处说明：显示什么、装在哪、怎么验证）、空的 `lib/index.js`/`lib/client.js`。
- 验证：`node --check lib/index.js lib/client.js`；`dsh --profile web --dump-config` 前先不装。

## 2. 先写测试（三个 harness，无框架、零依赖）

- `test/host.test.mjs`：假 cordis ctx（`connection.rpc.handle` 捕获 handler）+ 临时目录造 `.trellis`：
  - 指针优先（写 `.runtime/sessions/dsh_<id>.json` → 返回该任务）
  - 扫描兜底（in_progress 优先于 planning；同级 tie-break = 目录名最大）
  - 空态（无 `.trellis` / 无任务 / 任务文件损坏 JSON）
  - 只读（断言实现里没有 `writeFile`/`unlink`/`mkdir`；可用源码字符串断言，参照 ollama-usage 的写法）
  - 跨半边一致（endpoint 集合、通道名在 host/client 两边都存在）
- `test/client.test.mjs`：假 `window.__ModuleLoader__` + 假 ctx：
  - bundle id = 包名；只 `require('react')`；导出 `apply`/`inject`
  - 席位：`name === 'conversation.session.header.utilities'`、`id === 'trellis-statusline'`、`order` 存在
  - `inject` 含 `slots`/`connection`/`timer`
- `test/cell.test.mjs`：最小 hook runtime 驱动真实 cell 组件：
  - host 返回 `ok` → 渲染出 `[P1] 标题 · 进行中`
  - host 返回 `none` → 渲染 `null`
  - `sessionId` 变化 → 触发重新请求；卸载 → interval 被清理（假 timer 记录）

## 3. Host 实现

- `name`/`inject`/`apply`；`ctx.effect(() => ctx.connection.rpc.handle('/trellis-statusline', ...), '...')` 用 try/catch 包住。
- 端点：`task/read`；未知端点返回 `unknown-endpoint`。
- 只读实现：`node:fs/promises` 的 `readFile`/`readdir`；所有异常吞成 `{ status: 'none' }`。
- 验证：`node --check lib/index.js` → `node test/host.test.mjs` 全绿。

## 4. Client 实现

- bundle 包装 + `inject`；一个 CSS 字符串（`.trellis-statusline-*`、只用 `--dsw-*` token、`:focus-visible` 不需要因为无交互）；
- cell 组件（`{ sessionId, t }`）：首次 + 每 10s `request('task/read', { sessionId })`；失败一律当 `none`；
  空 → `null`；`ctx.interval` 在组件卸载时清理（引用计数或按组件持有）。
- 验证：`node --check lib/client.js` → `node test/client.test.mjs && node test/cell.test.mjs` 全绿 → `npm test`。

## 5. 真机验证（安装后）

1. `dsh plugin --profile web add <插件目录>`
2. `dsh --profile web --dump-config | grep trellis-statusline` → 出现该行
3. 用户重启 dsh web → 目视：活动会话头部出现 `[P1] …`；新会话（hero）不出现（预期）
4. 浏览器外探针：带 cookie `POST /trellis-statusline/task/read`，body
   `{"type":"client-request","rpcId":"1","method":"task/read","payload":{"sessionId":"session-<uuid>"}}`
   → `{"ok":true,"value":{...}}`
5. 反例：切到一个没有 `.trellis` 的工作区 → 整行自动消失、无报错

## 6. 收尾

- README：显示内容、席位、安装/卸载、已知限制（hero 不显示；只读）。
- spec 更新：把"会话头部 utilities 席位实况""空的 list 席位 `:empty` 自动隐藏""会话记录含 cwd"补进
  `.trellis/spec/dsh-plugin-ollama-usage/frontend/`（该层现在只写了契约，这几条属于新发现的平台契约）。
- 提交顺序：插件子模块先提交 → meta-repo 记录指针 → 若注册为 submodule，同一步更新 `.gitmodules`。

## 风险点与回滚

| 风险点 | 回滚/兜底 |
|---|---|
| 步骤 0 的会话身份结论与预期不符 | 停在步骤 0，改 design §2.1 后再继续 |
| 安装后 dsh 起不来 | 该行 `disabled: true` 或在 profile patch 里移除该行；插件 apply 已 try/catch |
| 席位在 dsh 升级后改名/改 kind | 客户端 `slots.inject` 找不到槽即静默不注册（不报错、不阻断） |
