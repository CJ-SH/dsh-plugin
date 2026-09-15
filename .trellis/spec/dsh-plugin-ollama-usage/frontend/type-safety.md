# Type Safety

> There is no TypeScript here. Types are JSDoc annotations plus runtime narrowing at every
> boundary — and the narrowing is the part that matters.

---

## Why no compiler

`lib/client.js` ships verbatim into the shell as a bundle, and `lib/index.js` is loaded as plain ESM
by the plugin loader. Neither goes through a build step, so a type system would have to be stripped
at runtime. Both halves are instead written defensively: every value that crosses a boundary is
narrowed before use.

## What replaces types

| Tool | Definition | Where |
|---|---|---|
| `isRecord(value)` | `typeof value === 'object' && value !== null && !Array.isArray(value)` | top of both halves |
| `text(value)` / `readText(value)` | `typeof value === 'string' ? value : ''`; the host variant also trims | top of each half |
| `errorMessage(error)` | `error.message` when it is a non-empty string, else `String(error)`, else `'unknown error'` | host half |
| `normalizeMode` / `normalizeBaseURL` / `normalizeApiKeyRef` | coercion to a known value or the documented default | host half |
| `parseWindow` / `parseUsage` | narrowing of the endpoint's JSON into the host's shapes | host half |
| `decodeWindow` / `decodeUsage` | narrowing of the host's reply into the client's shapes | client half |

JSDoc is used where a signature alone is ambiguous — module headers (`@module`) and union returns:

```js
/**
 * @returns `{ status: 'ok', usage }`, `{ status: 'unsupported' }` for an endpoint without a
 *   usage surface (404), or `{ status: 'none' }` for every other reason — including "not
 *   configured", which is not an error.
 */
async function readUsage(ctx) { /* … */ }
```

## Boundary rules

| Boundary | Rule |
|---|---|
| RPC payload arriving at the host | `const input = isRecord(payload) ? payload : {}` before any field read |
| RPC reply arriving at the client | `isRecord(reply) && reply.status === 'ok' ? decodeUsage(reply.usage) : null` — the host's output is re-narrowed, not trusted |
| HTTP JSON | parsed inside `try/catch`, then handed to `parseUsage`, which returns `undefined` for anything unrecognised |
| Numbers | `typeof x === 'number' && Number.isFinite(x)`; counts additionally `Number.isSafeInteger(x)` and `>= 0` |
| Arrays | `Array.isArray(...)` plus an `isRecord` check per entry; unknown entries are skipped, not fatal |
| Strings | `text` / `readText` first; the empty string means "absent" |
| Timestamps | `isoInstant` normalises string or number input to an ISO string, `undefined` when unusable |
| Field renames | wire snake_case → local camelCase happens once, at decode (`request_count` → `requestCount`, `resets_at` → `resetsAt`) |
| Enum-like values | compared only after normalisation (`normalizeMode`), never as raw input |

## Sentinels

| Value | Means |
|---|---|
| `undefined` (host parsers) | "unrecognised input" — the caller drops the field or the whole snapshot |
| `null` (client decode, store) | "nothing to show" — surfaces render `null`, the card shows `copy.fetchNone` |
| `''` (client `readText`) | "no text" — every renderer checks length before using it |
| `{ ok: false, error }` | the only failure channel across the RPC boundary; a thrown exception is not one |

## Wire discipline

- Everything crossing a boundary is JSON-safe: strings, numbers, booleans, plain objects and arrays.
  `Date` objects, `Map`, `Set` and class instances stay on the side that created them.
- Optional fields are omitted rather than set to `undefined` (`resetsAt` exists only when known),
  which keeps the tests' `JSON.stringify` comparisons meaningful.
- Both halves validate independently. The client does not assume the host's shape is correct; that
  is the cross-layer contract, and `test/client.test.mjs` compares the two sides' constants.

## Common mistakes

| Mistake | Symptom |
|---|---|
| Reading a payload field before narrowing | `TypeError: Cannot read properties of undefined` inside an RPC handler |
| Trusting `entry.name` or `usage` without the type check | A malformed model entry renders `undefined` in the panel |
| Using `||` where `0` is meaningful | `0` usage turns into the fallback value; the halves use `??` and explicit `Number.isFinite` checks instead |
| Casting with `@type` only | No runtime effect — the value is still whatever the wire delivered |
| Comparing raw input against literals | `'Direct'`, `' direct '` and `'direct'` diverge as soon as a value is renamed upstream |
