# Two Halves Contract

> The module surface of each half, the service-declaration rules, and the private RPC between
> them. Verified against `dsh-plugin-ollama-usage@eb8c782`.

---

## Host half (`lib/index.js`)

An ordinary ESM module. The loader treats these exports as the plugin's identity:

```js
export const name = 'dsh-plugin-ollama-usage'          // also the loader row's module id
export const inject = ['settings', 'credentials', 'connection', 'webServer']
export function apply(ctx) { /* register everything here */ }
```

- `inject` is not decoration. The framework hands a plugin a **capability-scoped context proxy**,
  and reading an undeclared service is denied: `ctx.settings` throws
  `cannot get property "settings" without inject`, while `ctx.get('settings')` silently yields
  `undefined`. A plugin without a module-level `inject` mounts, registers nothing, and reports
  nothing.
- `webServer` is required indirectly: `connection.rpc.handle` registers every channel as a web
  route on the context that *reads* the connection service.
- Registrations that return a **scope** (for example `settings.register`) belong directly in
  `apply` and unwind with the plugin. Only registrations that return a **disposer** (for example
  `connection.rpc.handle`) are wrapped in `ctx.effect(fn, 'label')`. Wrapping a scope throws
  `TypeError: Invalid effect`.
- **`apply` must not throw**: a throwing row fails the whole plugin tree
  (`dsh: plugin tree failed to load`). Optional surfaces degrade with a `console.error` and let the
  boot continue.

## Browser half (`lib/client.js`)

A module-loader bundle, not plain ESM:

```js
window.__ModuleLoader__.load({
  id: 'dsh-plugin-ollama-usage',        // must equal the package name
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')      // the only module this bundle requires
    function apply(ctx) { /* seats + UI */ }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

- Baseline `require` keys available to a bundle: `react`, `react-dom`, `react-dom/client`,
  `react/jsx-runtime`. This package uses `react` only, keeping its dependency-free stance.
- The bundle's `inject` names the client services it reads (`slots`, `locale`, `connection`,
  `timer` here). Using a timer primitive without declaring `timer` is denied exactly as on the
  host half.

## Private RPC

```js
// host
ctx.effect(
  () => ctx.connection.rpc.handle('/ollama-usage', (endpoint, payload) => handleRequest(ctx, endpoint, payload)),
  'ollama-usage: RPC channel',
)
// browser
const answered = await ctx.connection.rpc.call('/ollama-usage', endpoint, payload)
```

- Result envelope: `{ ok: true, value }` or `{ ok: false, error: { code, message } }` with a
  lowercase-kebab `code`. An unknown endpoint is the one loud protocol error (`unknown-endpoint`).
- Every call must carry `payload`, `{}` when there is nothing to send. Without it the host answers
  `gateway/bad-request: invalid client-request message` and the caller's promise rejects.
- On the wire the frame is `POST {channel}/{endpoint}` with
  `{ "type":"client-request", "rpcId", "method", "payload" }`, answered by
  `{ "type":"server-response", "rpcId", "result": { ok, value|error } }` — which is what makes a
  browserless probe possible.
- Channel name, settings namespace and endpoint names are **duplicated constants** in both halves.
  `test/client.test.mjs` compares them, so renaming in one file fails the suite.

## Host session → workspace resolution

> Measured against `dsh 0.1.5-rc.2` on 2026-09-15 while building `dsh-plugin-trellis-statusline`.

A plugin that needs the working directory behind a client-supplied `sessionId` does **not** have to
ask the browser for it. The Host has two synchronous paths, and they are enough between them:

| Path | Covers | Access |
|---|---|---|
| `ctx.sessions.get(id).header.cwd` | live sessions | hard dependency — declare `sessions` in `inject` |
| the `sessionIds` → `path` index of `ctx.workspaceRegistry.list()` | persisted sessions too; the registry builds one canonical-cwd header index over stored session headers at startup | optional — `ctx.get('workspaceRegistry')` |

- `SessionHeader.cwd` is **optional**. A session without one — a subagent, for instance — simply
  resolves to nothing. That is an empty result, not an error, and the workspace registry is the
  reason a *closed* session still resolves at all.
- `workspaceRegistry` is deliberately the optional one: a plugin that declares it as a hard
  dependency silently registers nothing on a profile that does not mount it.
- **One id, four places.** A `sessionId` is `session-<uuid>`; the same string is what
  `@deepseek-ai/dsh-shell-env` exports as `DSH_SESSION_ID`
  (`values.DSH_SESSION_ID = execution.agent.session.header.id`), what names the on-disk directory
  `~/.dsh/sessions/<workspace-slug>/session-<uuid>/`, and what a Trellis runtime pointer is keyed
  by. So a session can be correlated across the browser, a tool subprocess and the filesystem
  without any id mapping.

## Credential boundary

A plugin never accepts a foreign credential reference from the client:

- `credential/set` / `credential/unset` take no `ref` argument; the host writes its own reference
  (here `OLLAMA_USAGE_API_KEY`) and nothing else, so a broken client cannot overwrite a provider's
  shared key.
- `credential/describe` reports `configured` / `writable` / `source` and never a value; the UI
  writes but never reads a secret back.
- Errors carry status codes or endpoint messages, never request headers or key material.
