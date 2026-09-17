# implement.md — 执行清单（dsh-bash-win 注入 DSH_*）

> 目标文件（唯一产品改动）：`dsh-plugin-ptc-bash/presets/ptc-bash/dsh-bash-win.mjs`
> 生成物（不手改）：`$DSH_HOME/.agent-presets/ptc-bash/**`（由 sync 覆盖）
> 设计依据：`design.md`；需求：`prd.md` R1。

## 0. 前置

- [ ] `trellis-before-dev`：读 `.trellis/spec/` 中与本包相关的层（若存在）。
- [x] 确认基线绿：`cd dsh-plugin-ptc-bash && npm test`（3 个测试文件全绿，作为回归基线）。
- [x] 确认工作区干净（基线干净；改动后 = 3 个预期文件，`.gitattributes` 固定 LF，已保持）。

## 1. 改工具（`presets/ptc-bash/dsh-bash-win.mjs`）

- [x] `inject` 增 `'shellEnv'`：`['subprocess', 'tools', 'systemPrompt', 'shellEnv']`（`:47`）。
- [x] 新增 `collectShellEnv(ctx, exec)`：try/catch + "空对象归一为 undefined"（见 design §3.2）。
- [x] 头注释补一段「Shell env (DSH_*)」：说明为什么必须走 spawn spec 的显式 `env`
      （`dsh-subprocess` 会剥掉 ambient `DSH_*`）、以及依赖 dsh ≥ 0.1.5 的 `ctx.shellEnv`。
- [x] `spawnSpec` 增 `...(shellEnv !== undefined ? { env: shellEnv } : {})`；确认**前台与后台**都经它
      （`:263-269` 定义、`:283` 后台、`:326` 前台）——两处都不需要单独改。
- [x] 不动：工具描述、参数 schema、`resolveShell`/`resolveWorkdir`、输出渲染、后台 job 逻辑。

## 2. 单测（`test/plugins.test.mjs`）

- [x] `makeCtx` 增可注入的 `shellEnv`（默认给一个固定 overlay，如
      `{ collect: (exec) => ({ DSH_HOME: 'C:/h', DSH_SHELL: '1', DSH_SESSION_ID: 'session-test' }) }`；
      用 `options.shellEnv` 允许覆盖/缺失）。
- [x] 断言 `bashWin.inject.includes('shellEnv')`。
- [x] 前台：`spawns[0].spec.env` 深等于 overlay；且 `argv/cwd/stdio/graceMs` 与既有断言一致（不回归）。
- [x] 断言 `collect` 收到的是本次 `exec`（用 `exec('D:/ws')` 做同一个对象引用比较）。
- [x] 后台（`run_in_background: true`）：spawn spec 同样带 `env`。
- [x] 降级：`shellEnv` 缺失、`collect` 抛错、`collect` 返回 `{}` 三种情形 → 工具仍注册、仍 spawn、
      spec **没有** `env` 键（`Object.hasOwn(spec, 'env') === false`）。
- [x] 保持 `test/preset.test.mjs`、`test/sync.test.mjs` 不改（roster 与同步语义未变）。

## 3. 自检

```bash
cd dsh-plugin-ptc-bash
node --check presets/ptc-bash/dsh-bash-win.mjs
npm test
```

- [x] 全绿；**29/29 pass**（基线 25/25），`node --check` 通过。

## 4. 落地到用户预设目录

- [x] `node .scratch/land-sync.mjs`（调用 host 半边 `syncPresets()`），确认输出 copied 含 `dsh-bash-win.mjs`。
- [x] `cmp` 仓库源与 `$DSH_HOME/.agent-presets/ptc-bash/dsh-bash-win.mjs` → 一致。

## 5. 真机验收（**需要用户新开一个 dsh 会话**，用 `ptc-bash` 预设；本会话仍挂旧模块）

- [x] 在**新会话**里经自定义 **bash** 工具：`env | grep -E '^DSH_'` → 必须出现 `DSH_SESSION_ID=session-<新会话id>`（`DSH_SHELL=1`、`DSH_HOME` 同时在）。
- [x] 同一会话经 **bash**：在某工作区里
      `python -c "import sys;sys.path.insert(0,'.trellis/scripts');from common.active_task import resolve_context_key;print(resolve_context_key())"`
      → `dsh_session-<新会话id>`（此前为 `None`）。
- [x] 端到端（一次性仓库 `.scratch/trellis-exp`，避免污染真实实例）：经 **bash** 跑
      `python ./.trellis/scripts/task.py create "E2E 身份验证" --description "verify DSH_SESSION_ID wiring" --slug e2e-identity`
      → 断言 `.trellis/.runtime/sessions/dsh_session-<新会话id>.json` 生成且 `current_task` 指向 `09-17-e2e-identity`；
      再看状态栏是否在 10s 内显示该任务（应为单任务形态，无角色）。
- [x] 回归对照：官方 **pwsh** 仍输出 `DSH_SESSION_ID`；bash 的 exit-code 标记、`workdir`、后台 job、超时行为抽查不变。
- [x] 记录：把三条命令与输出粘回 PRD「进展快照」。

## 6. 文档与收尾

- [x] `dsh-plugin-ptc-bash/README.md`：加「会话身份（DSH_*）」小节（机制、依赖版本、只对新会话生效）。
- [x] 记录已知边界：第三方 `liangshen` 预设的 `custom-bash.mjs` 同缺陷，需上报上游（不在本任务修）。
- [ ] **不自动提交**：git commit/push 必须等用户明确同意（AGENTS.md）；如需更新 meta 仓库子模块指针，另说。
- [ ] 任务归档前的检查：`prd.md` 的 AC 与本节验收结果对齐；`.scratch/` 临时脚本清理或声明保留。

## 7. R2/R3（状态栏兜底，2026-09-17 追加；D1=(a)）

- [x] `lib/index.js`：`readTask` 只走指针；删 `scanTasks`/`statusRank`/`RUNNING_STATUSES`；同步注释（文件头第 3 步、`contextKey`、`readPointedTask`、`readTask`）。
- [x] `lib/client.js`：`STATE_KEYS` 注释去掉"只有前两种会被扫描"的措辞（渲染路径不动）。
- [x] `test/host.test.mjs`：扫描组 → AC-S1（无本会话指针时即便有 `in_progress`+有 branch 的任务也返回 `{status:'none'}`）；陈旧/越界/损坏指针 → none；保留指针组与树组。
- [x] `README.md`：任务来源改为"cwd → 指针 → 无证据即空白"；删 branch 规则与"显示成工作区最新任务"的兜底叙述；troubleshooting 改写。
- [x] `docs/design-notes.md`：标注 2026-09-17 移除扫描兜底及其理由。
- [x] 自检：`node --check lib/index.js && node --check lib/client.js`；`npm test` 全绿。
- [x] 真机探针：`.scratch/probe-current-session.mjs` —— 本会话（有指针）出 pill；伪造无指针会话出 `{status:'none'}`。

---

## 风险与回滚点

| 风险 | 应对 |
|---|---|
| 工具起不来（最坏：新会话没有 bash） | 空-overlay 直通 + try/catch；单测覆盖降级；回滚=还原该文件 + 重跑 sync |
| 新会话未生效 | 先 `cmp` 确认已同步；确认新会话确用 `ptc-bash` 预设；必要时重启 dsh 让 boot sync 接手 |
| `env` 合并语义理解错 | 已按 `dsh-subprocess` types（`:90-96`）与 `dsh-bash-local`（`:196-200`）核对；真机验收直接看 `env` 输出 |
| 误改生成物 | `$DSH_HOME/.agent-presets/**` 只经 sync 更新；提交前 `git status` 核对仅源文件 |
