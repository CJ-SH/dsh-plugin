# Turn Failure Triage Guide

> **Purpose**: ask the right questions *before* explaining why a turn failed. Facts, paths, anchors
> and commands live in [Runtime Diagnostics](../dsh-plugin-ollama-usage/frontend/runtime-diagnostics.md) —
> this file is only the checklist.

---

## Triggers

- [ ] UI shows `本轮运行失败…` or a session log has `turn/end reason.kind = error`
- [ ] A session "suddenly stopped working" while other sessions are fine
- [ ] Someone pastes a provider error with a `ref` id
- [ ] You are about to claim "the model was down" or "the context was too long"

## Prove these four things before answering

1. **Which session / turn / step / minute** — from the transcript, not from memory.
2. **Provider or harness** — quote the raw failure and its classification code (`dsh-llm-pi-ai` `:1366-1377`).
3. **Same-minute control** — did anything succeed at that minute (same session seconds earlier, or another session)?
4. **Size control** — how big was the context, and did other sessions succeed at a *larger* size?

## Rules

- No "outage" or "size wall" verdict without controls 3 and 4.
- The transcript is **multi-frame zstd**; the single-frame APIs return ~200 bytes and will fake a "no hits" answer.
- A synthetic replay returning 200 does **not** prove the payload is innocent (it omits system prompt,
  tool schemas, reasoning blocks, image rendering and the prompt-cache path). A real resume of the session
  is the decisive test — run one before writing a verdict.
- Label conclusions: **confirmed / refuted / alive**. A 500 → strong; a 200 → only "not reproduced".
- Same prefix failing 3+ times will not heal by retrying. Say so, recommend a new session, and collect the `ref` ids.
- Never paste a credential ref into a transcript or a log; rotate it if it happened.
