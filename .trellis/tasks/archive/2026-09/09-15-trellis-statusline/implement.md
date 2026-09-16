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

## 7. 增量：角色标记 + 可点击任务树（R6–R9，2026-09-15 第二轮反馈）

> 前置：`design.md` §3.1–§3.5。顺序仍是 **测试先行**，每步以可验证结束。

### 7.1 Host：树推导

- `readActiveNodes(cwd)`：`readdir(tasks)` 跳过 `archive` → 每个目录读 `task.json` →
  `{ id, title, status, priority, parent, childNames }`；**不套 status/branch 过滤**。
- `effectiveParent(node, nodes)`：① 自身 `parent` 指向活动节点；② 否则唯一一个 `children` 含它的活动节点；③ 否则无父。
- `rootOf(id, nodes)`：沿 `effectiveParent` 上溯，visited + 上限 64。
- `collectDescendants(root, nodes)`：边 = `children` ∪ 反向 `effectiveParent`，union 去重 BFS，排除根，visited 防环。
- `buildTree(cwd, currentId)`：根 + 后代按目录名排序转 wire；根=当前且无后代 → `undefined`（R6）。
- `readTask` 返回值加 `tree`；`tree` 节点 title **不截断**。
- 验证：`node --check lib/index.js` → `node test/host.test.mjs` 全绿（§3.5 那张表逐条断言）。

### 7.2 Client：pill 文本 + 角色 + 下拉

- 常量：`ROLE_ROOT='父任务'` 走字典；CSS 补 `.trellis-statusline-pill/-parent/-role/-chevron/-menu/-menurow/-menugroup`。
- `decodeTask` 增补 `decodeTree`：树节点逐字段收窄，`current` 只在 `=== true` 时置位；
  任何不合形状的树 → 当作无树（降级成今天的行为，不抛）。
- pill 文本按 §3.1 三分支；根/子角色进 `data-role`，并给 aria/`title`。
- 无树 → `span`（无 `onClick`/无 tabindex）；有树 → `button[type=button][aria-expanded][aria-haspopup]`。
- 展开：`useState(false)`；effect 注册 `document` 的 `pointerdown`（落在根外则关）与 `keydown`（Esc 关），
  成对清理；`sessionId` 变化 `setOpen(false)`。
- 菜单：根行 + `ul` 子组（缩进 + 左导引线），命中行 `data-current="true"`。
- 验证：`node --check lib/client.js` → `node test/client.test.mjs && node test/cell.test.mjs` 全绿 →
  `npm test`（假 react 需补 `useRef`，假 document 需补 `addEventListener/removeEventListener`）。

### 7.3 文档与提交

- README 补：角色/树/交互、三种 pill 文本示例、已知上界（D7 的 NODE_LIMIT 触发条件）。
- `design.md` §3.1–§3.5 已写；若实现中发现契约需要改，先改 design 再改代码。
- 提交：一条 `feat:` 说明增量（断言数同步更新）。

### 7.4 真机验证（用户手动重启）

1. 单任务工作区（如 `dsh\any`，无活动树）→ pill 圆角灰底、**不可点击**、文本与旧版一致。
2. 本工作区（单任务，无树）→ 同上。
3. 造一个父子体系的工作区（或临时把某任务的 `parent` 指向父任务）→ pill 出现「子任务」+ 根标题前缀；
   点击 → 树展开、当前行高亮、Esc/外部点击/再次点击都能关。
4. 反例：任务树被归档后 → pill 退回单任务形态（无 `tree`）。

## 8. 增量 2：去掉根标题前缀 + 新会话界面（R10–R11，2026-09-15 第三轮反馈）

> 前置：`design.md` §3.1（R10 修订）与 §3.6（hero 第二处席位）。测试先行。

### 8.1 Client：pill 文本（R10）

- 删掉 pill 里的 `trellis-statusline-parent` 分支与它的 CSS 规则。
- 三种形态变成：`[P] 标题 · 状态` / `… · 父任务` / `… · 子任务`。
- 验证：`test/cell.test.mjs` 的三行文本断言改成无 `›` 版本；
  `test/integration.test.mjs` 的端到端文本同步。

### 8.2 Client：hero 第二处席位（R11）——最终形态

- 把 cell 主体抽成 `useTaskPill(sessionId, t, enabled)` 自定义 hook，两颗 pill 共用。
- 新增 `HeroStatuslineCell({ t, useSessions })`（root 作用域，**没有** `sessionId` prop）：
  - `sessionId = useSessions((s) => s.current)`；`blank = useSessions((s) => s.byId[id]?.blank)`
  - `blank !== true` → `return null`（AC13；无会话也天然不显示，AC14）
  - 否则渲染 overlay 包装 + slot，slot 内是 pill；坐标由测量得到。
- `ctx.slots.inject('shell.overlay', …)` 注册为
  `{ name: 'shell.overlay', id: 'trellis-statusline-hero', order: 1, locale: CELL_ID }`。
- 定位：`[data-slot="conversation.composer.bar"]` + `resolveBox` + 相对自己盒子的坐标 +
  水平居中于卡片；`ResizeObserver`（自己的父节点、锚点及其父节点）+ 视口 `resize` 成对清理。
- CSS：`.trellis-statusline-hero`（`pointer-events:none`，零高度）+
  `.trellis-statusline-hero-slot`（`pointer-events:auto`）。**不要**方向开关。
- 验证：cell harness——`blank:true` → 渲染 overlay 包装；未测量到布局时 slot 是
  `visibility:hidden`；给出 rect 并触发 re-measure 后断言 `left/top` 具体数值；
  视口监听器注册且卸载时释放；`blank:false` → `null` 且**零请求零定时器**；
  `useSessions` 缺失 → 降级不抛；client harness 断言**两个**席位的 slot/id/order 与 click-through CSS。

### 8.2b 席位两次改判（2026-09-15 验收反馈）

- 第一轮 `conversation.input.dock`（卡片**上方**）→ 用户否掉观感。
- 第二轮 `conversation.composer.dock`（目录描述"below the composer card"）→ **hero 里完全没显示**：
  渲染点是 `variant === "composer"`，而 hero 是 `variant === "hero"`。
  **教训：判断席位在某状态下是否渲染，读渲染点，别读目录描述。**
- 第三轮定案 `shell.overlay` + 自定位（见 8.2）。
- **effect 依赖必须含 `hasPill`**：任务是挂载后一帧才到的，只依赖 `[enabled]` 会让首帧无 wrapper、
  effect 直接返回，之后再也不测量 → pill 永远 hidden。这个 bug 是测试抓到的。
- 删除 `data-placement` 参数、`[data-placement="up"]` 规则与相应断言（无第二种方向，不留死分支）。

### 8.3 文档与提交

- README：三种形态表更新（无 `›`）、新增「New-session view」小节、席位表补第二处、断言数同步。
- spec `seats.md`：补两条平台事实——(1) blank session 里头部是 `display:none` 而非卸载；
  (2) 由此得出的判定法：用 shell 自己的 `blank` 位，不要用"是否挂载"。
- 提交一条 `feat:`。

### 8.4 真机验证（用户手动重启）

1. 普通会话 → 头部 pill，文本 `… · 子任务`（**无 `›`**）。
2. 新建会话（hero）→ **输入框卡片下方**出现同一颗 pill；点击 → 下拉向下展开、当前行高亮。
3. 普通会话里卡片下方**不应**有第二颗 pill（那里只有官方 `stats`）。

## 风险点与回滚

| 风险点 | 回滚/兜底 |
|---|---|
| 步骤 0 的会话身份结论与预期不符 | 停在步骤 0，改 design §2.1 后再继续 |
| 安装后 dsh 起不来 | 该行 `disabled: true` 或在 profile patch 里移除该行；插件 apply 已 try/catch |
| 席位在 dsh 升级后改名/改 kind | 客户端 `slots.inject` 找不到槽即静默不注册（不报错、不阻断） |
| 树推导在畸形数据上挂死 | visited + 迭代上限 64；`buildTree` 整体包在 try/catch 里，异常 → 当作无树 |
| 下拉遮挡/裁切 | 与官方 jobs cell 同款绝对定位；若真被裁，退化为"只有角色标记、无下拉"（删一个 `tree` 渲染分支即可） |
| hero 判据（`blank`）在 dsh 升级后语义变化 | 退化为"hero 里不显示"（回到今天的行为），不影响普通会话那颗；改一个选择器即可 |
| dock 那颗在普通会话里误显示 | 会造成双 pill；AC13 有专门断言，且 cell harness 覆盖 `blank:false` |
