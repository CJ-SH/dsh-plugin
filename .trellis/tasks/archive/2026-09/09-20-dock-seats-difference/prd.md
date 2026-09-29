# composer.dock 与 input.dock：两个 composer 座位的差异

> 任务 `09-20-dock-seats-difference`。只做证据调查与结论文档，不改代码。
> 测点：**旧版 dsh `0.1.5-rc.2`**（§1–§6）与 **新版 dsh `0.1.6-alpha.2`**（§7），profile `web`；
> 文件：`@deepseek-ai/dsh-client-ui-conversation/lib/client.js`、`@deepseek-ai/dsh-cordis-client-runner/lib/client.js`（座位目录）。
> 行号按各自版本分别标注，勿跨版本混用。

## Goal

回答：**为什么 `conversation.composer.dock` 需要测量/定位，而把东西放进 `conversation.input.dock` 就自动排列、居中？**
并纠正一处命名：用户描述里两个座位的对应关系是反的（见 R4）。

用户价值：以后再往 composer 附近加 UI 时，能一眼判断"该用哪个座位、需不需要测量、壳会替我做哪些布局"，
而不是靠试出来。

## 背景与已确认事实（2026-09-20 实测）

### 1. 协议层：两个座位**没有** API 差异

| 项 | `conversation.composer.dock` | `conversation.input.dock` |
|---|---|---|
| 目录条目 | `dsh-cordis-client-runner/lib/client.js:2515-2517` | `:2708-2710` |
| kind / scope | `list` / `session` | `list` / `session` |
| 目录文案 | "Ambient entries below the composer card."（`:2518`） | "Full-width entries above the composer card."（`:2711`） |
| 声明者 | **`conversation.composer.bar`**（`:2561`）⇒ 只在 InputBar 挂载时存在 | `main.conversation` ⇒ 会话面板在就存在 |
| 已装占用者 | `client-ui-chat StatsPills id 'stats'`（`:2562`） | 无 shipped 占用者 |
| 注册方式 / standardProps | 相同（`slots.inject` + `slots.register({name,id,order})`；`useInput`/`inputActions`/`sessionId`…） | 相同 |

### 2. 渲染点与相位：第一处真差异

- **`input.dock`**（`dsh-client-ui-conversation/lib/client.js:14927`）：`zone !== undefined && renderSlot("conversation.input.dock", zone)`，
  作为 `composerStack` 的子项出现（`:14919-14930`），与 `HeroShell`、`heroWorkspaceRow`、`inputBar` 同栈；
  `zone` 仅在 `session && inputState` 都有值时才定义（`:14869`）。
  ⇒ **hero（新会话）与使用中会话都会渲染**，新会话页面的 pill 就在这个栈里。
- **`composer.dock`**（`client.js:16259`）：`variant === "composer" && input !== undefined && sessionId !== undefined ? renderSlot("conversation.composer.dock", {}) : null`。
  ⇒ **hero 相位永不渲染**（hero 下 `variant` 是 `"hero"`）。

### 3. 布局层：第二处真差异（"要不要测量"的答案）

`input.dock` 的父容器（壳内联 CSS，`:14652`）：

```css
.wSkVaW_composerStack{--dsh-composer-stack-gap:6px; gap:var(--dsh-composer-stack-gap);
                      flex-direction:column; display:flex}
.wSkVaW_composerHero {width:min(calc(var(--dsh-composer-card-max-width) + 2*var(--dsh-composer-side-clearance)),100%);
                      align-self:center; gap:8px; padding-bottom:32px}
```

⇒ 纵向 flex 栈：**间距由壳的变量给（6px，hero 8px）、hero 居中由 `align-self:center` + 最大宽度给**。
条目就是普通流式子项——没有坐标可算，也没有坐标需要算。

`composer.dock` 的父容器（InputBar 根，`:15757`）：

```css
.uV2eYG_root{padding:0 var(--dsh-composer-side-clearance) 8px;
             flex-direction:column; align-items:center; display:flex}
.uV2eYG_card{width:100%; max-width:var(--dsh-composer-card-max-width);
             border-radius:22px; display:flex; flex-direction:column; position:relative}
```

⇒ 条目也是流式子项、也会水平居中（`align-items:center`），**但壳不给宽度**：它只提供几何**变量**
（`--dsh-composer-card-max-width`、`--dsh-composer-side-clearance:16px`、`--dsh-composer-dock-inset:8px`，
定义在 `.wSkVaW_root`，`:14652`）。官方面板自己套公式对齐卡片宽度——
TodoPanel：`.lXshSW_root{width:calc(100% - 2*side-clearance - 4*dock-inset); max-width:calc(card-max-width - 4*dock-inset); margin:0 auto; …}`（`:16265`）。

卡片控制行是横向 flex：`.JObwrW_row{justify-content:space-between; align-items:center; gap:12px; display:flex}`（`:15339`）——
"挤进这一行（挨着 stats pills / 发送键）"与"在卡片下方再来一行"是两件完全不同的事。

**补充实测（同一个问题的关键）：两个容器其实都是"流式纵向栈"，差别在契约。**

- 座位锚点本身不是盒子：`dsh-client-ui-renderer/lib/client.js:767` `const ANCHOR_STYLE = { display: "contents" }`
  —— 所有 seat 的锚点都是 `display:contents`，所以 **entry 是两个父容器的直接 flex 子项**（两座位皆然）。
- 已核实的嵌套（InputBar 的 JSX 骨架，`client.js:16257-16261`）：`]` 关掉 card 的 children → `})` 关掉 card 元素 →
  `16259` 的 `renderSlot("conversation.composer.dock")` 与 card **同级**（d5）→ `]` 关掉 root children → `});` 关掉
  `InputBar.root`。⇒ composer.dock 的 entry 是 `div.uV2eYG_root` 的直接子项，位置在**卡片之后**（"below the composer card"）。

| 容器属性 | `.wSkVaW_composerStack`（input.dock） | `.uV2eYG_root`（composer.dock） |
|---|---|---|
| 方向 | `column` | `column` |
| 间距 | `gap:var(--dsh-composer-stack-gap,6px)`（hero 另加 `gap:8px`） | **无 gap**：条目自己给垂直间距；壳只对已装占用者做特例 `:has([data-composer-stats]){padding-bottom:4px}`（`:15757`） |
| 水平居中 | hero 用 `align-self:center` | `align-items:center`（对每条 entry 生效） |
| 宽度 | hero 的栈自带 `width:min(card-max-width + 2*side-clearance, 100%)` | 根只有 `padding:0 var(--dsh-composer-side-clearance) 8px`；条目要对齐卡片得自己套公式 |
| 相位 | hero + 使用中 | 仅 composer |

⇒ 所以差别**不是"有没有流式栈"**，而是"**流式容器有没有契约**"：input.dock 的栈由壳给出间距与（hero 下的）居中/宽度；
composer.dock 的栈只给方向与水平居中，间距与宽度要条目自己负责，而且它够不到卡片内部的控制行。

### 4. "位置功夫"的真实来源（`dsh-plugin-ollama-usage`）

- hero 用量 pill 挂在 `conversation.input.dock`（`lib/client.js:1090`，id `ollama-usage-hero`、order 1）；
  使用中会话的用量挂在 `conversation.composer.dock`（`:1087`，id `ollama-usage`、order 1）。
- 位置相关的代码全部属于 **composer.dock 的 inline 选择**：`findPillRow`（`:353`）、`rowMetrics`、`INLINE_GAP_PX`、
  `mode:'inline'`（`:535-549`：`left: metrics.right - own.left + INLINE_GAP_PX`、`top: metrics.centerY - own.top`），
  配合 `.ollama-usage-dock{height:0;position:relative;pointer-events:none}`、
  `.ollama-usage-slot{position:absolute;left:0;top:0;transform:translateY(-50%)}`、`[data-flow="true"]` 回退（`:56-71`）。
- **这是产品选择，不是座位强制**：不挤卡片行时，composer.dock 的默认形态就是"卡片下方居中一行"（`flow` 模式），
  同样不需要坐标；需要坐标的只有"要和卡片控制行里的 pill 并排"这一个诉求。
- 上一轮迁移删掉的是 **hero 侧**的 overlay + `measureHero()` + ResizeObserver/视口监听；**composer.dock 的 inline 测量仍在**。

#### 4.1 这是不是"设计失误"？——证据下的判定

- **v1 的选择在当时是合理的**：composer.dock 的锚点是 `display:contents`，座位语义是"一个 entry 一行"；而它要与
  **另一个 entry**（壳自带的 `StatsPills`，`dsh-client-ui-chat/lib/client.js:8351` 注册、order 0）**同排**，
  又不可能钻进别人的 cell。当时没有"座位级换行"的已知手段 ⇒ 只能测量兄弟节点的几何再绝对定位：
  `findPillRow`（`:352-371`，"在兄弟里找一个矮的、非空的行"）、`narrowToContent`（`:342`）、`INLINE_GAP_PX = 12`（`:43`）。
- **现在有了严格更简单的同类手段**：本 workspace 在 2026-09-20（父任务）验证了
  `[data-slot="conversation.input.dock"]{display:flex !important; flex-flow:row wrap; gap:…}` —— `!important` 能盖掉
  壳写在内联样式里的 `display:contents`（`dsh-client-ui-renderer/lib/client.js:767`）。同一条规则用在
  `[data-slot="conversation.composer.dock"]` 上，就能让它名下的 entry（stats + usage）共享一行，先后由 `order` 决定，
  **不需要任何坐标**。⇒ 测量路径从"唯一可行"降级为"**可替代的技术债**"。
  （**未实测**：本任务只记录方案与验证步骤，不在只读范围内动插件。）
- **但两个方案并不等价**，这也是测量仍可能有正当理由的地方：
  - `row wrap`：两颗粒子各占一格、整行按规则居中，与内置 pill 的间距由容器决定，不"贴身"。
  - `inline`：精确贴在 `findPillRow` 命中的那一行右侧 12px；自身 `height:0` 不占行、用 `pointer-events:none` 隔离
    （`:56-61`）。代价是启发式测量 + `ResizeObserver`/视口监听（`:535-549`）以及对壳布局变化的脆弱性——
    启发式按"矮的非空兄弟行"挑选，**composer 的 notice 行（`.uV2eYG_notice`，同为 `.uV2eYG_root` 的直接子项）
    理论上也可能被挑中**（未实测）。
- **判定**：不是"想错了"，而是"**当时只有那条路、后来没回头清理**" ⇒ 归为**技术债而非设计失误**；
  是否替换取决于产品是否要求"像素级贴身同排"这一条语义（实施另开任务，见 Out of Scope）。历史侧证据：
  `dsh-plugin-ollama-usage` 仅 3 个提交，inline 机制随 v1 (`eb8c782`) 一起进来，此后未再调整。

### 5. 一句话结论

**协议相同；两个锚点也都是"流式纵向栈"，差别在契约与相位**：`input.dock` 的栈由壳给出间距（6px）与 hero 下的
居中/宽度；`composer.dock` 的栈只给方向与水平居中，间距/宽度要条目自己负责，且它**只在 composer 相位存在**、
位置在卡片**之后**（够不到卡片内部的控制行）。需要测量从来不是 seat 的要求，而是"想在卡片控制行里内联显示"
这个产品诉求的代价。

### 6. 命名纠正

用户原话把两者对调了：**`composer.dock` = 使用中会话（composer 相位）"卡片下方/卡片内"；
`input.dock` = 两相位都有、且新会话页面 pill 所在的"卡片上方流式栈"。**
（"放进 `input.dock` 就自动排列"与实测一致——只是它对应的座位名是后者。）

### 7. 版本变化：dsh 0.1.6-alpha.2（2026-09-21 实测，用户更新 dsh 后）

**composer.dock 换了容器 —— 壳给这个座位加了一个专用横向行。**

| 项 | 0.1.5-rc.2（旧） | 0.1.6-alpha.2（新） |
|---|---|---|
| 渲染点 | 直接挂在 InputBar 根的 children，与 card 同级（`client.js:16259`） | 包进新容器 `div.InputBar.dock`（`client.js:16459-16465`）：`children:[renderSlot("conversation.composer.dock"), jsx(ContextMeter)]` |
| 容器 CSS | `.uV2eYG_root{padding:0 var(--dsh-composer-side-clearance) 8px; flex-direction:column; align-items:center; display:flex}` + 特例 `:has([data-composer-stats]){padding-bottom:4px}` | `.uV2eYG_dock{justify-content:center; align-items:center; gap:12px; max-width:100%; padding-top:4px; display:flex}`（**横向行**）；根变 `.uV2eYG_root{padding:0 var(--dsh-composer-side-clearance) 4px}`（`:has` 特例消失） |
| 同排行为 | 每个 entry 各占一行（无 gap、无宽度） | **entries 默认共享一行**：居中、gap 12px、`max-width:100%` |
| 新 occupant | — | 壳自带 `ContextMeter`（`client.js:15911`；用 primitives 的 `useAnchoredPosition` + `useDismissOnOutsidePointer` 做上下文胶囊/面板）与 composer.dock 的 entry 同排，且在非 composer 相位也会渲染 |
| 目录契约 | `kind:list`/`scope:session`、"Ambient entries below the composer card."、occupants `StatsPills id 'stats'`、`replaceRisk:none`（runner `:2515`/`:2547` 起） | **完全未变**（runner `:2698-2749`；仅行号位移，`source` 由 slots.ts:170 → :192） |
| input.dock 侧 | `.wSkVaW_composerStack{--dsh-composer-stack-gap:6px; gap:var(…); flex-direction:column; display:flex}`；hero `align-self:center` + max-width | **未变**（`client.js:14743` 同一规则） |

**结论与影响**

1. "composer.dock 的 entry 只能各占一行"这条旧版限制，**在新版已被壳自己解决**：要"同一行"现在什么都不用做。
   ⇒ 反向证实 §4.1 的判定：同排需求是真实的，壳在新版把它变成默认行为。
2. **ollama-usage 的 inline 测量很可能已过时甚至冲突**（结构性推论，尚未真机复核）：它的 entry 根是
   `.ollama-usage-dock{width:100%; height:0; position:relative; pointer-events:none}`，而新父容器是 `display:flex; gap:12px` 的行
   —— `width:100%` 会吃掉整行宽度；同时它仍用 `findPillRow` 测兄弟行（现在的兄弟是 `StatsPills` entry 与 `ContextMeter`）
   再把自己绝对定位过去 ⇒ 预期出现"挤占/重叠/间距翻倍"一类问题。
   **高优先级复核项**：新版本真机下，使用中会话的用量 pill 与 stats/context 胶囊是否同行、间距是否正确。
3. `input.dock` 侧无变化 ⇒ 上一轮为"两颗 pill 同一行"注入的
   `[data-slot="conversation.input.dock"]{display:flex !important; flex-flow:row wrap; …}` 在新版本**仍然必要**
   （`.composerStack` 仍是纵向栈）。

## Requirements

- **R1 契约层对照**：给出声明者、kind/scope、相位门控、占用者与注册方式的对照表，全部带 file:line。
- **R2 布局层解释**：给出两个锚点的父容器 CSS、壳"给了什么/没给什么"，明确**两者都是流式纵向栈**（锚点 `display:contents`），
  把"为什么放进去就自动排列、居中"归因到具体规则（间距/居中/宽度的责任归属）。
- **R3 归因分层**：区分**座位强制**与**产品选择**（inline 与内置 stats pill 同排才需要测量与监听），并给出
  "这是不是设计失误"的判定：当时约束下的合理性、后来出现且**未验证**的可替代手段（座位锚点 `row wrap` 覆盖）、
  以及两方案不等价之处（贴身 vs 共享一格）。判定的历史证据要带 commit 锚点。
- **R4 命名纠正**：composer.dock = 使用中会话/卡片下方；input.dock = 两相位皆有/卡片上方；hero 永不渲染 composer.dock。
- **R5 改动边界**：只改 `dsh-plugin-ollama-usage` 的**客户端半边**（`lib/client.js` + 其测试与文档）；不改壳、不改 host 半边/wire、
  不改 `dsh-plugin-trellis-statusline`（它只用 header + input.dock，不受 composer.dock 变化影响）。
- **R6 实施替换（用户 2026-09-21 选定 C）**：删掉 dock 的**测量路径**（`INLINE_GAP_PX`、`resolveBox`、`narrowToContent`、`findPillRow`、
  `composerOutlet`、`measureDock`、`samePlacement`、`useIsoLayoutEffect`，以及 ResizeObserver / 视口监听与
  `height:0` / `position:absolute` / `data-flow` 坐标样式），让 composer.dock 的 entry 变成**普通流式项**：
  新版壳的行容器（`gap:12px`）自动让它与 stats/ContextMeter 同排；旧版（列容器）自动降级为"自家居中一行" = 今天的 `flow` 回退。
  **不做版本探测**——两版都正确，只是观感不同。
- **R7 版本化文档与 spec**：README 写明"同排改由壳负责（≥0.1.6-alpha.2）"与旧版降级行为
  （该包没有 `docs/design-notes.md`，理由落点改为 README + spec + 结论文档）；`seats.md` 回写补版本注记与
  "容器才是差异所在"的硬规则。

## Acceptance Criteria

- **AC1（对照表）**：一张表覆盖 座位 / 声明者 / 相位 / 锚点父容器 / 壳提供什么 / 条目自己要做什么。
- **AC2（锚点）**：每个结论都有 file:line（目录、渲染点、CSS 规则、插件侧代码）。
- **AC3（回答原问题）**：一句话回答"为什么一个要测量、一个不用"，指出测量来自产品诉求而非座位契约；并给出
  **债务判定**（技术债 / 设计失误二选一 + 理由）与**替代方案的验证清单**（哪条 CSS 覆盖、用什么观察点确认、失败回退）。
- **AC4（交付物）**：`research/dock-seats-difference.md`（含对照表与锚点），并单列"**版本差异**"一节
  （0.1.5-rc.2 → 0.1.6-alpha.2 的容器/occupant/契约 diff + 对 ollama-usage inline 的复核清单）。
- **AC5（spec 回写）**：`.trellis/spec/dsh-plugin-ollama-usage/frontend/seats.md` 增"锚点容器与几何变量"小节
  （两个座位的父容器、壳给的变量、宽度责任、相位差异）并补版本注记（composer.dock 0.1.6-alpha.2 起有行容器），不改写既有结论。
- **AC6（实现与自检）**：`node --check` 通过；`npm test` 全绿且断言数 ≥ 基线 89；新增/改写断言必须**证明测量已消失**
  （CSS 无 `height:0`/`position:absolute` 的 dock 规则、无 `data-flow` 坐标、代码里无 ResizeObserver/视口监听注册），
  并保留"hero 席位的 input.dock 行覆盖仍在"的断言。
- **AC7（真机）**：dsh ≥0.1.6-alpha.2 重启 + 硬刷新后，使用中会话的用量 pill 与 stats/context 胶囊同排、间距正常、窄屏不挤压；
  hero 页两颗 pill 仍同行；记录观察结果（若机器上仍是旧版，记录旧版降级表现）。

## Out of Scope

- 改壳（`dsh-client-ui-conversation`）或给它提 PR。
- 改 `dsh-plugin-trellis-statusline`（它的两个席位不受 composer.dock 变化影响）。
- 提交/推送（按 AGENTS.md 需用户明确同意）。

## Key Decisions

- **D1**：任务两段——先**解释**（§1–§7 的判定与版本差异），再**只改 `dsh-plugin-ollama-usage` 客户端半边**落地（R6）；
  结论文档 + spec 回写也是产出。
- **D2**：结论分两层——**座位契约强制** 与 **产品选择代价**，不把后者写成前者。
- **D3**：结论必须**带版本**（§1–§6 = 0.1.5-rc.2；§7 = 0.1.6-alpha.2）；壳每次升级都要重测这两个座位的容器语义——
  本次已发生（composer.dock 多了行容器），所以"版本差异"是交付物的固定一节，不是附注。

- **D4（用户 2026-09-21 选定 C）**：替换方案 = **直接删测量、让 entry 当普通流式项**，**不做版本探测**：
  新版（≥0.1.6-alpha.2）由壳的行容器负责同排，旧版自动降级为"自家居中一行"（等价于今天的 `flow` 回退）。
  真机复核（AC7）与文档/spec 版本注记（R7）随本次一并做。

## 实现记录（2026-09-21）

- **代码**：`dsh-plugin-ollama-usage/lib/client.js` 删除测量路径——`INLINE_GAP_PX`、`resolveBox`、`narrowToContent`、
  `findPillRow`、`composerOutlet`、`rowMetrics`、`measureDock`、`samePlacement`、`useIsoLayoutEffect`，以及
  `DockEntry` 内的 `box`/`slot` holder、`align` state、`useIsoLayoutEffect` 测量 effect、`ResizeObserver` + 视口监听、
  `data-flow`、inline `left/top`；CSS 里 dock 改为普通流式项（`display:inline-flex; min-width:0; max-width:100%`），
  删除 `height:0;position:absolute;pointer-events:none` 与两条 `[data-flow]` 规则与 `.ollama-usage-dockline .ollama-usage-slot` 复位规则。
  `DockEntry` 现在只有"挂载/卸载 + 相位就绪才渲染"三件事。
- **测试**：`test/client.test.mjs` 新增两条断言（样式表无 overlay/测量规则 + dock entry 是流式项，把旧的
  `data-flow` 存在性断言反转），并新增**源码级**断言（去注释后无 `ResizeObserver`/`getBoundingClientRect`/`data-flow`/
  测量助手函数，注释中的历史说明不计）。`npm test` = **44 + 32 + 10 + 6 = 92** 全绿（基线 89）。
  **伪证检验**：加回 `INLINE_GAP_PX` + 一条 `[data-flow]` 规则 ⇒ 恰好两条新断言失败（29/31）；移除后 92 全绿。
- **文档/spec**：`dsh-plugin-ollama-usage/README.md`（席位表改写 + "本插件不测量、不定位"段 + dsh 版本要求 + 断言数 89→92）、
  模块头注释；`.trellis/spec/dsh-plugin-ollama-usage/frontend/seats.md` 新增 "Anchor containers and geometry"
  （两版容器对照、`display:contents` 推论、"不许测量进兄弟行"、`input.dock` 行覆盖仍必要）。
- **交付物**：`research/dock-seats-difference.md`（对照表 / 版本差异 / 债务判定 / 替换记录 / 真机清单）。
- **回归与修复（用户目视发现）**：点击 pill 后详情面板不再出现在 pill 正上方。根因：panel 是 `position:absolute`，
  其包含块原本是 `position:absolute` 的 `.ollama-usage-slot`，删测量时 slot 变静态 ⇒ 面板爬到最近的定位祖先
  （composer 卡片/会话根）。修法：`.ollama-usage-slot` 补 `position:relative`（布局不变、不读 rect）。
  防回归断言 "the panel is anchored to the slot that holds the pill" ⇒ 断言数 **44+32+10+6 = 92**，
  伪证检验（去掉 `position:relative`）恰好该断言失败；spec 的 popover 小节同步补"删定位会静默带走包含块"。
- **代码 review 清理（用户要求）**：机械审计（CSS 类定义↔引用、标识符引用计数、残留 token、测试脚手架）——
  唯一真冗余是 `.ollama-usage-slot-inner`：渲染已久但**没有任何 CSS 规则**（HEAD 里也没有，属历史遗留；承载 Escape
  的 `onKeyDown` 的 div 本身有用）。删掉该类名、保留 div；新增防回归断言
  **"every rendered class has a rule of its own"**（伪证检验：把类名加回 ⇒ 恰好该断言失败，32/33）。
  其余：无未引用标识符、无测试脚手架残留、残留 token 只在注释里（测试在去注释后的代码上断言为零）。
  ⇒ `npm test` = **44 + 33 + 10 + 6 = 93**。观察记录：被删的测量路径**原本没有任何测试覆盖**，这也解释了
  为什么唯一回归（面板包含块）是靠目视发现的。
- **待办**：AC7 真机复核（需重启 dsh + 硬刷新，用户执行）；提交需用户明确同意。

## Open Questions

（无阻塞项；实施细节见 `design.md` / `implement.md`）
