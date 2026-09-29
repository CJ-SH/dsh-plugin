# composer.dock 与 input.dock：两个 composer 座位的差异（含 0.1.6-alpha.2 版本变化与本次替换）

> 任务 `09-20-dock-seats-difference`。测点：dsh `0.1.5-rc.2`（2026-09-20）与 `0.1.6-alpha.2`（2026-09-21）。
> 文件：`@deepseek-ai/dsh-client-ui-conversation/lib/client.js`、`@deepseek-ai/dsh-cordis-client-runner/lib/client.js`（座位目录）、
> `@deepseek-ai/dsh-client-ui-renderer/lib/client.js`（锚点）、`dsh-plugin-ollama-usage/lib/client.js`。

## 0. 结论摘要

1. **两个座位协议相同**（`list`/`session`、同一套 `slots.inject`+`register`、同一组 standardProps），差别只在
   **渲染容器**与**相位**。
2. **两个锚点都是 `display:contents`**（renderer `0.1.6-alpha.2:1094` / `0.1.5-rc.2:767`）⇒ entry 是座位容器的
   **直接 flex 子项**：座位给盒子，容器给布局。
3. **"要不要测量"不是座位决定的**：`input.dock` 的容器（`.composerStack`）自带 `gap`、hero 下还有
   `align-self:center` + 最大宽度，放进去就自动排列居中；`composer.dock` 在旧版的容器只给方向与水平居中
   （**无 gap、无宽度**），所以当年为了"和内置 stats pill 同一行"只能自己测量 + 绝对定位。
4. **0.1.6-alpha.2 把这件事做进壳里了**：`composer.dock` 现在有专用行容器 `.uV2eYG_dock`
   （`display:flex; justify-content:center; align-items:center; gap:12px; max-width:100%`），entry 与壳自带的
   `ContextMeter` 自动同排。
5. **判定：那套测量是"技术债"，不是"设计失误"** —— v1 的约束下是唯一可行解（旧容器没有"同排"手段，
   又不可能钻进别人的 cell），后来壳给了行容器、workspace 也验证过 `!important` 覆盖锚点的手段，
   于是它从"合理代价"变成"可清理的债"。本次已清理。

## 1. 契约层对照

| 项 | `conversation.composer.dock` | `conversation.input.dock` |
|---|---|---|
| 目录条目 | runner `0.1.6-alpha.2:2698`（旧版 `:2515`） | runner `:2903`（旧版 `:2708`） |
| kind / scope | `list` / `session` | `list` / `session` |
| 目录文案 | "Ambient entries below the composer card." | "Full-width entries above the composer card." |
| 声明者 | `conversation.composer.bar`（runner `:2745`）⇒ 只在 InputBar 挂载时存在 | `main.conversation` |
| 已装占用者 | `client-ui-chat StatsPills id 'stats'`（chat `:8389`；runner `:2746`）；`replaceRisk: none` | 无 shipped 占用者 |
| 相位门控 | `variant === "composer" && input && sessionId`（conv `:16461`，旧版 `:16259`）⇒ **hero 永不渲染** | `zone !== undefined`（conv `:15247`，旧版 `:14927`）⇒ hero 与使用中会话都有 |
| 注册 / props | 相同（`slots.inject` + `slots.register({name,id,order})`；`useInput`/`inputActions`/`sessionId`…） | 相同 |

## 2. 布局层：容器才是差异所在

| 容器属性 | `.composerStack`（input.dock） | `.uV2eYG_root` / `.uV2eYG_dock`（composer.dock） |
|---|---|---|
| 方向 | `column`（两个版本都一样） | 旧版 `column`；**新版是 `.uV2eYG_dock` 的横向 `flex` 行** |
| 间距 | `gap:var(--dsh-composer-stack-gap,6px)`（hero `8px`） | 旧版**无 gap**；新版 `gap:12px` |
| 居中 | hero 用 `align-self:center` | 旧版 `align-items:center`；新版行内 `justify-content:center` |
| 宽度 | hero 的栈自带 `min(card-max-width + 2*side-clearance, 100%)` | 两版都**不给宽度**：面板要自己套 `--dsh-composer-card-max-width` / `--dsh-composer-side-clearance:16px` / `--dsh-composer-dock-inset:8px`（TodoPanel `.lXshSW_root` 是官方范例，conv `:16471`） |

**为什么"放进 input.dock 就自动排列、居中"**：它是 `.composerStack` 的普通流式子项，间距来自壳的
`--dsh-composer-stack-gap`，hero 下整个栈还有 `align-self:center` + 最大宽度 ⇒ 没有任何坐标可算。

## 3. 版本变化（0.1.5-rc.2 → 0.1.6-alpha.2）

| 项 | 旧 | 新 |
|---|---|---|
| composer.dock 渲染点 | 与 card 同级、直接挂在 InputBar 根（`:16259`，缩进 d5） | 包进 `div.InputBar.dock`：`children:[renderSlot("conversation.composer.dock"), jsx(ContextMeter)]`（`:16459-16465`） |
| 容器 CSS | `.uV2eYG_root{padding:0 …8px; flex-direction:column; align-items:center; display:flex}` + `:has([data-composer-stats]){padding-bottom:4px}` | `.uV2eYG_dock{justify-content:center; align-items:center; gap:12px; max-width:100%; padding-top:4px; display:flex}`；根变 `.uV2eYG_root{padding:0 …4px}` |
| 新 occupant | — | 壳自带 `ContextMeter`（conv `:15911`；`useAnchoredPosition`+`useDismissOnOutsidePointer` 做上下文胶囊/面板），与 entry 同排 |
| 目录契约 | — | **未变**（只有行号位移、`source` slots.ts:170→192） |
| input.dock 侧 | `.composerStack` 纵向栈 + hero 居中 | **未变** |

⇒ 旧版"一个 entry 一行"的限制，在新版由壳解决；本 workspace 的 `input.dock` 行覆盖在新版**仍然必要**。

## 4. 归因分层：座位强制 vs 产品选择

- **座位强制（必须自己做的）**：面板要和卡片等宽 ⇒ 自己套几何变量公式；这是两个版本都不变的。
- **产品选择（当年测量的真正原因）**：要让用量 pill **紧贴内置 stats pill 的右侧 12px 同一行**。
  旧容器没有"同排"手段，而 entry 又不能钻进别人的 cell ⇒ 只能 `findPillRow` 测兄弟行 + 绝对定位
  （`dsh-plugin-ollama-usage/lib/client.js` 旧代码：`INLINE_GAP_PX=12`、`findPillRow`、`rowMetrics`、
  `ResizeObserver` + 视口监听、`height:0` + `pointer-events:none`）。

## 5. 债务判定（"是不是设计失误"）

**技术债，不是失误。** 依据：

1. v1（`eb8c782`，2026-09-15）当时：座位锚点是 `display:contents`、容器是纵向列、`StatsPills` 是别人的 cell
   ⇒ 除了测量没有别的办法达到"同排"。
2. 2026-09-20 本 workspace 验证了 `[data-slot=…]{display:flex !important; flex-flow:row wrap}`（`!important` 能盖掉
   壳的内联 `display:contents`）；2026-09-21 壳自己给 `composer.dock` 加了行容器 ⇒ 测量从"唯一解"变成"多余解"。
3. 该仓库至今只有 4 个提交，inline 机制随 v1 进来后**再没回头清理** —— 符合"债"的形态（当时对、后来没还），
   而不是"想错了"。
4. 保留测量的唯一正当理由是"像素级贴身同排"这一条语义；壳的行容器给的是"共享一行、间距 12px"，两者不完全等价。

## 6. 本次替换（2026-09-21，用户选定范围 C）

**删掉**（`dsh-plugin-ollama-usage/lib/client.js`）：`INLINE_GAP_PX`；`resolveBox`、`narrowToContent`、
`findPillRow`、`composerOutlet`、`rowMetrics`、`measureDock`、`samePlacement`、`useIsoLayoutEffect`；
`DockEntry` 内的 `box`/`slot` holder、`align` state、测量 effect、`ResizeObserver`/视口监听、`data-flow`、inline
`left/top`；CSS 里 `height:0;position:absolute;pointer-events:none` 与两条 `[data-flow]` 规则。

**保留**：`.ollama-usage-dockline` 与 `[data-slot="conversation.input.dock"]{…row wrap…}`（hero 与 statusline
同行仍需）、pill/panel/菜单全部样式与交互、轮询与相位规则。

**结果**：composer dock entry = `div.ollama-usage-dock > span.ollama-usage-slot > button.ollama-usage-pill`，
两级都是普通流式项；新版与 `StatsPills`/`ContextMeter` 同行（壳给 gap 12），旧版自动降级为自家居中一行。
**不做版本探测**（两版都正确）。

**自检**：`node --check` 通过；`npm test` = **44 + 32 + 10 + 6 = 92** 断言全绿（基线 89）；
新增断言覆盖"样式表无 overlay/测量规则""dock entry 是普通流式项""源码（去注释后）无 `ResizeObserver`/
`getBoundingClientRect`/`data-flow`/测量助手函数""面板锚定在持有 pill 的 slot 上"；**伪证检验**：
（a）把 `INLINE_GAP_PX` 与一条 `[data-flow]` 规则加回 ⇒ 恰好两条断言失败（29/31）；
（b）去掉 slot 的 `position:relative` ⇒ 恰好面板锚点断言失败（31/32）；各自移除后 92 全绿。

### 6.2 代码 review 与面板样式对比（2026-09-21，用户要求）

**冗余审计**（CSS 类定义↔渲染引用、标识符引用计数、残留 token、测试脚手架）：

- 唯一真冗余：`.ollama-usage-slot-inner` —— 被渲染但**从未有 CSS 规则**（HEAD 亦然，属历史遗留）；承载 Escape
  `onKeyDown` 的 div 保留，类名删除。新增断言 "every rendered class has a rule of its own" 防复发。
- 无"定义了但未引用"的 JS 标识符；无测量专用的测试桩残留；`ResizeObserver`/`findPillRow`/`rowMetrics`
  只出现在**注释**里（测试在去注释代码上断言为零）。
- 惰性无害项（保留）：`.ollama-usage-dock` 的 `box-sizing:border-box`（无 padding/border）与 `align-items:center`（父行已居中）。
- 观察：被删的测量路径原本无测试覆盖 ⇒ 删除不会让断言变红，唯一回归（包含块）只能靠目视发现 ⇒ 现已用 CSS 断言钉住。

**详细面板的样式/宽度对比（改前 HEAD vs 现在）**：

| 规则 | 结果 |
|---|---|
| `.ollama-usage-panel` | **逐字节相同**：`position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%); box-sizing:border-box; width:min(360px,calc(100vw - 48px)); border-radius:12px; overflow:hidden; font-size:13px; line-height:20px; …` |
| `.ollama-usage-panelbody` | 逐字节相同 |
| 面板宽度 | **不可能变化**：`min(360px, 100vw - 48px)` 由视口决定；绝对定位元素有显式宽度，祖先宽度不参与 |
| 面板位置语义 | 包含块 = 持有 pill 的 `.ollama-usage-slot`（旧版：inline 模式下 slot 本身绝对定位；flow/hero 模式有 `position:relative` 复位规则 ⇒ 同一个"pill 大小的盒子"；现在：基类显式 `position:relative`）⇒ 中心轴与 `bottom` 基准与改前一致 |
| 回归期间 | 包含块上移到最近的定位祖先：`.wSkVaW_composerSeat{position:sticky}`（整行宽）或 `.wSkVaW_root{position:relative; overflow:hidden}` ⇒ 面板被移到别处并可能被裁切；**宽度仍为 360px/视口派生**，"看起来变大/变小"是位移+裁切的观感 |

结论：**样式与宽度均未变化**，变化只发生在"锚定到哪个盒子"，现已恢复原语义。

## 7. 真机复核清单（AC7，待执行）

- [ ] 重启 dsh（≥ `0.1.6-alpha.2`）+ 硬刷新页面。
- [ ] 使用中会话：用量 pill 与 `stats`/`ContextMeter` 是否**同一行**、间距是否 ~12px、窄屏是否挤压/换行。
- [ ] hero（新会话）：用量 pill 与 statusline 任务 pill 是否仍同行。
- [ ] 若机器上仍是旧版：确认降级表现为"自家居中一行"（这是预期，不是缺陷）。

### 6.1 回归与修复：详情面板不再出现在 pill 正上方（2026-09-21，用户目视发现）

- **现象**：点击 pill 后，详情面板不再贴在 pill 正上方。
- **根因**：面板是 `position:absolute`（`.ollama-usage-panel{bottom:calc(100% + 6px); left:50%; transform:translateX(-50%)}`），
  而它的**包含块**原本是 `position:absolute` 的 `.ollama-usage-slot`；删测量时把 slot 改成静态，
  面板于是向上爬到最近的定位祖先（composer 卡片 / 会话根），于是"弹窗位置整体变了"。
  这正是 spec 里 "Popovers inside a list seat" 那条 `root: position:relative` 规则的镜像：**删掉定位时会静默带走
  子元素的包含块**。
- **修法**：`.ollama-usage-slot{position:relative; display:inline-flex; …}` —— 一行，覆盖 dock 与 hero 两个表面；
  布局不变、不读任何 rect，仍不属于"测量"。
- **防回归**：新增断言 "the panel is anchored to the slot that holds the pill"（slot 必须 `position:relative`、
  panel 必须 `position:absolute` 且 `bottom:calc(100% + 6px)`）⇒ `npm test` = **44 + 32 + 10 + 6 = 92**；
  伪证检验：去掉 `position:relative` 恰好该断言失败（31/32）。

## 8. 复用事实

- 锚点一律 `display:contents`（renderer `ANCHOR_STYLE`）⇒ 排错先看**容器**，不要看座位目录的文案。
- 壳升级必须重测容器：本次 composer.dock 的容器在同一个 `kind`/`scope`/"Ambient entries…" 文案下换了实现。
- 探针（`.scratch/`，临时）：`jsx-skeleton.mjs`（按缩进打印 JSX 骨架，定位锚点父元素）、`dump-slot-catalog.mjs`、
  以及本次用到的 `grep -o '[.]uV2eYG_dock{[^}]*}'` 一类 CSS 规则提取。
- spec 已回写：`.trellis/spec/dsh-plugin-ollama-usage/frontend/seats.md` 新增
  "Anchor containers and geometry"（含两版容器对照与"不许测量进兄弟行"的硬规则）。
