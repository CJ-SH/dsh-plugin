# dsh 升级后：派生件失效排查指南

> **SUPERSEDED for dsh 0.2+**: the whole disk-discovery mechanism this guide describes was REMOVED in
> 0.2.0-rc.1 — there is no `@deepseek-ai/dsh-agent-presets`, no `discoverPresets`, no
> `SHIPPED_PRESET_ROOT`, and nothing scans `$DSH_HOME/.agent-presets`. Presets are now **declared**
> through `ctx.agentPresets.register(...)`. Read
> [dsh 0.2 插件契约](./dsh-0.2-plugin-contract.md) §3 instead; this file is kept only for the
> discipline it states about fake-green guards, which still applies.

> **Purpose**: 升级 dsh 后，凡是「从装机产物派生」的东西——agent preset 的组合行、派生脚本的锚点、
> 从上游拷来的常量——都可能指向已被改名或删除的包。本文件只给排查清单；具体契约与命令见
> `dsh-plugin-ptc-bash/README.md`（「验证」「迭代注意」两节）与 harness 的
> `@deepseek-ai/dsh-agent-presets/lib/types/discovery.d.ts`。

---

## Triggers

- [ ] 会话恢复/新建报「预设 X 挂载失败：行 Y 命名了一个无法解析的插件」
- [ ] 升级 dsh 后，某个自建 preset / 插件包突然不可用，或预设选择器里少了一项
- [ ] 你正准备手工改一份「派生自上游」的 YAML / 源码来救急

## 先分清两种失效形态

1. **YAML 仍合法、只是包名解析不到**（如 0.1.5 的 `@deepseek-ai/dsh-workflow-worker-thread` 在 0.1.6
   改名 `@deepseek-ai/dsh-workflow-ptc`）——本地解析看不出来，**只有包查找能发现**。
2. **文件根本不可解析**（手改把引号写坏、缩进写坏）——解析器立即报错，但只有真解析才报。

## 判定：用 harness 自己的发现 API，不要自己写一套

- 入口 `discoverPresets(roots, harnessBase, resolves?)` → `AgentPreset[]`；`AgentPreset.broken?: string`
  就是宿主拒绝挂载的原因（解析 + 行形态 + 包查找，**不导入任何插件代码**）。
- `harnessBase` 必须是**装机 harness 安装根目录的 URL**：行的包名从它开始向上逐级找 `node_modules`。
  本机取 `$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh/package.json`（profile 里是指向 nvm 装机的
  junction）。放错基准会得到「所有包都解析不到」的假象。
- 包查找**跳过 `disabled` 行**（`disabled: true` 与 `!!js` 表达式都跳过）——写负向用例时必须先把该行启用，
  否则变异不会被发现。
- 相对行（`./x.mjs`）按 preset 目录做**文件存在性**检查，不导入模块。

## 修法与防复发

- 有派生脚本（如 `tools/derive-preset.mjs`）就**重跑派生**，不要手改 YAML；重跑后的 `git diff` 就是
  「上游漂移」清单。手改只能在派生脚本里以锚定改动表达，锚点缺失时脚本必须失败而不是写出半成品。
- 守卫分两层：**离线结构守卫**（不解析 YAML，挡写坏的标量，永远运行）＋ **harness 判定**（权威，找不到
  装机时显式 skip 而不是假绿）。
- 同步/拷贝路径上也要有守卫：坏组合不得被写进 `$DSH_HOME/.agent-presets/`，否则下一次会话才炸。

## Rules

- 不要把「包名可解析」降级成字符串比对来让测试变绿——那正是漏检的成因。
- 测试里不要假设装机布局：给候选基准根 + 明确的 skip 提示。
- 报告结论时区分**宿主判定**与**本地解析**：只有前者代表会话能不能挂载。
- 会话级验收（新会话挂载、历史会话恢复）无法用只读检查替代，必须在真实会话里跑一次。
