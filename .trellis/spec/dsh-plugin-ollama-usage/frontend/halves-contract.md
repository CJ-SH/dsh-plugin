# Two Halves Contract

> The module surface of each half, the service-declaration rules, and the private wire between
> them. Verified against `dsh-plugin-ollama-usage@eb8c782`; the channel-vs-own-route facts
> added 2026-09-16 against `dsh 0.1.5-rc.2` (evidence:
> `.trellis/tasks/09-16-dsh-channel-patch-research/research/`).

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
- `webServer` is required by both wire shapes, for different reasons and on different rows.
  Measured (not inferred): a `connection.rpc` channel registers its physical route on the
  **connection row's** context, so a plugin's *own* `webServer` declaration does not make the
  channel work — the shipped row has to inject it too. An **own route**
  (`ctx.webServer.register`) needs `webServer` only on this row. See
  [Channel or own route](#channel-or-own-route).
- Registrations that return a **scope** (for example `settings.register`) belong directly in
  `apply` and unwind with the plugin. Only registrations that return a **disposer** (for example
  `connection.rpc.handle`, or `ctx.webServer.register`) are wrapped in
  `ctx.effect(fn, 'label')`. Wrapping a scope throws `TypeError: Invalid effect`.
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
- The bundle's `inject` names the client services it reads (`slots`, `locale`, `timer` here —
  **no `connection`**: the wire is a plain `fetch` to the host row's own route). Using a timer
  primitive without declaring `timer` is denied exactly as on the host half.

## The wire (the route shape both halves use)

```js
// host — one route this row owns, and the fence it asks before every answer
ctx.effect(
  () => ctx.webServer.register({ kind: 'prefix', path: '/ollama-usage', handler: routeHandler }),
  'ollama-usage: route',
)
// browser
const response = await fetch(new URL(`${ROUTE_PREFIX}/${endpoint}`, hostBase()), {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(payload ?? {}),
})
```

Order inside the handler **is** the contract: fence → method → media type → endpoint → body.

- Result envelope: `{ ok: true, value }` or `{ ok: false, error: { code, message } }` with a
  lowercase-kebab `code`. An unknown endpoint is the one loud protocol error (`unknown-endpoint`,
  answered `404`).
- Request shape: `POST {prefix}/{endpoint}`, payload as the JSON body (`{}` when there is nothing
  to send), `content-type: application/json` required. A non-POST method is `405` with
  `Allow: POST`; a wrong media type is `415`; a missing, oversized or non-JSON body is `400`.
- Every answer is preceded by `connection.requestRejection(req)` — `401`/`403` written verbatim —
  and a composition without that seam gets `503`. Answers carry `cache-control: no-store`.
- Shape choices differ per feature and are both fine: `dsh-plugin-trellis-statusline` registers an
  **exact** route and reads with `GET` plus a query string; `dsh-plugin-ollama-usage` registers one
  **prefix** route and puts the endpoint in the path (`POST /ollama-usage/config/read`).
- Route prefix, settings namespace and endpoint names are **duplicated constants** in both halves.
  `test/client.test.mjs` compares them, so renaming in one file fails the suite.
- A request arriving during boot, before the owning row registers, is answered `404` by the
  fallback seat. That is documented startup behaviour, not a plugin failure.

## Channel or own route

Two shapes move one JSON envelope and both are fenced; pick by what you are willing to depend on.

| | `connection.rpc.handle(channel, handler)` | `ctx.webServer.register({ kind, path, handler })` |
|---|---|---|
| Where the route lives | the **connection row's** context | this plugin's own row |
| Fence | applied inside `register()` | the handler asks `connection.requestRejection(req)` first |
| Cost | the shipped `connection` row must inject `webServer`: a bundle patch has to restate that row's whole `inject` list, and any later layer writing a different list silently removes every channel | you own the route namespace plus method/query/body validation |
| Seen in the wild | `dsh-llm-ollama`, `dsh-plugin-ollama-usage`, community `filestab` | shipped `dsh-host-open-in-app` and `dsh-webhook-github`, community UI plugins, `dsh-plugin-trellis-statusline` |

Measured on `dsh 0.1.5-rc.2`, 2026-09-16:

- Restoring the shipped row to `inject: [webRuntime]` in a **parallel profile instance** made both
  channel routes answer `404` while `/api` stayed `401`; the boot log carried
  `RPC channel unavailable: cannot get property "webServer" without inject` for both consumers
  — even though both declare `webServer` on their own rows.
- `connection.requestRejection(request) → 401 | 403 | undefined` is the documented fence for
  *another Web route* (upstream `packages/client/connection/src/rpc.ts`, `HostConnectionHandle`
  JSDoc). Absent it, answer `503` — never serve unauthenticated.
- `dsh-host-webserver` owns no TLS, authentication, or Origin policy, and `register` throws on a
  duplicate `(kind, path)`; a route that cannot register should degrade with a `console.error`.
- Patches replace a row's **whole** value, so widening `inject` means restating every entry (the
  upstream publish guide says so, and `packages/bundle/web-app/cordis.patch.yml` restates
  `dsh-base` rows the same way). Repo-external plugins must ship `dsh.bundle.patch` to activate.

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
