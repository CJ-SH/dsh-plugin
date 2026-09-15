# dsh-plugin-trellis-statusline

The active Trellis task of the current session's workspace, shown in the dsh web session
header.

```
[P2] Trellis statusline plugin for dsh web · 进行中
```

---

## What it shows

One cell in the **session header** (`conversation.session.header.utilities`), reading
`[priority] title · status` for the Trellis task the session's working directory is on — the
same information the Claude Code `statusline.py` hook puts in a terminal, which dsh's web
shell had no equivalent for.

It resolves, in this order:

1. **The session's working directory.** `ctx.sessions.get(sessionId).header.cwd` for a live
   session; otherwise the workspace registry's canonical-cwd index
   (`ctx.workspaceRegistry.list()`), which also covers sessions that are no longer live.
2. **`<cwd>/.trellis/.runtime/sessions/dsh_<sessionId>.json`** — the pointer `task.py start`
   writes. It wins whenever it names a real task directory inside `.trellis`.
3. **A scan of `<cwd>/.trellis/tasks/<dir>/task.json`** — `in_progress` before `planning`,
   and among equals the lexicographically greatest directory name (the newest `MM-DD-` task).

With no dsh session, no working directory, no `.trellis`, no running task or a corrupt file,
the cell renders **nothing at all**. No placeholder, no blank row, no error: an ordinary
conversation must not grow a control for a capability it is not using.

The display refreshes every 10 s, and immediately when the header switches to another
session, so a `task.py start` or `task.py archive` shows up within one poll.

## What it does not do

- **It never writes.** The Host half imports `node:fs/promises` for `readFile` and `readdir`
  and holds no write path — Trellis data cannot be modified by this plugin, and the self-check
  asserts it, including a before/after hash comparison of a workspace's `.trellis/`.
- It does not start, switch or archive tasks; that stays `task.py`'s job.
- It shows nothing in the **hero** (new-session) phase, because the whole session header —
  including this seat — is not rendered there. This is a known, accepted limitation.
- It does not repeat what dsh already shows (model, tokens, elapsed time).

## Install

```bash
dsh plugin --profile web add <path-to-this-directory>
dsh --profile web --dump-config | grep trellis-statusline
```

Restart dsh to load it. The bundle patch widens the shipped `connection` row's `inject` to
`[webRuntime, webServer]` — without `webServer`, `connection.rpc.handle` cannot register the
channel as a web route and throws. That override is the same value
`dsh-plugin-ollama-usage` writes, so installing both stays idempotent.

Remove it with:

```bash
dsh plugin --profile web remove dsh-plugin-trellis-statusline
```

The plugin stores nothing and has nothing to configure, so uninstalling needs no cleanup.

## Verify

```bash
node --check lib/index.js && node --check lib/client.js   # both halves parse
npm test                                                  # 97 assertions, three harnesses
```

| Harness | Covers |
|---|---|
| `test/host.test.mjs` | the four-step resolution against throwaway workspaces — pointer first, scan fallback, rank and tie-break, every empty state, the `unknown-endpoint` error, "no write API in the source", and a before/after hash comparison proving a read leaves `.trellis/` byte-identical |
| `test/client.test.mjs` | bundle id = package name, only `react` required, the seat (slot key vs cell id vs order), the locale namespace handed to the seat, stylesheet lifecycle, a refused locale namespace degrading to the local dictionaries, cross-half channel/endpoint agreement |
| `test/cell.test.mjs` | the real cell under a minimal hook runtime — `[P1] title · state`, `null` for every failure mode, an unknown status, the 10 s poll, and interval disposal on both session switch and unmount |

Without a browser, the channel answers at `POST {channel}/{endpoint}`:

```bash
curl -s -X POST http://127.0.0.1:3080/trellis-statusline/task/read \
  -H 'content-type: application/json' -b "dsh=<cookie value>" \
  -d '{"type":"client-request","rpcId":"1","method":"task/read","payload":{"sessionId":"session-<uuid>"}}'
# {"type":"server-response","rpcId":"1","result":{"ok":true,"value":{"status":"ok","task":{…}}}}
```

Two things to know about that call. The cookie is the authority-bound session cookie the browser
received when it opened the URL `dsh web` printed, so `-b` has to carry the real value from
DevTools → Application → Cookies — the route rejects an unauthenticated request with 401 before it
reaches the plugin. And `result` is the envelope; `unknown-endpoint` for a wrong `method` is the
plugin's only loud protocol error.

In practice the pill itself is the proof: it is rendered from this channel, so a visible
`[P2] … · 进行中` in the header means session → cwd → pointer → scan and the RPC round trip all
worked. From the browser console the same call is simply:

```js
await fetch('/trellis-statusline/task/read', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'client-request', rpcId: '1', method: 'task/read', payload: { sessionId: 'session-<uuid>' } }),
}).then((r) => r.json())
```

## Layout

| File | Role |
|---|---|
| `lib/index.js` | Host half — session → cwd → task, and the `/trellis-statusline` RPC channel |
| `lib/client.js` | Browser half — the module-loader bundle, the seat registration, the cell |
| `cordis.patch.yml` | the loader row, plus the `connection` inject widening |
| `package.json` | manifest: entry points, `dsh.bundle.patch`, `dsh.client` |
| `test/*.test.mjs` | the three dependency-free self-check harnesses |

No dependencies and no build step: the browser half is written directly in the form the shell
consumes, the Host half imports nothing beyond `node:` builtins, and `npm test` asserts both.
