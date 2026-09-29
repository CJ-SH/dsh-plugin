# design.md — 移除 composer.dock 的测量路径（ollama-usage 客户端半边）

> 任务 `09-20-dock-seats-difference`（用户 2026-09-21 选定范围 C：文档 + 真机复核 + 落地替换）。
> 需求见 `prd.md` R6/R7、AC6/AC7。

## 1. 问题与目标

dsh `0.1.6-alpha.2` 给 `conversation.composer.dock` 加了专用横向行容器
（`.uV2eYG_dock{justify-content:center; align-items:center; gap:12px; max-width:100%; padding-top:4px; display:flex}`，
渲染点 `dsh-client-ui-conversation/lib/client.js:16459-16465`）。而 `dsh-plugin-ollama-usage` 的 dock entry 仍是
`height:0` + 绝对定位 + `findPillRow` 测兄弟行的自研方案（`lib/client.js:56-61`、`:352`、`:535-549`、`:676-718`）——
它既要与内置 `StatsPills` 同排，就会和新容器的布局叠加，预期出现挤占/重叠/间距翻倍。

目标：**让壳负责同排**，把测量路径整条删掉，使两版 dsh 都得到正确（而非相同）的结果。

## 2. 边界

| 改 | 不改 |
|---|---|
| `dsh-plugin-ollama-usage/lib/client.js`（客户端半边） | host 半边 / wire / 路由 / settings |
| `test/client.test.mjs`、`test/hero.test.mjs`（断言） | `dsh-plugin-trellis-statusline`（只用 header + input.dock） |
| `README.md`、`docs/design-notes.md` | 壳与任何 `@deepseek-ai/*` 包 |
| `research/dock-seats-difference.md`、`seats.md` 回写 | 提交/推送（需用户同意） |

## 3. 改动契约（删什么 / 留什么）

**删除**（全部在 `lib/client.js`）：

- 常量 `INLINE_GAP_PX`
- 测量助手：`resolveBox`、`narrowToContent`、`findPillRow`、`composerOutlet`、`measureDock`、`samePlacement`、`useIsoLayoutEffect`
- `DockEntry` 内的 `slot` holder、`align` state、`useIsoLayoutEffect` 测量 effect、`ResizeObserver` 与视口监听、
  `data-flow` 属性、`slotStyle`（inline `left/top`）
- CSS：`.ollama-usage-dock{width:100%;height:0;position:relative;pointer-events:none}`、
  `.ollama-usage-slot{position:absolute;left:0;top:0;transform:translateY(-50%);…}`、
  `.ollama-usage-dock[data-flow="true"]{…}`、`[data-flow="true"] .ollama-usage-slot{…}`

**保留**：

- `.ollama-usage-dockline` 与 `[data-slot="conversation.input.dock"]{display:flex !important; flex-flow:row wrap; …}`
  （hero 与 statusline 共用一行，仍必要：`.composerStack` 仍是纵向栈）
- pill / panel / 菜单 / 图标全部样式与交互（面板仍是自身 CSS 的绝对定位，不依赖测量）
- 轮询、状态机、`heroVisible()` 相位规则、`markDockMounted`/`acquire`/`release` 全部行为

**改动后的 DOM**（composer dock）：`div.ollama-usage-dock > span.ollama-usage-slot > button.ollama-usage-pill`，
两级都是普通流式项（`display:inline-flex`），不再有 `height:0` / 坐标 / `pointer-events` 技巧。

## 4. 兼容与降级（不做版本探测）

| dsh 版本 | composer.dock 的父容器 | 结果 |
|---|---|---|
| ≥ `0.1.6-alpha.2` | `.uV2eYG_dock`：`flex; gap:12px; justify-content:center` | 与 `StatsPills`、`ContextMeter` **同行**，间距由壳给 |
| `0.1.5-rc.2` | `.uV2eYG_root`：`flex-direction:column; align-items:center` | **自家居中一行**（等价于今天的 `flow` 回退） |

两版都"正确"，只有观感差异 ⇒ 不引入版本判断（也避免依赖未公开的版本 API）。旧版是**有意降级**，写进 README。

## 5. 权衡与风险

| 风险 | 应对 / 说明 |
|---|---|
| 新版行容器下三颗粒子拥挤、窄屏换行 | 真机观察（AC7）；必要时给 `.ollama-usage-dock` 加 `min-width:0` / 文案省略（pill 已有 `max-width:100%` 与 label ellipsis） |
| 旧版从"贴 stats 右侧"变为"自家一行" | 有意降级；README 与 design-notes 写明 |
| 删掉的是"看起来能自适应"的代码 | 断言证明测量确已消失 + 伪证检验（加回则失败） |
| 面板定位 | 面板是自身 CSS（`position:absolute; bottom:calc(100% + 6px); left:50%`），与测量无关，不受影响 |

## 6. 回滚

改动集中在 `dsh-plugin-ollama-usage` 单文件 + 测试/文档；回滚 = 回退该子模块的那一笔提交
（`git -C dsh-plugin-ollama-usage revert <commit>`），无数据/迁移成本。
