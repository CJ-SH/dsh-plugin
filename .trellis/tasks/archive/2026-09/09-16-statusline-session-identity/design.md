# design.md — dsh-bash-win 注入 dsh 会话身份（DSH_*）

> 关联需求：PRD R1（会话身份可用，根因）。本设计只覆盖 R1；状态栏兜底行为（R2/D1）不在其中。

## 1. 目标与边界

**目标**：让 `ptc-bash` 预设的 `bash` 工具（`dsh-bash-win`）像官方 shell 工具一样，把 dsh 每次执行的 shell
环境事实注入 Git Bash 子进程，使 `python ./.trellis/scripts/task.py create|start` 不再进入 Trellis 降级模式、
恢复写 `.trellis/.runtime/sessions/dsh_session-<id>.json` 指针。

**边界（不改）**：`agent.cordis.yml` roster、Trellis 本体、statusline 插件、第三方 `liangshen` 预设、
工具的沙箱/参数/输出语义。

## 2. 现状（代码事实，全部本机核对）

| 事实 | 锚点 |
|---|---|
| 工具直接 `ctx.subprocess.spawn(spawnSpec(signal))`，spawn spec **没有 env 字段** | `presets/ptc-bash/dsh-bash-win.mjs:263-269, 283, 326` |
| 工具不消费 shell 环境注册表 | 同文件 `:47` `inject = ['subprocess','tools','systemPrompt']` |
| subprocess 服务的 ambient 环境**主动剥掉所有 `DSH_*`**（Windows 名字大小写不敏感，避免"当前 DSH_* 事实"隐式泄漏） | `@deepseek-ai/dsh-subprocess/lib/index.js:51-55`；说明见 `lib/types/index.d.ts:16-42` |
| **唯一受支持的注入通道**是 spawn spec 的显式 `env`：合并到 scrub 后的父环境之上，"a forwarded ... current `DSH_*` fact survives the scrub" | `dsh-subprocess/lib/types/types.d.ts:90-96` |
| 官方做法：`ctx.shellEnv.collect(exec)` 按次执行现算 overlay | `dsh-tool-bash/lib/index.js:395`、`dsh-tool-pwsh/lib/index.js:373` |
| overlay 内容：`DSH_HOME`、`DSH_SHELL="1"`，以及 **仅当 `execution.agent !== undefined`** 的 `DSH_SESSION_ID`（+ 插件贡献者变量如 `DSH_WEB_URL`） | `dsh-shell-env/lib/index.js:80-96` |
| shell 执行器把 overlay 落在同一个 `env` 槽：`env: { ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv }` | `dsh-bash-local/lib/index.js:196-200` |
| 官方 `tool-bash` 在 win32 被 disabled ⇒ 本工具是 Windows 上唯一的 bash；同预设的官方 `tool-pwsh` 一直硬依赖 `shellEnv` | `dsh-agent-presets/presets/ptc/agent.cordis.yml:52-58` |
| 实测对照（本会话）：官方 pwsh → `DSH_SESSION_ID=session-4a220f8c-…`（经 `run_code`/PTC 亦如此）；自定义 bash → 一个 `DSH_*` 都没有 | PRD「进展快照」 |

## 3. 设计

### 3.1 数据流（一次 bash 调用）

```
execute(args, exec)
  → ctx.shellEnv.collect(exec)          # 每次执行现算；agent = 本次执行的会话（含子代理会话）
  → spawnSpec: { argv, cwd, stdio, graceMs, signal, env: overlay }
  → ctx.subprocess.spawn(spec)          # 服务先 scrub 父环境（含剥掉 DSH_*），再合并显式 env
  → Git Bash 子进程环境含 DSH_SESSION_ID / DSH_SHELL / DSH_HOME …
  → 子进程内 python task.py …           # Trellis resolve_context_key() 读到 DSH_SESSION_ID（表首 dsh 条目）
  → .trellis/.runtime/sessions/dsh_session-<id>.json 被写出（create/start 都会写）
```

### 3.2 唯一必改点（示意）

```js
export const inject = ['subprocess', 'tools', 'systemPrompt', 'shellEnv']   // ← +'shellEnv'

/** 取本次执行的 DSH_* overlay；任何异常/空结果都归一为 undefined（工具绝不因此挂掉）。 */
function collectShellEnv(ctx, exec) {
  try {
    const registry = ctx.shellEnv
    if (registry === undefined || typeof registry.collect !== 'function') return undefined
    const overlay = registry.collect(exec)
    if (overlay === undefined || overlay === null) return undefined
    return Object.keys(overlay).length === 0 ? undefined : overlay
  } catch {
    return undefined
  }
}

// execute() 内，spawnSpec 之前：
const shellEnv = collectShellEnv(ctx, exec)

const spawnSpec = (signal) => ({
  argv: [shell, '-c', args.command],
  ...(workdir !== undefined ? { cwd: workdir } : {}),
  stdio,
  graceMs: GRACE_MS,
  ...(shellEnv !== undefined ? { env: shellEnv } : {}),   // ← 唯一新增字段
  ...(signal !== undefined ? { signal } : {}),
})
```

- 前台与后台共用 `spawnSpec` ⇒ 一处改动覆盖两条路径（后台的 `exec` 已在闭包里，`:281` 已在用 `exec?.agent`）。
- overlay 为空时**不加** `env` 键 ⇒ 现有 spawn spec 逐字节不变，既有断言不受影响。

### 3.3 方案取舍（为什么不是别的做法）

| 备选 | 否决理由 |
|---|---|
| 读 `process.env` 自己拼 | ambient 里的 `DSH_*` 被 subprocess 服务剥掉；真实值本就是**每次执行现算**，父进程里未必存在 |
| `ctx.get('shellEnv')` 而**不**声明 inject | capability-scoped 代理下，未声明的服务读不到（静默 `undefined`）⇒ 必须进 `inject` |
| 改用官方 `ctx.shell`（ShellExecutor） | 会一并接管 sandbox 策略、工作目录推导、输出策略，改动面远大于缺陷本身，且违反"工具行为不变"约束 |
| 让插件 host 半边在 boot 时注入环境变量 | 那是进程级、非按执行；无法表达"哪个会话"，且会被 scrub |

**硬依赖风险评估**：`inject` 增加 `shellEnv` 后，若某 composition 缺 `dsh-shell-env`，本行不会 apply（agent 丢掉
Git Bash 工具）。但同预设、win32 生效的官方 `tool-pwsh` 早已硬依赖同一个服务 —— 缺它的部署里 pwsh 行同样已失效
⇒ **不引入新的失败类别**；代码里的 try/catch 再兜一层部分挂载。

### 3.4 兼容性与语义

- **dsh 版本**：本机 `0.1.5-rc.2` 具备 `ctx.shellEnv` 与 spawn spec `env`；README/工具头注释记录该依赖。
- **既有会话不受影响**：预设模块在会话（preset）挂载时加载 ⇒ 改动只对**改动后新开的会话/重启后**生效；老会话继续用旧模块。
- **子代理**：`exec.agent` 是子会话 ⇒ 子代理的 shell 拿到子会话 id（与官方工具一致）；Trellis 会给子会话写它自己的指针，属可接受行为。
- **Windows 大小写**：scrub 已处理 `dsh_*`；我们只写显式 `DSH_*`。
- **沙箱/审批**：完全不碰（本工具仍不经 sandbox 层，见其工具描述）。

### 3.5 落地与回滚

- **落地**：`node .scratch/land-sync.mjs` → 调用插件 host 半边的 `syncPresets()`，把 `presets/ptc-bash/**` 原子同步到
  `$DSH_HOME/.agent-presets/ptc-bash/`（内容比对、幂等，`test/sync.test.mjs` 覆盖）。重启 dsh 时 boot sync 也会做同样的事。
- **回滚**：还原 `presets/ptc-bash/dsh-bash-win.mjs` 后重跑 sync（目标目录由内容比对收敛）。改动仅影响新会话的 bash 工具，
  且单测可即时证伪；爆炸半径 = "bash 工具起不来"这一条，由 try/catch + 空-overlay 直通 + 既有用例兜底。
- **不可手改**：`$DSH_HOME/.agent-presets/ptc-bash/**` 是生成物，任何手改都会被下一次 sync 覆盖。

## 4. 验证矩阵

| 层 | 手段 | 期望 |
|---|---|---|
| 单测 | `npm test`（`test/plugins.test.mjs` 增用例） | inject 含 shellEnv；前台/后台 spawn spec 带 `env`；缺服务/抛错时仍能 spawn 且无 `env` 键 |
| 静态 | `node --check presets/ptc-bash/dsh-bash-win.mjs` | 通过 |
| 同步 | `cmp` 仓库源与 `$DSH_HOME/.agent-presets/ptc-bash/dsh-bash-win.mjs` | 一致 |
| 真机（**需新开会话**） | 自定义 bash：`env | grep '^DSH_'`；`resolve_context_key()`；一次性仓库里 `task.py create` | 依次得到 `DSH_SESSION_ID`、`dsh_session-<id>`、指针文件落盘 |
| 回归 | 官方 pwsh 的 `DSH_SESSION_ID` 对照；bash 既有行为（exit 标记/后台 job/workdir/超时）；statusline 显示本会话任务 | 不变/正确 |

---

## 5. R2/R3 设计（2026-09-17 追加；D1 已由用户定案为 (a)「什么都不显示」）

> 关联需求：PRD R2（不再误报）、R3（树的一致性）。R1 已真机验收通过（见 prd.md「真机验收」）。

### 5.1 目标与边界

**目标**：`task/read` 在**没有会话级证据**时不得返回任何任务 —— 即彻底移除"工作区扫描兜底"。会话级证据只有一条：
`<cwd>/.trellis/.runtime/sessions/dsh_<sessionId>.json` 指针，且它必须指向一个真实可读的 `task.json`。

**边界（不改）**：座位/样式/刷新节奏；树的建树逻辑（仍读全部 active 任务来还原父子结构，只是 `currentId` 改为只可能来自指针）；
RPC 信封与路由；Trellis 本体；`ptc-bash`（R1 已落地，不再动）。

### 5.2 行为定义（改前 → 改后）

| 场景 | 改前 | 改后 |
|---|---|---|
| 指针存在且任务可读 | 显示该任务（+ 结构树） | 不变 |
| 指针缺失 / 陈旧 / 越界 / 损坏 | **回落到工作区扫描**，把扫到的任务当成本会话任务（ecms 三会话实测即此类误报） | `{status:'none'}` ⇒ pill 不渲染 |
| cwd 不可解析（会话既不活、也不在任何工作区） | none | 不变 |
| `sessionId` 缺失或超长 | 400 | 不变 |

### 5.3 落点

- `lib/index.js`：`readTask()` 去掉 `?? (await scanTasks(cwd))`；删除随之死掉的 `scanTasks`、`statusRank`、`RUNNING_STATUSES`；
  同步改注释：文件头第 3 步、`contextKey` 的"scan takes over"、`readPointedTask` 的"loses to the scan"、`readTask` 的 JSDoc。
- `lib/client.js`：仅一处注释措辞（`STATE_KEYS` 里"只有前两种会被扫描"）；渲染路径不变 —— `value.status !== 'ok'` 本就不渲染。
- 测试：`test/host.test.mjs` 的扫描组改成"无指针 ⇒ none"（AC-S1），陈旧/越界/损坏指针同样断言 none；
  `test/cell.test.mjs` / `test/integration.test.mjs` 不动（它们喂的是 host 回复，不碰解析链）。

### 5.4 取舍

| 备选 | 否决理由 |
|---|---|
| 保留扫描但标注为"工作区级推测"（D1 选项 b） | 用户已选 (a)；标注要在 UI 引入第三种角色/样式，收益低于"宁缺毋滥" |
| 活会话事件推断（D2 选项 c） | 见 prd.md「待决策」：仅本次进程内活会话有效、启发式、耦合 dsh 内部事件形状、需读对话内容 ⇒ 记入后续任务候选，不在本次扩张 |
| 读会话日志文件推断 | 已实测多帧 zstd，Node 内置解码只出第一帧 ⇒ 不可行（同前） |

### 5.5 验证矩阵（追加）

| 层 | 手段 | 期望 |
|---|---|---|
| 单测 | `npm test`（host 组新增 AC-S1） | 有 running+started 任务但无本会话指针 ⇒ `{status:'none'}`；陈旧/越界/损坏指针 ⇒ none；指针组与树组回归绿 |
| 静态 | `node --check lib/index.js` / `lib/client.js` | 通过 |
| 真机 | `.scratch/probe-current-session.mjs`（真实 host 半边 + 真实 cwd） | 本会话（有指针）⇒ pill；伪造无指针会话 ⇒ `{status:'none'}` |
