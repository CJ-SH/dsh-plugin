# State Management

> The browser half owns exactly one shared store. Everything else is component-local, or lives on
> the host.

---

## Ownership

| State | Owner | Lifetime |
|---|---|---|
| Settings namespace, credential, account usage | **host half** (`lib/index.js` → `settings.yaml`, the credential store, `GET {baseURL}/api/usage`) | settings and credential persist across restarts; usage is refetched |
| Usage snapshot + phase | the closure store inside `makeApply` | one per plugin mount, shared by every surface |
| Panel open state, card form, notice, busy flag | the component (`useState`) | that component's lifetime |

There is no Redux/zustand/context, and no second copy of the store: `DockEntry`, `HeroEntry`,
`UsageSurface` and `ConfigCard` all read the same object.

## Store shape and fan-out

```js
const store = { phase: 'loading', usage: null, inFlight: false }
const dataListeners = new Set()   // usage changed
const phaseListeners = new Set()  // dock/hero visibility changed
```

- `refresh()` is the **only writer** of `store`; no component mutates it.
- Writes end with `emitData()`; re-rendering happens because the subscription hooks bump their
  version counter ([Hook Guidelines](./hook-guidelines.md)).
- `inFlight` collapses concurrent triggers (mount, poll, card reload) into one request.

## Refcounted polling

```js
function acquire() {
  consumers += 1
  if (consumers > 1) return
  refresh()
  if (pollStop === null) pollStop = ctx.interval(() => refresh(), REFRESH_INTERVAL_MS)
}
```

- Every surface that needs usage calls `acquire()` in a mount effect and `release()` in its cleanup
  — dock, hero and config card each count once.
- The first consumer triggers an immediate read and starts the 5-minute poll
  (`REFRESH_INTERVAL_MS = 300_000`); the last release stops it.
- Nothing polls while no surface is mounted; that is the point of the refcount.

## Phase model

| Layer | Values | Meaning |
|---|---|---|
| Host `usage/read` | `{ status: 'ok', usage }` / `{ status: 'unsupported' }` / `{ status: 'none' }` | `unsupported` = the endpoint answered 404; `none` = no credential, non-2xx, malformed or oversized body, network error |
| Store | `loading` → `ok` \| `none` | set from the reply: anything that is not `status: 'ok'` with decodable windows becomes `none` |
| Surfaces | render only on `ok` | dock and hero render `null`; the card's status line shows `copy.fetchNone` |

Rules that follow:

- **No optimistic rendering and no error surface for usage.** A failed read looks like a quiet
  account; the pill disappears instead of reporting an error.
- **Never invent windows.** `WINDOW_ORDER` (`session`, `weekly`, `monthly`) is both the iteration
  order and the fallback order. `headlineOf` returns the first window the account actually
  returned — the 5-hour window when present, even if weekly is higher.
- **Wire values are JSON only.** Timestamps that cross the boundary are ISO strings (`fetchedAt`,
  `resetsAt`); numbers are plain numbers.

## Surface visibility rule (hero vs dock)

```js
const heroVisible = () => settled && dockMounts === 0
```

- The composer dock only renders in an active session, so "no dock instance is mounted" is the
  phase signal for a brand-new session.
- `dockMounts` is incremented by `DockEntry`'s mount effect; `settled` flips 250 ms after mount
  (`ctx.timeout`) so the first frame cannot flash the overlay.
- The two surfaces are mutually exclusive halves of one feature: hero never renders while a dock
  instance exists.

## Config card state machine

| State | Holds |
|---|---|
| `snapshot` | what the host reported (`config/read` + `credential/describe`), including `revision` and `writable` |
| `draft` | the editable copy (`baseURL`, `apiKeyEnv`, `credentialMode`), created from the snapshot once and never overwritten by a reload |
| `secret` | the typed key — write-only, cleared after `credential/set` succeeds, never part of the snapshot |
| `notice` | `{ kind: 'ok' \| 'error' \| 'info', text }`, the user-visible message |
| `busy`, `open`, `reloadToken` | request in flight, expansion state, forced reload |

- `dirty` is a **value comparison** between snapshot and draft; it drives the "unsaved" badge and
  the save/discard buttons.
- Saving sends `expectedRevision: snapshot.revision`. When someone else wrote first, the host
  answers `error.code === 'conflict'` and the card shows `copy.conflict` instead of overwriting.
- `writable: false` (a read-only settings provider) disables the fields and explains why
  (`copy.readOnly`); an edit is never silently dropped.
- Credential operations are separate endpoints (`credential/describe|set|unset`) and reload the
  card afterwards. Which reference is written is decided by the host, never by the client.

## Common mistakes

| Mistake | Symptom |
|---|---|
| Copying store state into component state | Two surfaces disagree after a refresh |
| Letting a reload overwrite `draft` | The user's in-progress edit disappears |
| Rendering usage optimistically | A stale percentage survives a failed read |
| Treating "no data" as an error | A 404 endpoint (self-hosted or unsupported account) produces an error surface in a plugin that must stay silent |
| Keeping the key in readable state | The secret must never be echoed back; it is written once, cleared, and `credential/describe` returns no value by design |
