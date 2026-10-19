# Implement — ptc-bash 0.2.1 适配与持久 bash 执行器

## 前置

- [x] 用户批准 PRD + design（2026-10-19「开始」）
- [x] `python ./.trellis/scripts/task.py start 10-19-ptc-bash-021-persistent-bash`（degraded：本会话没有 Trellis 会话身份，指针未落盘）
- [x] 确认 `dsh-plugin-ptc-bash` 工作树干净（回滚依赖 git）

## 步骤

### 1. R1 崩溃修复
- [x] 删 `presets/ptc-bash/agent.cordis.yml` 的 `suffix` 行
- [x] 修注释（不再声称 `{{cwd}}` 可解析），保留 `{{model}}` 说明
- [x] 不动预设行表（F5 明确排除），`preset.test.mjs` 的 roster 断言保持不变
- [x] 预设内现只剩 `{{model}}` 与 `{{workspace_instructions}}`，二者都在 0.2.1-rc.2 的注册表里

### 2. 执行器纯函数
- [x] `buildFrame(command, marker, workdir)` + `markerFor()`
- [x] `parseFrame(text, marker)` → `{ stdout, exitCode, frameStartFound }`
- [x] `normalizeWorkdir(value, sessionCwd)` + `shellQuote(value)`（`~` 展开、`\`→`/`、单引号转义）
- [x] `truncateVisible(text, maxBytes)`（UTF-8 安全、保留尾部、返回 lostHead/truncated）
- [x] `resolveServing(read, session)` → `serves | refuses | unknown`

### 3. Shell 生命周期
- [x] 按 agent 键控的状态表 + 每会话串行队列，`dead` 后重建
- [x] 启动 + 握手（真实跑一帧，验证 `. /dev/stdin` heredoc 可用）
- [x] 执行：入队 → 写帧 → 轮询读（10 ms）→ 解析 → 更新 cursor → 渲染
- [x] 超时 / 中断：`terminate()` + 标记 `dead` + 结果写明"下一次调用是新 shell"
- [x] `agent/disposed` 清理 + `ctx.effect` 兜底 closeAll

### 4. 沙箱门禁
- [x] `execute` 最前面解析 `ctx.get('sandboxPolicy')`
- [x] `refuses` 时不 spawn；`unknown` 放行 + `warnOnce`
- [x] 错误文案包含 mode 与 `pwsh` 替代路径

### 5. 结构化结果
- [x] `output.schema` 增字段，`required` 仍只有 `text`
- [x] `render` 保持现有文本排版与标记
- [x] 后台路径回填 `jobId`，现有 job 测试全部保留

### 6. 提示词 / 描述 / 文档
- [x] `tool:bash` section 文案改为持久语义
- [x] tool description：持久状态、`workdir` 持久改目录、沙箱限制、截断保留尾部
- [x] `README.md` / `README.zh.md` / `docs/design-notes.md` / `NOTICE` 同步
- [x] `workspace-instructions.mjs` 与 `tools/derive-preset.mjs` 的「官方 persona 已渲染 cwd」表述改正
- [x] 帧协议按独立重写记账到 `NOTICE` 与 `docs/design-notes.md`

### 7. 测试
- [x] 重写 `test/plugins.test.mjs`：fake `bash -s`（stdin 帧 → 输出）、`argv` 断言改为 `['-s']`
- [x] 覆盖 AC2/AC3/AC3b/AC4/AC5/AC6 + 超时、中断、`agent/disposed`、帧解析、UTF-8 截断
- [x] `composition.test.mjs` 的行号断言随注释行数更新（`line 31` → `line 33`）
- [x] `composition-health.test.mjs` 未改动（F5 两项红保持原样）

## 验证记录（2026-10-19）

```text
node --check presets/ptc-bash/dsh-bash-win.mjs   → OK
node --test test/plugins.test.mjs                → 25/25 pass
npm test                                         → 70 tests, 68 pass, 2 fail（均为 F5 已知项）
   ✖ declares a peer range the installed runtime admits   （结果形状 .peers → .requirements）
   ✖ differs from the shipped ptc preset only by the rows   （行表漂移，Out of Scope）
add: 运行时装机校验器的回归用例（`assertObjectJsonSchema` / `assertSupportedJsonSchema` +
     4 组结果值过 `validateJsonSchemaValue`）
add: 真实执行结果的输出校验（foreground / timeout / background 三种形状，装机校验器全部通过）
```

实现期间自查修掉的两处（都会在真实宿主里直接炸）：

1. 输出 schema 的 `exitCode` 原写成 `type: ['integer','null']` —— 运行时的 JSON-Schema 子集
   **拒绝 type 数组**（`dsh-tools` 的 `assertSupportedJsonSchema`），注册即失败；改为 `oneOf`。
2. `finalize` 把 `signal` 放进了结构化返回值，但 schema 是闭合属性集（`additionalProperties: false`），
   每次调用都会被输出校验拒绝；`signal`/`timeoutMs` 现在只参与文本渲染。

只读 review（子代理）结论与处置：

- 采纳：插件卸载/会话销毁时队列中的调用仍可能 spawn 一个不再被 `states` 跟踪的 shell →
  新增 `disposed` 标志 + disposer 逐个置 `closed`，`ensureShell` 直接拒绝；新增用例。
- 采纳：超时/`exit` 路径的 partial 捕获若切在 BEGIN 内部，marker 残片会漏给模型且无截断标记 →
  `framePartial()` 现在识别残片并返回 `lostHead`，两条路径都据此打截断标记；新增纯函数用例。
- 不采纳（记录理由）：`states` 强引用 Map 只在 `agent/disposed` 时删除——预设模块是**按会话挂载**的，
  会话结束即插件卸载，disposer 必跑；`agent/disposed` 只是额外保险。
- 已记录：会话运行中切到受限模式时，`refuses` 分支会关闭已有 shell（在飞命令随之中断）——这是有意的
  策略收紧，已写进 `docs/design-notes.md`。

真实 Git Bash 冒烟（同一份 `buildFrame`/`parseFrame`，`bash 5.3.15`，脚本已删除）：

```text
handshake 0 · hello · cd+pwd · pwd 持久 · export 持久 · function 持久 · 多行命令
false→exit 1 · 带 workdir 的 cd 持久 · stderr 捕获 · 未闭合 if 被 heredoc 救回（exit 2）
exit 7 → shell 退出且无 end marker（对应 SHELL_EXITED 路径）
ALL CHECKS PASSED
```

## 人工确认

> 2026-10-19：用户手动验证通过，可以归档。代码改动在 `dsh-plugin-ptc-bash` 子模块内，归档前需先按 Phase 3.4 提交（finish-work 的前置条件）。

原验收清单（已由用户手动走完）：

1. 重启 `dsh web`，新建会话选 `PTC + Bash 模式` → 不再出现 `unknown prompt variable`（AC1）。
2. 同一会话 `pwd` → `cd /tmp && pwd` → 再 `pwd`（AC3）；带 `workdir` 再验一次（AC3b）。
3. 受限会话调 `bash` → `SANDBOX_UNSUPPORTED` 且无子进程（AC2）。
4. 后台 `sleep` + `job_output`（AC5）。

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `presets/ptc-bash/dsh-bash-win.mjs` | 整体重写，最大风险 | `git checkout --` 该文件 |
| `presets/ptc-bash/agent.cordis.yml` | persona suffix 删除 | 同上 |
| `test/plugins.test.mjs` | 断言大改 | 同上 |
| `NOTICE` / `README*.md` / `docs/design-notes.md` | 纯文档 | 同上 |

回滚后必须重启 `dsh web`；无 profile / 数据迁移。

## 开工前复查

- [x] 确认 `sandboxPolicy.resolve` 仍存在（本机 0.2.1-rc.2，`dsh-sandbox-policy/lib/index.js:141`）
- [x] 确认 PRD 的 F5 两项红仍被显式记录，未被测试改动"顺手修绿"
- [x] 确认未把 peer 范围、行表、payload、pwsh 撤下混入本次改动
