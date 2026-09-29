# implement.md — 执行清单（移除 composer.dock 测量路径）

> 目标包：`dsh-plugin-ollama-usage`（子模块）。设计：`design.md`；需求：`prd.md` R5–R7 / AC5–AC7。

## 0. 前置

- [ ] `cd dsh-plugin-ollama-usage && npm test`：基线 **44+29+10+6 = 89** 断言全绿，记录之。
- [ ] `dsh --version` = `0.1.6-alpha.2`（记录；若机器上仍是旧版，真机步骤走"降级预期"分支）。
- [ ] 复读交点：`lib/client.js:26-75`（常量 + CSS）、`:285-300`（`samePlacement`）、`:336-410`（测量助手 + `useIsoLayoutEffect`）、
      `:530-560`（`measureDock`）、`:661-760`（`DockEntry`）。

## 1. 删测量（`lib/client.js`）

- [ ] 删 `INLINE_GAP_PX`（`:43`）。
- [ ] 删 `resolveBox` / `narrowToContent` / `findPillRow` / `composerOutlet` / `measureDock` / `samePlacement` / `useIsoLayoutEffect`。
- [ ] CSS：`.ollama-usage-dock` 改为一条普通流式项规则
      （如 `box-sizing:border-box; display:inline-flex; align-items:center; min-width:0; max-width:100%`）；
      **删除** `.ollama-usage-slot{position:absolute;…}` 与两条 `[data-flow]` 规则；
      **保留** `.ollama-usage-dockline` 与 `[data-slot="conversation.input.dock"]{…row wrap…}`。
- [ ] `DockEntry`：去掉 `slot` holder、`align` state、`useIsoLayoutEffect`、`ResizeObserver`/视口监听、
      `data-flow` 与 `slotStyle`；渲染保持 `.ollama-usage-dock > .ollama-usage-slot > pill`。
- [ ] 模块头注释改写：记录"测量已删"的理由（新壳行容器 + 旧版降级）与版本要求。

## 2. 测试

- [ ] `test/client.test.mjs`：删除 inline/坐标相关断言；新增**无测量**断言——
      dock 规则不含 `height:0`/`position:absolute`、样式表里不再出现 `data-flow` 坐标、源码无 `ResizeObserver` 注册；
      **保留** `[data-slot="conversation.input.dock"]{…flex-flow:row wrap…}` 与 `.ollama-usage-dockline` 的断言。
- [ ] `test/hero.test.mjs`：保留"dock 挂载时 hero 不出现 / dock 卸载后 hero 出现"；若 harness 有监听计数，补"不注册 ResizeObserver/视口监听"。
- [ ] `node --check lib/client.js`；`npm test` 全绿且断言数 **≥ 89**。
- [ ] **伪证检验**：临时把测量路径加回 → 新断言必须失败；移除后全绿。

## 3. 真机（AC7）

- [ ] 重启 dsh + 硬刷新页面。
- [ ] 使用中会话：用量 pill 与 `stats`/`ContextMeter` 胶囊是否**同一行**、间距是否 12px、窄屏是否挤压/换行。
- [ ] hero（新会话）页面：用量 pill 与 statusline pill 是否仍同行（`.ollama-usage-dockline` 路径）。
- [ ] 观察结果（文字或截图）记录到结论文档与 PRD。

## 4. 文档与 spec

- [ ] `README.md`：席位/行为表改写——同排由壳负责（≥0.1.6-alpha.2）、旧版降级为自家一行、删除"测量/内联"描述。
- [ ] `docs/design-notes.md`：记录旧方案（测量 + `findPillRow`）→ 新方案（壳的行容器）的理由、版本与代价。
- [ ] `.trellis/spec/dsh-plugin-ollama-usage/frontend/seats.md`：加"锚点容器与几何变量"小节 + composer.dock 行容器版本注记。

## 5. 结论文档（AC1–AC4）

- [ ] `research/dock-seats-difference.md`：对照表、版本差异（0.1.5-rc.2 → 0.1.6-alpha.2）、债务判定、本次替换记录与真机观察。

## 风险与回滚点

| 风险 | 应对 |
|---|---|
| 新版三颗粒子拥挤/换行 | 真机观察；必要时收紧 pill 文案或加 `min-width:0` |
| 旧版观感降级 | 有意为之，写进 README/design-notes |
| 断言写成同义反复 | 伪证检验：加回测量必须失败 |
| 回滚 | 单文件改动，回退子模块那一笔提交即可 |
