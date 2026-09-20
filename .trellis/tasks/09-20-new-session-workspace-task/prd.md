# 无指针会话只显示工作区活动任务计数（对齐 Claude Code）

## Goal

- 本会话**拥有会话指针**时：照旧显示 `[P] 标题 · 状态` + `父任务/子任务` 角色 + 可点击任务树（逐字节不变）。
- 本会话**没有指针**时：**不显示任何任务标题**（不再拿工作区扫描结果冒充本会话任务），改为显示
  **工作区活动任务计数**，例如 `工作区 3 个活动任务`。
- 工作区活动任务为 0、或工作区没有 `.trellis/` 时：什么都不显示。

用户价值：新开会话不再一片空白（至少知道这个工作区有几件在做的事），同时**结构上不可能**再把别的会话的任务
当成本会话任务——bootstrap 脚手架也再无可能被显示成"当前任务"。

## 背景与已确认事实（2026-09-17 ~ 09-20 实测）

- 解析链：`lib/index.js:415-427` 指针优先，否则 `scanTasks(cwd)`（`:229-247`：状态仅 `in_progress|planning`、
  **要求 `branch` 非空**、`in_progress` 优先、同档取目录名最大者）。
- **新会话永远没有指针**：指针由会话内 `task.py create|start` 写（`task_store.py:626-681`、`task.py:257`），
  Trellis 没有工作区级"当前任务"文件。
- 实测（真实 host 半边 + 真实工作区）：ecms 新会话 `4e3fe187`、无指针会话 `fde7959b`、`da0dccd3` → **(空白)**；
  有指针的 `aa509ce8` → `[P1] materialInfo/verificationByRule 慢SQL… · planning`、`703aabd3` → `[P2] 开发库填充… · planning`。
- 扫描规则对照（`.scratch/probe-scan.mjs`）：现状（branch 必填）→ **空白**；只去掉 branch → **`00-bootstrap-guidelines` 胜出**
  （它 `in_progress` 排名更高）⇒ 简单放宽会复发旧的 bootstrap 误报，这也是当初加该规则的原因。
- **Claude Code 对照**（把 ecms 真实 `.trellis` 复制到 `.scratch/cc-exp`、跑真 `.claude/hooks/statusline.py`）：
  该 session 无指针 → **不输出任务行**，信息行里只有计数 `2 task(s)`；有指针 → `[P1] 我自己开的任务 (planning) [session]`。
  计数实现 `_count_active_tasks`（`statusline.py:130-139`）= 非 `archive` 且存在 `task.json` 的目录数，**含 bootstrap**。
- dsh 侧无自动注入、无自动写入：`.dsh/DSH.md` 明示 "class-2 pull-based … Context hooks | None"；实测新会话系统提示
  105,711 字节里任务目录引用 0 次；pill 是浏览器 cell，不进模型上下文；改 task 只可能来自显式 `task.py` 命令。
- 插件路由存活：`curl /trellis-statusline/task/read` → 401（已注册 + 信任栅栏正常），排除"服务没起来"。

## Requirements

- **R1（显示来源 = 仅会话指针）**：无指针时**不得**显示任何任务标题；删除扫描显示路径
  （`scanTasks`、`RUNNING_STATUSES`、`statusRank`、branch 规则）——保留即死代码。
- **R2（无指针形态）**：pill 显示**工作区活动任务计数**；无角色标记、无下拉、不可点击、无 tab stop（`span`）。
- **R3（计数定义）**：非 `archive`、`task.json` 可解析且带 status 的任务目录数，**减去 `trellis init` 的
  `00-bootstrap-guidelines` 脚手架**（它永远拿不到指针，按用户 2026-09-20 指示不计入；名字像脚手架但已记录
  `branch` 的任务是真实工作，仍计入）。与 Claude 的 `_count_active_tasks` 有两处刻意差异：要求可解析（不数
  损坏目录）、减脚手架（Claude 会把它算进 `N task(s)`）。计数为 0 → 空态（`status: none`）。
- **R4（有指针时不变）**：pill 文本、角色判定（`tree.id === task.id ? root : child`）、下拉树、10s 轮询、
  hero 席位渲染，全部与现在一致。
- **R5（不变量与简化）**：host 半边仍只读 `.trellis/`、零依赖、`apply` 不抛；路由与两处席位不变；
  wire 新增一种 reply 形态并同步两半与测试。
- **R6（计数形态的图标，用户 2026-09-20 指示）**：计数 pill 带一个**纯装饰**的前置图标——内联 `svg`
  （14×14 artboard、`stroke:currentColor`、`aria-hidden`、`focusable="false"`），不参与交互、不占 tab stop、
  不破坏 R2 的 `span` 契约；glyph = A（list-checks 清单）；有指针的任务形态不变。

## Acceptance Criteria

- **AC1（host 单测）**：无指针 + N≥1 个活动任务 → `{ status:'workspace', activeTasks:N }`；N=0 → `{ status:'none' }`；
  `archive` 不计、损坏 `task.json` 不计、`00-bootstrap-guidelines` 脚手架不计（已 start 的同名任务仍计）；
  指针存在时仍返回 `ok`+`task`(+可选 `tree`) 且逐字段一致；除 `ok` 外任何形态都不含 `task`/`title`。
- **AC2（client 单测）**：计数 pill 是 `span`（非 `button`、无 `tabindex`/`aria-haspopup`、无焦点环）、不含角色节点；
  中英词典都带 `{n}` 占位并能插值；`task === null && count === null` 时渲染 `null`。
- **AC3（真机，需重启 dsh + 硬刷新页面；空白会话需目视）**：ecms 里新开（无指针）会话显示
  `工作区 2 个活动任务`（09-18 + 09-20；bootstrap 已减掉，host 半边实测已确认）；`aa509ce8` / `703aabd3`
  仍显示各自任务标题（实测已确认）。
- **AC4（回归）**：`npm test` 全绿（host/client/cell/integration 四个 harness）；`node --check` 两半通过；
  只读不变量仍成立（`.trellis` 前后快照 0 变更）。
- **AC5（文档）**：README 的 "Where the task comes from"、pill 形态表、故障排查（"显示错误任务"一条改写为
  "只看到计数 = 本会话没有指针"）与 `docs/design-notes.md` 同步新语义。
- **AC6（图标，R6）**：计数 pill 中恰好一个 `svg`，`aria-hidden="true"`、`focusable="false"`、无 handler、
  无 `tabindex`；图标位于文字**左侧**且句子逐字不变；有指针形态逐字段不变；`npm test` 断言数 205 → **209**。

## Out of Scope

- 工作区级**任务标题**兜底（用户已否决 B/D 两条路线）；指针/最近激活兜底。
- Claude Code 的完整信息行（model · ctx · branch · duration · dev）——本插件只做 pill。
- 修改 Trellis 本体、让插件写 Trellis 状态、为已归档任务恢复指针。

## Key Decisions

- **D1 = A（用户 2026-09-20 选定）**：无会话级证据 ⇒ 不显示标题，只显示工作区活动任务计数。
- 计数**不含** `00-bootstrap-guidelines`（用户 2026-09-20 指示："bootstrap 是初始化自带的，不会有指针会话" ⇒
  不计入；这是相对 Claude Code 的一处刻意差异，Claude 的 `N task(s)` 会把它算进去）。
- 标题来源收敛为指针后，扫描路径已在上一任务（commit `27b5b39`）中删除；本任务只在其上新增计数。
- 计数**不复用** `readActiveNodes()`（那是建树的路径），而是独立 `countActiveTasks()`：树的节点集不应被
  "脚手架排除"这类计数规则影响。

## 实现记录（2026-09-20）

- **基线**：插件 HEAD `27b5b39`（2026-09-17 "只认 Trellis 会话指针，删除工作区扫描兜底" = 上一任务的 D1=(a)）。
  本任务只在其上**新增计数**，不回滚任何既有决定。
- 改动（子模块 `dsh-plugin-trellis-statusline`，7 个文件，未提交）：
  - `lib/index.js`：新增 `SCAFFOLD_TASK_NAME` / `isScaffoldTask()` / `countActiveTasks()`；`readTask()` 的
    "无指针"分支返回 `{ status:'workspace', activeTasks }`（0 → 仍 `none`）；模块头与 `readTask` JSDoc 改为三形态契约。
  - `lib/client.js`：词典加 `workspace.count`（中英各一条，含 `{n}`）；新增 `decodeWorkspace()` / `formatCount()`；
    新增 `count` state（与 `task` 互斥）；新增第 4 种 pill（`span[data-kind=workspace]`，无角色/无 chevron/无点击）；
    空态仍返回 `null`；新增 `.trellis-statusline-count` 样式。
  - 测试：`test/host.test.mjs`（+3 用例、5 处期望改为计数）、`test/client.test.mjs`（+2）、
    `test/integration.test.mjs`（+4：计数 reply、句子、span/无角色/无菜单、双空不渲染）；`test/cell.test.mjs` 未改
    （计数形态由 integration 覆盖：真 host reply → 真 cell）。
  - 文档：`README.md`（pill 形态表第 4 形态、"Where the task comes from" 加 count 步、故障排查、断言数 195→206、
    harness 表）、`docs/design-notes.md`（链条加 count 节点、新增 "The workspace count (2026-09-20)"、对照表）。
- 自检：`node --check` 两半通过；`npm test` = **61 + 47 + 81 + 17 = 206 断言全绿**（基线 195）。
- **伪证检验**：把两半还原到 HEAD、保留新用例 → host harness 的 8 条新断言如预期失败（53/61）；恢复后 61/61。
- **真机（host 半边，无需重启）**：真实 host 半边 + 真实工作区（`.scratch/probe-final.mjs`）→
  ecms 两个无指针会话 `工作区 2 个活动任务`；`aa509ce8` → `[P1] …慢SQL… · in_progress`、
  `703aabd3` → `[P2] 开发库填充… · planning`；本会话 → 自己的任务（三者均与改造前一致）。
- **待办（AC3 的目视部分）**：重启 dsh（host 半边）+ 硬刷新页面（client bundle）后，在新会话（含空白会话 hero 表面）
  确认 `工作区 2 个活动任务` 出现且不带角色；有指针会话形态不变。**未提交**（AGENTS.md：等用户明确同意）。

### 计数形态的图标（2026-09-20，用户指示 R6）

- 用户指示"新会话页面的 statusline 添加一个 icon"；在两条实现路线（照 ollama-usage 的 CSS 圆点 / 内联 SVG
  glyph）与三个 glyph 候选中选定 **2-A：list-checks 内联 SVG**。
- `lib/client.js`：新增 `workspaceGlyph()`（放在 `makeApply` 内——`const h = React.createElement` 在那里，
  放到工厂层会 TDZ 报 `h is not defined`）：`svg` 14×14、`viewBox 0 0 14 14`、`fill:none`、
  `stroke:currentColor`、`strokeWidth 1.4`、round caps/joins、`aria-hidden`、`focusable="false"`；
  计数分支在文字前插入 `workspaceGlyph()`；CSS 新增
  `.trellis-statusline-glyph{flex:none;width:14px;height:14px;display:block;color:currentColor}`。
- 断言：integration **+2**（装饰性 svg 的 type/aria-hidden/focusable/viewBox/无 tabindex/无 onClick；图标在文字
  左侧且句子不变）、cell **+1**（dock 形态同规则）、client **+1**（CSS 三条：`flex:none` / `width:14px` /
  `color:currentColor`）。
- 伪证检验：移除渲染调用 → integration 18/20、cell 76/77 如预期失败（client 的 CSS 断言对应样式规则，单独
  还原后 50/51 同样失败）；恢复后全绿。
- 自检：`npm test` = **61 + 51 + 77 + 20 = 209 断言全绿**（原 205）；`node --check` 两半通过。
- 待目视（并入 AC3）：重启 dsh + 硬刷新后，新会话页面计数 pill 左侧应出现清单图标——与文字间距 4px、
  颜色随主题、整体仍不可点击。

### 回归修复（2026-09-20，用户目视反馈）

用户反馈：`工作区 N 个活动任务` **字号过大、风格与任务 pill 不一致**。根因确认为本任务新引入：

- `.trellis-statusline` 才是钉住 pill 字体度量的容器（`font-size:12px;line-height:18px;display:inline-flex`），
  而 pill 自身是 `font:inherit`；计数分支当时直接把 pill 当根节点返回、跳过了这层容器 ⇒ 字号继承宿主（header/hero 槽），
  于是"过大"。
- 修复：计数形态改为与任务 pill 同构 —— `span.trellis-statusline[data-role=none]` →
  `span.trellis-statusline-pill[data-kind=workspace]` → `span.trellis-statusline-count`（文本）。
- 同时删掉了我原先给计数 pill 加的弱化配色规则（`pill[data-kind=workspace]{color:…label-tertiary…}`）：
  "比任务 pill 更淡"正是用户说的"风格不一致"。现在同款、同色、同字号，只少角色 chip 与 chevron。
- 防回归断言：`integration` 断言计数 pill 必须带同一外层容器（className + `data-role=none`）；
  `client` 断言样式表里"容器钉字号、pill 继承"这条契约（`font-size:12px` / `font:inherit`）。
- 自检：`npm test` = **61 + 48 + 81 + 18 = 208 断言全绿**（此前 206）。

### 席位调整：新会话 pill 从 `shell.overlay` 移到 `conversation.input.dock`（2026-09-20，用户指示）

用户报告：新会话页面里 statusline 与 ollama-usage 的 hero pill **位置冲突**（不完全重叠）。调查结论（证据在
本 PRD 上文与 design.md）：

- **不存在避让算法**：`shell.overlay` 在 `dsh-client-ui-layout` 里只是一个普通容器（`renderSlot("shell.overlay")`
  + `overlayLayer` div），每个 cell 各自绝对定位。
- 具体差值：statusline `gap 6`；ollama `gap 8 + slotRect.height/2`（其 hero CSS 又把基类的 `translateY(-50%)`
  置为 `none`，等于多下移半个自身高度）⇒ 两者垂直相差 13px、22px 高的 pill 重叠约 9px（≈40%），正是"没完全分开"。
- 用户选定方案：**移到 `conversation.input.dock`** —— hero 里唯一"会渲染 + 是 flow list"的座位。
  `conversation.composer.dock`（卡片下方那行）在 hero 不渲染（`dsh-client-ui-conversation/lib/client.js:16259`
  按 `variant === "composer"` 门控）。

实施与验证：

- **删除整条测量路径**：`shell.overlay` 注册、`measureHero()`、`composerAnchor()`、`resolveBox()`、
  `COMPOSER_SLOT_SELECTOR`、overlay 两条 CSS、ResizeObserver/viewport 监听、`usePanelInfo` 面板门控
  （flow 行天然只在对话面板里）。
- **新增** `conversation.input.dock` 条目：id `trellis-statusline-dock`、order 30（排在官方 queue 行之后）、
  `locale CELL_ID`、session scope ⇒ standard kit 照旧投 `sessionId`；容器
  `.trellis-statusline-dock`（`width:100%` + `max-width:var(--dsh-chat-content-width)` + 居中）。
- **测试抓到的真 bug**：`enabled:false` 只停轮询、不清 hook 里的旧 state，而 composer dock 在会话由 blank 转 active 时
  **仍然挂载** ⇒ 旧 pill 会和 header pill 同时出现。修法：渲染路径也判 `blank === true`；`cell` harness 已钉住该用例。
- 自检：`npm test` = **61 + 49 + 76 + 18 = 204 断言全绿**（cell 81→76：测量类用例整体消失）。
- 文档：README（席位描述、故障排查去掉"composer 测不到"一条、harness 表、断言数）与 `docs/design-notes.md` §3
  重写（保留"为什么离开 overlay"与两条遗留陷阱）。

#### 同批次：ollama-usage 的 hero 面板也迁入 `conversation.input.dock`（用户指示）

同一个座位、同一套理由，落到第二个插件包 `dsh-plugin-ollama-usage`：

- **删除**：`shell.overlay` 的 `inject`/`register`、`measureHero()`、`HERO_GAP_PX`、四条
  `.ollama-usage-hero` 与 `[data-mode]` CSS、hero 的 ResizeObserver / viewport 监听 / `useIsoLayoutEffect` 测量 effect。
- **新增**：`conversation.input.dock` 条目（id `ollama-usage-hero`、order 1），复用其既有的
  `.ollama-usage-dock[data-flow="true"]` 流式行（居中 + `--dsh-chat-content-width` 约束 + 内容字体变量）。
- **相位规则不变**：`heroVisible()`（= settled 且 composer dock 行未挂载）仍是区分两种表面的唯一依据；
  `test/hero.test.mjs` 的两条关键断言（"dock 挂载时 hero 不出现" / "dock 卸载后 hero 出现"）原样通过。
- 自检：`npm test` = **44 + 28 + 10 + 6 = 88 断言全绿**（client 28 条：新增"overlay 席位已消失"断言；
  hero.test 6 条未改语义）。
- 文档：README 席位表 / 自检段 / client 模块头注释。

⇒ hero 页面两颗 pill 现在都是 `conversation.input.dock` 里的**流式行**，不再有任何绝对定位坐标。
- **待目视**：重启 dsh + 硬刷新后，新会话页面里 pill 应出现在**输入卡片上方**，不再与 ollama 用量 pill 重叠。

#### 修正：两颗 pill 必须在同一行（2026-09-20，用户目视反馈）

用户反馈"两个不在同一行中"。根因（读壳代码确认）：`conversation.input.dock` 的 catalog 契约是
**"Full-width entries above the composer card"**，而且座位锚点渲染为
`<div data-slot="conversation.input.dock" style="display:contents">`，`list` 的 entries 是它内部的 Fragment
⇒ 每个 entry 直接成为 composer **纵向** flex 栈的子项，**必然一行一个**（官方占用者 queue / todo / goal 也是为此而生）。

两条出路：把锚点改成换行横向容器，或接受两行。按用户要求取前者：

```css
[data-slot="conversation.input.dock"]{display:flex !important;flex-flow:row wrap;justify-content:center;align-items:center;gap:var(--dsh-composer-stack-gap,6px)}
```

- **`!important` 不可省**：壳把 `display:contents` 写在**内联样式**里，非 important 的作者样式赢不了内联。
- 对官方占用者安全：它们都是 `width:calc(100% - …)` 的整宽面板，在 `row wrap` 下会各自换行到独立一行，
  间距沿用壳自己的 `--dsh-composer-stack-gap`，视觉不变。
- 两个插件注入**同一条相同规则**（幂等）：只装其中一个也能正常布局。
- 两颗粒子自身改为内容宽度：statusline `.trellis-statusline-dock{display:inline-flex}`（原 `width:100%` 会独占一行）；
  ollama 新增 `.ollama-usage-row{display:inline-flex}`（替代原来的整宽 flow 行）。
- 自检：`npm test` = statusline **61+50+76+18 = 205**、ollama **44+29+10+6 = 89**（各自新增"座位锚点被改成换行行"的断言）。
- **残留代价（已告知用户）**：这是本任务唯一一处"覆盖壳自有元素样式"的地方；若后续壳改造该锚点的语义，
  失效表现仅是"两行变一行/间距变化"，不会丢功能。
