# design.md — dsh-plugin-ptc-bash

对应 PRD：`.trellis/tasks/09-16-ptc-bash-preset/prd.md`（R1–R14 / AC1–AC13）。本文只记实现级设计，决策理由见 PRD。

## 1. 边界

- 仓库 **`dsh-plugin-ptc-bash`**（本仓库的第三个 submodule）= 一个标准 dsh 插件包；宿主半边只做一件事：把包内 `presets/ptc-bash/**` 幂等同步到 `$DSH_HOME/.agent-presets/ptc-bash/`。
- 预设内容（组合 + 两个本地插件）全部在包内 `presets/ptc-bash/`，与 dsh 安装目录、内置 preset、别人的预设都无交集。
- 零 `@deepseek-ai/*` 运行时依赖（与另两个 submodule 同风格）；只用 node 内置模块。
- 不做 UI、不做命令、不写设置命名空间。

## 2. 仓库布局

```
dsh-plugin-ptc-bash/
├── package.json          # name=dsh-plugin-ptc-bash, type=module, main=lib/index.js,
│                         # files=[lib,presets,cordis.patch.yml,README.md,NOTICE,LICENSE],
│                         # dsh.bundle.patch=./cordis.patch.yml, scripts.test=node --test test/
├── cordis.patch.yml      # 一行 insert：id/name = dsh-plugin-ptc-bash
├── LICENSE               # MIT（作者 HenTaiCJN）
├── NOTICE                # 派生与出处声明
├── README.md             # 用途 / 安装 / 验证 / 迭代注意 / 回滚
├── lib/
│   └── index.js          # 同步插件（可测试的纯函数 + apply）
├── presets/ptc-bash/
│   ├── agent.cordis.yml          # 官方 ptc 复制 + 3 处改动（§3）
│   ├── preset.yml                # name/description/order
│   ├── custom-bash.mjs           # 派生自梁神 custom-bash.mjs（§4）
│   └── workspace-instructions.mjs# 派生自梁神 minimal-prompt.mjs（§5）
└── test/{sync,preset,plugins}.test.mjs
```

## 3. 预设编排：相对官方 PTC 的全部改动（3 处 + 注释）

1. **shell 区**（官方 `agent.cordis.yml:52-58` 位置）：

```yaml
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh                      # 官方行为不变：win32 备用 shell
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: custom-bash                    # 新增：win32 的 Git Bash
  name: ./custom-bash.mjs
  disabled: !!js process.platform !== 'win32'
```

2. **identity 区新增一行**（B1 插件）：

```yaml
- id: workspace-instructions
  name: ./workspace-instructions.mjs
  config:
    instructionMaxBytes: 65536
```

3. **文件头注释**：改写为「官方 `ptc` 的副本 + 上述改动清单 + MIT 出处」。

其余每一行（`tool-presentation`(`mode: ptc`)、`present`、`planning`/`compaction`/`delegation` 组、`command-goal`、`tool-goal`、`tool-web`(`fetch: true`)、`tool-subagent`(`modelSelectionSettings: true`)、`tool-ralph`、`tool-ask-user`、`tool-todo`、`tool-fs`、`tool-fs-search`、`skill-filesystem`、`tool-skill`、`tool-jobs`、`persona`、`agent-instructions`）逐字保留。

`presets/ptc-bash/preset.yml`：`name: PTC + Bash 模式`、`description: 官方 PTC 模式为底座：Windows 上以 Git Bash 为首选 shell（保留 pwsh 备用），并把 AGENTS.md 指令链放进系统提示词。`、`order: 5`。

## 4. `custom-bash.mjs`：派生自梁神版，两处改动

保留不动的语义：Git Bash 推断顺序（`git` 安装根 → `ProgramFiles`/`ProgramFiles(x86)`/`LOCALAPPDATA`/scoop 推导根 → PATH 兜底）、显式 `bashPath` 优先、`resolveExecutable` 备忘（失败不备忘）、`bash -c` 全新进程、`workdir` 回退 `exec.agent.session.header.cwd`、输出上限裁剪、超时/取消、非零退出以错误结果回报（携带输出 + exit code）、无兜底到 pwsh/cmd。

改动 1（描述，模型在 SDK 里直接读）：

```
Run commands in a bash shell (Git Bash on Windows). This is the PREFERRED shell on this machine: use it for all command-line work by default.
* When invoking this tool, the contents of the "command" parameter does NOT need to be XML-escaped.
* Use the `pwsh` tool only when the task specifically requires PowerShell — Windows services, the registry, COM/WMI, or a cmdlet with no bash equivalent. Do not choose pwsh merely because the host is Windows.
... (其余 bullet 保持梁神版原文)
```

改动 2（新增提示词段，填官方给 bash 预留的槽位）：

```js
ctx.systemPrompt.section({
  name: 'tool:bash',
  order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),   // 1000，官方 posix bash 用同名段
  text: 'Command-line work runs through the `bash` tool (Git Bash) by default — it is this machine\'s preferred shell. Reach for `pwsh` only when the task specifically requires PowerShell. Check the exit code on every result; non-zero exits surface as an error with the command output.',
})
```

`inject` 增加到 `['subprocess', 'tools', 'systemPrompt']`。段名与官方 `dsh-tool-bash` 相同、不同平台互斥挂载，因此同一 scope 内不会重复注册（重复注册会抛错）。

## 5. `workspace-instructions.mjs`：派生自 `minimal-prompt.mjs`

**删除**：装配段裁剪（`keep` 集合、`keepPlanPolicy`、PTC 段保留）、`instructionSource: 'hint'` 模式与其一揽子 hint 消息逻辑、`withWorkspaceLine`（官方 persona 已带 `Your working directory is {{cwd}}.`）。

**保留**（这些是被上游验证过的细节，重写容易静默出错）：

| 机制 | 作用 | 出处 |
|---|---|---|
| `system-prompt/assemble`（`{ prepend: true }`）追加段 | 段文本只写 `{{workspace_instructions}}`，正文经 `assembled.variables` 传递（渲染器严格插值，变量值不被二次扫描） | `minimal-prompt.mjs:726-760` |
| 基线发现与渲染 | `$DSH_HOME/AGENTS.md` + 项目根（最近 `.git`）→ cwd 的 `AGENTS.md`/`CLAUDE.md`/`.local`，同目录 trim 去重，字节预算 65536，UTF-8 安全截断 | `:265-330` |
| `filterInstructionMessages` | 官方 `dsh-agent-instructions` 的 durable 消息（`source.kind === 'agent-instructions'`）**保留消息本体、把正文换成短标记**；整条删除会导致宿主每步重复注入基线 | `:590-635` |
| 动态子目录投递 | 被成功 `read`/`write`/`edit` 触及、基线链之外的目录，其指令文件以 user 消息补投（不塞进 system prompt） | `:795-830` |

**失败降级**：发现/读取/渲染任一步抛错 → 只 `ctx.logger?.warn?.()` 一次，返回原 `assembled`（不追加段），并且**不**替换任何消息（宁可重复，不可缺失）。

**导出**：`name`、`inject = ['systemPrompt']`、`apply`，以及纯函数 `discoverInstructionFiles` / `loadInstructionFiles` / `renderInstructionSection` / `filterInstructionMessages`（供单元测试直接调用，无需宿主）。

## 6. `lib/index.js`：同步插件

```js
export const name = 'dsh-plugin-ptc-bash'
export function apply(ctx) { void run(ctx) }        // 失败只 warn，绝不阻塞宿主启动
export async function syncPresets(options)          // 纯函数，测试直接调用
```

- **源**：`dirname(fileURLToPath(import.meta.url))/../presets`；**目标根**：`process.env.DSH_HOME ?? join(homedir(), '.dsh')` 下的 `.agent-presets`。
- **只拥有** `<目标根>/ptc-bash/`；其它目录一律不读不写不删。
- **幂等**：逐文件先比 size，再比 mtime（1s 容差内）后落逐字节比较；全等则该文件跳过（不触碰 mtime）。目录整体：源有目标无 → 写；内容不同 → 原子替换（写 `.tmp-<pid>-<n>` 后 `rename`）；目标有源无 → 删。
- **结构校验**（写入前）：解析 `agent.cordis.yml`，每个顶层行的 `- id:` 存在且唯一，`name:` 以 `./`、`@`、`cordis:` 开头；不合法 → **整目录不写入**，返回 `failed` 条目并 `warn`（避免把坏组合投毒进发现根）。
- **返回**：`{ copied: string[], skipped: string[], removed: string[], failed: {path, reason}[] }`（测试断言用）。
- 首次运行不存在目标根时创建（`recursive: true`，目录 0o700 / 文件 0o600，与官方 authoring 的收紧一致）。

## 7. 数据流与契约

1. 宿主启动 → 本插件 `apply` → 同步 → `$DSH_HOME/.agent-presets/ptc-bash/` 就绪。
2. 新会话选该预设 → `dsh-agent-presets` 按 `agent.cordis.yml` 的 mtime+size 建代际并挂载 → 注册 `bash`（win32）、保留 `pwsh`、注册 `tool:bash` 段、挂 `workspace-instructions` 装配钩子；`tool-presentation` 从首个请求起把工具面折叠成 `run_code` + SDK。
3. 每个请求装配：官方段落（未裁剪）+ `tool:bash` 段（order 1000）+ `workspace-instructions` 段（末尾，含 AGENTS.md 正文）。
4. 每个 pre-step：官方 `agent-instructions` 基线消息被替换为标记消息；被触及目录的新指令以 user 消息补投。

## 8. 兼容性与权衡

- **与官方预设共存**：预设各自挂载，无进程级注册；`ptc-bash` 的 id 不与内置四个重名，随包根优先也抢不走它（它只在用户根）。
- **与梁神模式共存**：两者都注册工具名 `bash`，但属于不同 scope（不同预设的常驻挂载），互不可见。
- **POSIX**：`custom-bash` 行与 `workspace-instructions` 无关平台差异；POSIX 上 bash 走官方沙箱执行器，`tool:bash` 段由官方插件注册（我们的同名段在 POSIX 不挂载）。
- **权衡：bash 无沙箱**（Windows 既有事实，非本设计引入）。保留官方 pwsh 即保留唯一的受限 shell 通道；模型选 bash 时不受约束，这是 DEC5 明确接受的风险。
- **权衡：官方 pwsh 无法弱化**（其 Config 只有 `enableRunInBackground`），所以「bash 优先」只能从 bash 一侧表达（描述 + 段落），不构成硬约束。
- **权衡：B1 的收益来自第三方实验结论**（dsh-anchored-standard #388/#49 认为全文注入会改变轨迹），本设计不改官方段落，只是把指令从 user 消息挪进 system prompt；若实测不利，删掉 `workspace-instructions` 一行即回到官方形态。

## 9. 运维注意与回滚

- **改 .mjs 不触发重挂**：挂载代际只以 `agent.cordis.yml` 的 mtime+size 为键（`dsh-agent-presets/lib/index.js:1806-1820`）。改插件文件后要 `touch presets/ptc-bash/agent.cordis.yml`（同步会把它带到用户根）或重启 `dsh web`。
- **回滚**（由浅到深）：新会话换回其它预设 → 删 `$DSH_HOME/.agent-presets/ptc-bash/` → `dsh plugin --profile web remove dsh-plugin-ptc-bash` → `git submodule deinit -f dsh-plugin-ptc-bash`。
- 同步是幂等的、只写自己目录，因此禁用/卸载插件不会破坏用户已有的预设目录（残留目录可手工删）。

## 10. 验证策略

| 层 | 手段 |
|---|---|
| 纯函数 | `node --test test/`：同步幂等/删除/非法组合不写入/不碰其它目录；`agent.cordis.yml` 结构断言（三行 shell 的存在与门控、`tool-presentation` 存在、无 `tool-catalog`/`str_replace_editor`）；两个插件模块的导出、描述文本、段名与 order、`discoverInstructionFiles`/`renderInstructionSection`/`filterInstructionMessages` 行为 |
| 静态 | `node --check` 对三个 `.js/.mjs` 文件；YAML 由 loader 实际挂载验证（roster 无 broken） |
| 端到端 | `dsh plugin --profile web add <dir>` → 重启 `dsh web` → 新会话选预设 → AC2/AC3/AC9/AC11/AC12 观察；`$DSH_HOME/.agent-presets/ptc-bash/` 内容与仓库一致 |
| 回归 | 切梁神模式会话仍正常（`bash` 可用、PTC 正常）；官方四个预设仍可新建会话 |
