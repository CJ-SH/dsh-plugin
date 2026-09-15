<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

<!-- WebSearch:START -->

# 网络搜索约定

- 为避免重复造轮子、闷头干等行为，请善用网络搜索（web search功能、tool）

## 搜索的时机与频率

- 在项目的各个阶段，都应该积极搜索，尤其是规划阶段、出现意料之外的情况下
- 面对比较“私有”的情况，例如公司给自己开发的各种系统的业务逻辑，在网络上必然是没有的，只能自己依靠代码逻辑推测，此时就不用浪费搜索资源

## 质量约定

- 优先使用英文关键词搜索，如果有没有优质结果，再使用中文关键词搜索
- github、reddit、stack overflow、博客园等优质社区优先关注
- 禁止无条件信任搜索结果，需要对结果从相关性、距今年份、代码质量，适用的环境、情景，star数量等多方面综合评判

## 结果的使用

- 结果高度适配的情况可以直接使用
- 相关性较高的情况下可以多参考其代码、架构设计、项目设计
- 相关性较低的情况下可以参考其思路，发散出有利于自身的思路

<!-- WebSearch:END -->

# 工作区约定（人工维护，`trellis update` 不会覆盖本节）

## 临时文件一律放在会话工作区

不要在 `%LOCALAPPDATA%\Temp`、`%TEMP%`、`AppData` 或任何用户级临时目录里创建文件。

需要落盘的临时产物（草稿源码、校验脚本、探测脚本、日志、中间结果）**统一放在当前会话工作区内**，
建议路径：

```
<workspace>/.scratch/          临时区，用完即删；已在 .gitignore 中忽略
```

规则：

- 临时文件**不写进用户级目录**（`AppData`、`Temp`、`~/.dsh` 等），除了那些由工具/服务自身管理的持久数据。
- `.scratch/` 下的内容视为可丢弃：任务收尾时清理，或明确告知用户它还在。
- 需要跨命令复用的中间文件（例如写盘后用 `node --check` 校验的源码），同样放 `.scratch/`。
- 真正属于交付物的代码与文档放在项目目录里，不进 `.scratch/`。
