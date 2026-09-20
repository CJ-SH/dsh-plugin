# Runtime Diagnostics — dsh session logs and provider failures

> Verified 2026-09-20 against dsh 0.1.5-rc.2, profile `web`, provider `ollama` / `deepseek-v4.1-flash`,
> and the real logs of `session-4a220f8c`. Every fact below was measured, not inferred; the
> investigation record lives in `.trellis/tasks/09-20-investigate-source-session-500/research/500-turn-failure.md`.

## Scope / Trigger

Read this when a session shows UI text like `本轮运行失败500: {"message":"Internal Server Error (ref: …)",…}`,
when a turn ends `kind=error`, or when you need to prove **which session** owns a Trellis task.
Not about plugin packaging/seats — that is [Plugin Anatomy](./plugin-anatomy.md) / [Two Halves Contract](./halves-contract.md).

## Where the evidence lives

| Artifact | Path | Notes |
|---|---|---|
| Session transcript | `~/.dsh/sessions/<project-slug>/<session-id>/session.v3.jsonl.zstd` | `<project-slug>` = cwd with separators/case folded, e.g. `--D-project-dsh-dsh-plugin--` |
| Session header record | first line of that file | `{"type":"session","version":3,"id":"session-…","createdAt":…,"cwd":…,"agentPreset":…}` |
| Trellis session pointer | `.trellis/.runtime/sessions/dsh_session-<dsh-session-id>.json` | `{platform,last_seen_at,current_task,current_run}` — the authoritative "this session owns that task" record |
| Credential store | `~/.dsh/.credentials.yaml` | `refs:` maps key names to the **usable secret** (`<32 hex>.<24 chars>`); `records:` holds durable per-plugin records. `dsh-credentials` resolves values only inside dsh — there is **no CLI dump** |
| dsh server log | — | **does not exist**: no logs dir, no `*.log` under `~/.dsh`. The transcript is the only durable trace |

**Multi-frame zstd contract (the trap that cost a whole scan).** Transcripts are appended one zstd
frame per flush. Both `zlib.zstdDecompressSync(buf)` and `zlib.createZstdDecompress()` stop after the
**first frame** and return ~200 bytes — a scan that uses them reports "no hits" for text that is
really there.

```js
// correct: split at the frame magic, inflate frame by frame
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []; let i = 0
while ((i = buf.indexOf(MAGIC, i)) !== -1) { starts.push(i); i += 4 }
const out = []
for (let n = 0; n < starts.length; n++) {
  const end = n + 1 < starts.length ? starts[n + 1] : buf.length
  try { out.push(zstdDecompressSync(buf.subarray(starts[n], end))) } catch { /* resync */ }
}
const text = Buffer.concat(out).toString('utf8')
```

The snippet above is the durable form; the throwaway probe that measured this lives at
`.scratch/zstd-frames.mjs` (temporary scratch, task `09-20-investigate-source-session-500`).

## Record surface (what to read)

| `type` | Carries |
|---|---|
| `session` | id, cwd, createdAt, agentPreset |
| `turn/start` / `step/start` / `step/end` | turn/step counters |
| `user/message` | `data.content` blocks (`text`, `image` → `attachment:{attachmentId,mediaType,bytes,name}`) |
| `assistant/message` | `data.message.content` blocks (`text`/`tool-call`/`reasoning`), `data.message.source` (`provider`,`model`,`replayState`), `data.usage` |
| `assistant/attempt` | the raw stream chunks; a failed call ends with `{type:'finish',reason:{kind:'error',failure:{message,code}}}` |
| `tool/call` / `tool/result` | tool name + arguments / result text; `tool/ptc-dispatch(-start)` are the ptc-bash preset's inner dispatches |
| `llm/retry` / `llm/retry-started` | `retry`, `maxRetries`, `policyKey`, and `failure:{message,code}` — **the only place retry classes are recorded** |
| `turn/end` | `reason.kind` = `completed` \| `aborted` (usually `reason.reason.kind='user'`) \| `error` |

**Usage semantics** (measured): `totalTokens = cacheReadTokens + inputTokens + outputTokens`
(e.g. `654720 + 374 + 343 = 655437`) ⇒ `totalTokens` is the **context size after that step**, not a
per-request billed total; `cacheReadTokens` is the upstream prompt-cache hit.

## Error chain: provider 5xx → UI text

| Stage | Anchor | Behavior |
|---|---|---|
| Provider call | `dsh-llm-pi-ai/lib/index.js` | OpenAI-compatible request; a non-2xx body becomes `Error("<status>: <body>")` (raw upstream JSON, incl. `ref` ids) |
| Classification | `dsh-llm-pi-ai/lib/index.js:1366-1377` | `:1367` 401/403→`AUTH`; `:1368` quota→`QUOTA_EXCEEDED`; `:1369` 429→`RATE_LIMIT`; `:1370` 413/body-too-large→`INVALID_REQUEST`; `:1371` 400→`INVALID_REQUEST`; **`:1372` `/\b5\d\d\b/` → `SERVER`**; `:1373` timeout; `:1374-1375` stream/network→`TRANSPORT` |
| Retry | `dsh-llm-retry`; policy key recorded as `["normal",5,["EMPTY_RESPONSE","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]` | `SERVER` is **retryable**: 5 attempts with backoff, then the step fails |
| Overflow guard | `dsh-llm-pi-ai/lib/index.js:1388-1389` (`mapStopReason` → `isContextOverflow(message, contextWindow)`, helper from `@earendil-works/pi-ai`) | Needs BOTH an overflow-shaped message and `totalTokens > contextWindow`; `contextWindow` comes from settings (`llm-pi-ai.providers.<p>.models[].contextWindow`, here `1000000`). A provider that answers 5xx instead of an overflow error is **never** classified as overflow |
| UI | `dsh-client-ui-chat/lib/client.js:2697` `"message.turnError": "本轮运行失败"` | Renders that label + the raw `message` ⇒ `本轮运行失败500: {…}` |

## Validation & error matrix

| Observed | Meaning | Next step |
|---|---|---|
| `turn/end reason.kind=error`, `code=SERVER`, same prefix fails repeatedly | the request payload is rejected upstream; retrying re-sends the same prefix and will fail again | do not keep resuming; start a new session or hand the `ref`s to the provider |
| `code=TRANSPORT` (`Connection error.` / `terminated`) with later success | local network / fake-ip flakiness | nothing to fix in dsh |
| `code=INVALID_REQUEST` | 400/413 class | inspect the payload size/format |
| Failure only in one session while another reaches the same `totalTokens` | **not** a context-size wall | compare per-prefix, not per-token-count |
| Failure at one moment, success 4 s earlier in the same session | **not** a provider outage | look at what entered the context in the delta |

## Good / Base / Bad cases

- **Good** — a conclusion names the session id, the record (`seq`/`turn`/`step`), the timestamps, and the refs; hypotheses are labelled refuted/alive.
- **Base** — "provider X returned 500 at 15:30:50; the session kept failing until 16:10" (with the log path).
- **Bad** — "the model was down" / "the context was too long" without a cross-session or same-session control.

### Wrong vs Correct

```js
// WRONG — stops after the first zstd frame; silently "proves" the text is absent
const text = zstdDecompressSync(readFileSync(log))   // ≈ 200 bytes

// CORRECT — frame-split first (see snippet above) → e.g. 3063 records / 9.1 MB for that session
```

| Wrong move | Why it misleads | Correct move |
|---|---|---|
| Scan with the single-frame API | reports zero hits for text that exists | frame-split inflate |
| Conclude "upstream outage" from one session's failures | ignores that another session (or the same one seconds earlier) succeeded | cross-session error scan + a **same-minute** control request |
| Treat a synthetic replay returning 200 as "the payload is fine" | a reconstruction omits system prompt, tool schemas, reasoning blocks, image rendering and the prompt-cache path | pair it with a **real** resume of the session, or state the conclusion as "not reproduced" |

## Verification commands and assertion points

```bash
# 1. structure of one session
node .scratch/probe-4a220f8c.mjs          # line count + record-type histogram + first/last record
# 2. every errored turn across all sessions (the cross-session control)
node .scratch/probe-allerrs.mjs           # "no other session errored at that minute" is the control
# 3. max context ever reached per session (kills the "size wall" theory fast)
node .scratch/probe-maxtokens.mjs         # 803810 / 801758 tokens succeed on the same provider+model
# 4. direct provider replay (only with explicit consent; prints HTTP status only)
node .scratch/replay-500.mjs --send
```

Assertion points: the header record's `id` equals the directory name; `cwd` matches the workspace you
think it is; `llm/retry.failure.code` and `turn/end.reason.error.code` agree; the terminal `turn/end`
`error.message` contains the `ref` the user reported.

## Calling the provider outside dsh (careful)

`~/.dsh/.credentials.yaml` `refs.` values are the usable secrets (verified: `Bearer <ref value>` →
`POST https://ollama.com/v1/chat/completions` returned `200`, `usage.prompt_tokens` reported).
Rules: never echo a ref into a transcript or log; prefer `OLLAMA_API_KEY` in the environment; if a ref
value was ever pasted into a conversation, **rotate it** afterwards. Requests are billed per input
token, so a replay of a long session is a real spend.
