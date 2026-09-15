# Trellis on DeepSeek Harness (dsh)

dsh is a **class-2 pull-based** Trellis host: no session-start hook auto-injects
workflow context, so the agent loads the Trellis skills on demand through its
skill-loader tool.

| Capability | Status |
| --- | --- |
| Skills (`.agents/skills/trellis-*/SKILL.md`) | Works — dsh discovers this shared root natively |
| Entry skills (`.dsh/skills/trellis-*/SKILL.md`) | Works — dsh's own project skill root (highest rank) |
| Context hooks | None — pull-based: skills read `.trellis/` files directly |
| Sub-agents | None shipped — implement/check/research run inline via the workflow skills |

## Quick start

```bash
trellis init --dsh -u your-name
dsh web        # or: dsh --profile headless "start a Trellis task for ..."
```

In dsh:

1. Open a session in the project root and describe the work in natural
   language. For a new task the agent should load the `trellis-start` skill,
   which reads the current task state from `.trellis/` and routes to
   `trellis-brainstorm` (unclear requirements), `trellis-before-dev` (about to
   write code), `trellis-check` (done coding), or `trellis-update-spec`
   (learned something worth capturing).
2. Entry skills are `trellis-start` / `trellis-continue` / `trellis-finish-work`
   in `.dsh/skills/`. You can also ask for them by name at any time.
3. Type `/trellis:finish-work` is a slash-command convention from other hosts —
   dsh has no slash palette, so say "finish the trellis task" instead, and the
   agent loads `trellis-finish-work`.

## File map

- `.agents/skills/` — auto-triggered workflow skills (`trellis-before-dev`,
  `trellis-brainstorm`, `trellis-check`, `trellis-break-loop`,
  `trellis-update-spec`) plus the bundled `trellis-meta` /
  `trellis-spec-bootstrap` / `trellis-session-insight` skills. Byte-identical
  to Codex / Gemini CLI / Pi / Kimi writes into the same shared root.
- `.dsh/skills/` — dsh-private entry skills (`trellis-start` /
  `trellis-continue` / `trellis-finish-work`).
- `.trellis/` — specs, tasks, workspace memory, and the shared scripts the
  skills invoke (`get_context.py`, `task.py`, ...).

## Notes

- Skill scripts pass `--platform dsh` to `get_context.py`; the value is used
  as a platform-scoped context key.
- The shipped `minimal` agent preset composes only `bash` +
  `str_replace_editor`; the default presets include `web_search` and the
  filesystem/terminal tools the skills assume.
- dsh has no project-level sub-agent definition surface, so Trellis ships no
  `trellis-implement` / `trellis-check` / `trellis-research` agent prompts
  here — the workflow skills run those phases inline in the main session.

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
