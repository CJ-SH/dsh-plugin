# Design — ptc-bash 0.2.1 适配与持久 bash 执行器

## 1. 边界

| 项 | 决定 |
|---|---|
| 改动位置 | `dsh-plugin-ptc-bash/presets/ptc-bash/dsh-bash-win.mjs`（agent-plane row）+ `agent.cordis.yml` 一行 + 测试/文档 |
| 不改 | 宿主 composition、`workspace-instructions.mjs`、profile、`package.json` peer 范围、版本号 |
| 依赖服务 | `ctx.subprocess` / `ctx.tools` / `ctx.systemPrompt` / `ctx.shellEnv`（已有），`ctx.get('sandboxPolicy')`（可选） |
| 生效方式 | 预设定义在宿主启动时读取 → 改完必须重启 `dsh web`，且只影响新开会话 |

已验证的宿主 API（0.2.1-rc.2）：

- `sandboxPolicy.resolve({ session })` 返回带 `.mode` 的 policy，会话自身 `sandbox/mode` 优先于部署默认（`dsh-sandbox-policy/lib/index.js:141`；`sandbox-policy` 服务同时会用自己的 context 渲染模式说明，`:127`）。
- `agent/disposed` 事件 payload 为 `{ agent }`（`dsh-agent/lib/index.js:552`、`dsh-agent-loop/lib/index.js:1663`）。
- `ctx.subprocess.spawn` 的 stdio collect 只保留**有界内存尾部**，越界读取 `lossy` 并给 `spillPath`（`dsh-subprocess/README.md:59,109`）；`env` 是"剥掉凭据与 `DSH_*` 之后的叠加"（README:80）。
- `handle.stdin.write(...)` 可写（`win_bash` 用同一 API：`lib/index.js:1220`）。

## 2. 结构

```
apply(ctx, config)
├─ SandboxGate       读 session policy → serves / refuses / unknown
├─ ShellRegistry     Map<Agent, Shell> + 每 shell 一个串行队列
└─ 工具注册          bash + tool:bash 段
```

### 2.1 Shell 状态机

```
starting ──握手成功──▶ idle ──execute──▶ busy ──完成──▶ idle
    │                   │                  │
    └──失败/超时/中断────┴──────────────────┴──▶ dead（下一次调用重建）
```

- **启动**：`argv: [bash, '--norc', '--noprofile', '-s']`，`cwd` = 会话 cwd，`stdio.stdin = 'pipe'`，stdout/stderr 用 `{ maxBytes: SHELL_TAIL_BYTES, spill: { maxBytes: SHELL_SPILL_BYTES } }`，`env` = `ctx.shellEnv.collect(exec)` 的 overlay（在启动时取一次；shell 按 agent 键控，`DSH_SESSION_ID` 在 shell 生命周期内稳定）。
- **握手**：写一帧 `printf '\n%s%s\n' '<token>' "$BASH_VERSION"`，等 token + 非空版本号；超时/失败 → `terminate()` + 报错（错误里带上解析到的 bash 路径）。
- **串行**：同一 shell 的命令排队（promise 链）；超时从"拿到队列"开始算，排队等待也算在调用方预算内。
- **清理**：`ctx.on('agent/disposed', ({ agent }) => terminate(agent))`；`ctx.effect(() => () => closeAll())` 兜底插件卸载。

### 2.2 帧协议

```bash
printf '\n%s\n' '<BEGIN>'
. /dev/stdin <<'<END>'
<command>
<END>
__dsh_ptc_bash_status=$?
printf '\n%s%d\n' '<END>' "$__dsh_ptc_bash_status"
```

- marker：`__dsh_ptc_bash_<uuid>_begin` / `_end`，每次调用新生成；解析取 "第一个 BEGIN 之后、最后一个 END"，exit code 取 END 后的十进制。
- 用 heredoc 包住命令的原因：多行命令、未闭合引号/`if` 不会把 epilogue 吞进续行状态；`.` 的 stdin 是 heredoc，命令里的 `read` 也不会吃掉协议流。
- 来源声明：heredoc-sourcing 技巧独立重写自 `@linxin666/dsh-win-bash`（Apache-2.0）的 `buildFrame`；**若最终实现与其逐字相同，必须在 `NOTICE`/`LICENSES/` 记账**，否则按独立实现记录。
- 已知边界（写进 tool 描述）：`exit` 会杀死 shell；等待 stdin 的交互式命令会一直等到 `timeoutMs`；两者都触发重置。

### 2.3 读取、截断、spill

- 每流维护 `cursor`（整字节偏移）；命令执行期间每 ~10 ms `readFrom(cursor)` 一次并累加，避免"跑完再读"撞上内存尾部窗口。
- `lossy` 时用 `read.spillPath` 扫描该帧（从上次 cursor 起找 BEGIN/END），并在结果中给 `stdoutSpillPath` / `stderrSpillPath`。
- 可见预算 `maxOutputBytes`（默认 64000）在工具层按 UTF-8 安全截断，**保留尾部**，置 `stdoutTruncated` / `stdoutLostHead`；stderr 同理。
- stderr 不做帧标记：END 出现后读一次从上次 cursor 到当前末尾的增量；已知竞态（END 之后才 flush 的 stderr 可能落到下一次调用）记录在文件头。

### 2.4 沙箱门禁（R2）

```
service 不存在        → unknown   → 放行 + warnOnce（A1）
session/header.cwd 缺失 → refuses
resolve({session}).mode === 'danger-full-access' → serves
其他 mode / resolve 抛错 → refuses
```

- 判定在"取 shell / spawn"之前；`refuses` 时不创建任何进程。
- 错误文案：`SANDBOX_UNSUPPORTED: <mode>; the pinned MSYS2 bash cannot start under a restricted token. Use pwsh instead…`

### 2.5 workdir（D1）

- `workdir` → 帧体前缀 `cd -- '<normalized>' && `。
- normalize：相对路径按 `exec.agent.session.header.cwd` resolve；`\` → `/`；前导 `~` 展开为 `homedir()`；单引号 `'` → `'\''`。
- 不带 `workdir` → 不前缀，沿用 shell 当前目录。

### 2.6 后台任务

- 保留现有独立 `bash -c` 进程 + `ctx.jobs` 注册；不经过会话 shell（会话 shell 会被超时/中断 terminate，`&` 子进程会陪葬）。
- 相同的 env overlay、相同的 `run_in_background` 参数、相同的 job id 语义。

### 2.7 结构化结果（R4）

`output.schema`（`additionalProperties: false`，`required: ['text']`）：

```
text, jobId?, stdout, stderr, exitCode, timedOut,
stdoutTruncated, stderrTruncated, stdoutLostHead, stderrLostHead,
stdoutSpillPath?, stderrSpillPath?
```

- `text` 仍是唯一渲染源，`render` 保持现有排版（stdout → `[stderr]` → 标记行）。
- `exitCode` 在超时/被杀时为 `null`，文本仍带 `[timed out after Nms]` / `[killed by signal: S]`。

### 2.8 提示词与描述

- `tool:bash` section 改为：首选 shell；**状态跨调用持久**；超时/中断会重建 shell；后台作业是独立进程；非 full-access 会话不可用。
- tool description：删除 "State does NOT persist"，写清 `workdir` 会持久改目录、沙箱限制、截断语义。

## 3. 兼容性

- 配置键不变：`bashPath` / `timeoutMs` / `maxTimeoutMs` / `maxOutputBytes` / `enableRunInBackground`（A4）。
- 预设行 id / 文件名不变，因此 `composition*.test.mjs` 的 row 断言不受影响；`plugins.test.mjs` 中 `argv: ['-c', …]`、`stdio.stdout.maxBytes` 等断言必须更新。
- 0.2.0 已知影响：删除 persona suffix 后，若 0.2.0 没有 `working-directory` 上下文，模型将不再看到 cwd 行（未验证）。本任务不调整 peer 范围，记入风险。

## 4. 风险与权衡

| 风险 | 处理 |
|---|---|
| 持久 shell 污染状态（export/alias）影响后续调用 | 需求本身；工具描述写明；超时/中断提供重置路径 |
| 并发工具调用排队导致超时 | 串行队列 + 超时从入队开始计；文档说明 |
| 命令输出超过内存尾部导致帧标记丢失 | 执行期间轮询读取；`lossy` 时从 spill 恢复 |
| `. /dev/stdin` heredoc 在较老 Git Bash 上的行为 | 启动握手会真实跑一帧；失败即报明确错误，不静默降级 |
| stderr 与 END 标记的竞态 | 已知限制，写入文件头与文档 |
| 未验证 0.2.0 的 cwd 上下文 | 记录为已知影响，不在本任务扩范围 |

## 5. 回滚

- `dsh-plugin-ptc-bash` 是独立 git 仓库且工作树干净：回滚 = `git checkout -- presets/ptc-bash/agent.cordis.yml presets/ptc-bash/dsh-bash-win.mjs`（不额外复制 `backups/`，避免重复备份）。
- 无数据迁移、无 profile 改动；回滚后重启 `dsh web` 即恢复旧预设。

## 6. 验收映射

| AC | 实现点 | 测试 |
|---|---|---|
| AC1 | R1 删 suffix | 装配冒烟（人工，重启后新建会话） |
| AC2 | 2.4 门禁 | 单测：refuses 时不 spawn |
| AC3 / AC3b | 2.1 持久 shell / 2.5 workdir | 单测：连续两帧共享状态；`workdir` 后下一帧仍在目标目录 |
| AC4 | 2.7 结构化结果 | 单测：字段齐全 + `text` 渲染 |
| AC5 | 2.6 独立进程 | 单测：后台 spawn 不经会话 shell |
| AC6 | 启动时 overlay | 单测：spawn spec 带 `DSH_SESSION_ID` |
| AC7 | 测试记录 | `npm test` 输出 + 已知红名单 |
