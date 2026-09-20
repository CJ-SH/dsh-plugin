# implement.md — 执行清单（无指针会话显示工作区活动任务计数）

> 目标包：`dsh-plugin-trellis-statusline`（子模块）。设计：`design.md`；需求：`prd.md` R1–R5。
> 改动文件：`lib/index.js`、`lib/client.js`、四个测试 harness、`README.md`、`docs/design-notes.md`。

## 0. 前置

- [ ] `cd dsh-plugin-trellis-statusline && npm test`（基线绿，记录断言数）。
- [ ] `git status` 干净；确认 `.gitattributes` 的 LF 约定，改动保持 LF。
- [ ] 复读 `lib/index.js:201-247`、`lib/index.js:415-427`、`lib/client.js:184-197`、`:429-457`（本次改动的全部交点）。

## 1. host 半边（`lib/index.js`）

- [ ] `readTask()`：指针失败后改为 `(await readActiveNodes(cwd)).size` → `activeTasks > 0 ? { status:'workspace', activeTasks } : { status:'none' }`。
- [ ] **删除** `scanTasks()`、`RUNNING_STATUSES`、`statusRank()` 及其专属注释/常量（`:42`、`:229-247`）。
- [ ] 保留并确认仍是唯一标题来源：`readPointedTask()` → `parseTask()`；树相关函数不动。
- [ ] 顶部模块注释与 `readTask` 的 JSDoc 更新为新契约（三种 reply；`workspace` 不带 title）。

## 2. client 半边（`lib/client.js`）

- [ ] 词典：`zh['workspace.count'] = '工作区 {n} 个活动任务'`、`en['workspace.count'] = '{n} active task(s) in workspace'`（键集以中文为准）。
- [ ] `decodeWorkspace(value)`：`status === 'workspace'` + `Number.isSafeInteger(activeTasks)` + `> 0` → 数字，否则 `null`。
- [ ] 状态：`count`；fetch 回调里 `task/count` 互斥设置；sessionId 变化时都清空。
- [ ] 渲染：`task` 分支不变；新增 `count` 分支——`span.trellis-statusline-pill[data-kind=workspace]`，
      文本 `formatCount(say('workspace.count'), count)`（一行 `replace('{n}', String(n))`），无角色/无 chevron/无点击。
- [ ] 空态保持 `task === null && count === null → null`。
- [ ] CSS：仅加必要的 `[data-kind="workspace"]` 钩子（若需要），不动既有选择器。

## 3. 测试

- [ ] `test/host.test.mjs`：删除扫描排序/branch 用例；新增——
      无指针 + 3 任务 → `{status:'workspace',activeTasks:3}`；0 任务 / 无 `.trellis` → `none`；`archive` 不计；
      破损 `task.json` 不计；指针存在 → `ok` 且与旧断言逐字段一致；**断言 `workspace` reply 里没有 `task`/`title` 字段**。
- [ ] `test/client.test.mjs`：词典双语含 `{n}`；`decodeWorkspace` 拒绝 0/负/非整数/`ok`/缺字段。
- [ ] `test/cell.test.mjs`：计数 pill 是 `span`、无 `tabindex`、无 `aria-haspopup`、点击不展开菜单；
      zh/en 两种文本；`count` 与 `task` 同时为 null → `null`；有 `task` 时形态与今天逐字节一致。
- [ ] `test/integration.test.mjs`：真 host 对无指针会话读真 `.trellis` → `workspace` reply → 喂真 cell → 计数 pill。

## 4. 自检

```bash
cd dsh-plugin-trellis-statusline
node --check lib/index.js && node --check lib/client.js
npm test
```

- [ ] 全绿；断言数不低于基线（删掉的扫描用例由计数用例补上）。
- [ ] 伪证检验：把 host 半边临时还原到 HEAD、保留新用例 → 新用例必须失败；恢复后全绿。

## 5. 文档

- [ ] `README.md`：pill 形态表加第 4 形态（`工作区 N 个活动任务`）；"Where the task comes from" 改为
      "会话指针（唯一来源）+ 无指针时的计数"；故障排查把"显示错误任务"改写为"只看到计数 ⇒ 本会话没有指针
      （检查 `task.py current --source`；身份链路见 dsh-plugin-ptc-bash 的 DSH_* 说明）"。
- [ ] `docs/design-notes.md`：§2.1/§2.2 的解析规则改写；删掉扫描/rank/branch 的推导记录，保留"为什么删"的一段。

## 6. 落地与真机验收

- [ ] **重启 dsh**（host 半边）→ **硬刷新页面**（client bundle）。
- [ ] ecms 里**新开**一个会话（无指针）→ 期望 `工作区 3 个活动任务`（bootstrap + 09-18 + 09-20）；空白会话（hero）同样应出现。
- [ ] `aa509ce8` / `703aabd3` 两个有指针会话 → 期望仍是各自的 `[P?] 标题 · 状态 · 角色`。
- [ ] 记录三条输出/截图到 PRD（AC3 需要用户目视；hero 表面若仍不画，另开缺陷）。

## 7. 收尾

- [ ] `git status` 仅含上述文件；**不自动提交**（AGENTS.md：提交/推送等用户明确同意）。
- [ ] 归档前检查：PRD AC1–AC5 全部有对应结果；`.scratch/` 临时脚本清理或声明保留。

## 风险与回滚点

| 风险 | 应对 |
|---|---|
| 计数口径与用户预期不符（含 bootstrap） | PRD R3 已写死"对齐 Claude、含 bootstrap"；真机验收时一眼可见，可一键改为排除 |
| 旧客户端配新 host（未刷新页面） | wire 只增；旧客户端把 `workspace` 当未知形态 → 渲染空（等价今天），不会画错 |
| 删除扫描后，身份链路再次坏掉时"只剩计数" | 这是选项 A 的既定代价；排查入口写进 README；ptc-bash 的 DSH_* 修复已上线 |
| 计数带来额外 `readdir`/`readFile` 成本 | 复用 `readActiveNodes`（每次轮询一次，与建树同量级；仅无指针会话走这条） |
