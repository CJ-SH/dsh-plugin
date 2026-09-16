# Self-Check and Verification

> Harness style, the release gate, and the local code and commit style.
> Verified against `dsh-plugin-ollama-usage@eb8c782`.

---

## Harnesses

Four self-contained `node` scripts — no test framework, no dependencies. Each defines

```js
const check = (label, actual, expected) => {
  results.push({ label, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
}
```

and ends with `process.exitCode = failed.length === 0 ? 0 : 1`, so `npm test` (the scripts chained
with `&&`) fails the chain.

| Harness | Fakes | Covers |
|---|---|---|
| `test/host.test.mjs` | fake cordis context plus service stubs | settings namespace and schema, RPC channel, reply envelopes, endpoint derivation, credential write boundary, empty states, "host half imports no `@deepseek-ai/*`", manifest and bundle packaging contract |
| `test/client.test.mjs` | fake `window.__ModuleLoader__`, React stub, fake `document` | bundle id equals the package name, only `react` required, `apply`/`inject` exports, seats (slot name **and** cell id/key) with order, stylesheet lifecycle, cross-half constant agreement |
| `test/card.test.mjs` | minimal hook runtime | the settings card drives its endpoints and leaves the loading state |
| `test/hero.test.mjs` | minimal hook runtime per component | the dock/overlay visibility rule |

Rules:

- A new endpoint, seat, manifest field or setting lands with an assertion in the matching harness.
- Assertions compare JSON-normalisable values, so anything crossing the store boundary must be
  JSON-safe (ISO strings, not `Date`).
- Labels are behaviour sentences (`'credential/set refuses in reference mode'`), so a failing line
  explains itself.
- Assertion counts quoted in `README.md` drift; `npm test` output is authoritative.

## Release gate

| Command | Proves |
|---|---|
| `node --check lib/index.js`, `node --check lib/client.js` | the file parses — do this before any long generated snippet reaches disk |
| `npm test` | every harness green |
| `dsh --profile web --dump-config` | the loader row is merged |
| restart dsh, open the boot HTML | the bundle is served and the shell boots clean |
| `POST {channel}/{endpoint}` | the RPC channel is live without a browser |

Restarting dsh ends an agent's own process: hand that step to the user.

## Code style

- Two-space indent, single quotes, **no semicolons**, trailing commas in multi-line literals,
  `const` by default, arrow functions for small helpers, template literals for messages.
- Numeric separators for readability (`300_000`, `1_048_576`).
- Comments are English and explain *why*; inline comments mark non-obvious invariants only.
- The host half imports nothing; the bundle requires only `react`.

## Errors, messages, secrets

- Every RPC reply is `{ ok: true, value }` or `{ ok: false, error: { code, message } }` with a
  lowercase-kebab `code`; failures are returned, not thrown at the caller.
- The host half logs only when it degrades:
  `console.error('[ollama-usage] RPC channel unavailable: …')`.
- User-visible text lives in `COPY_ZH` / `COPY_EN` with identical key sets, chosen per mount from
  the locale service; messages the host produced are shown verbatim.
- No key is ever logged, echoed or stored in the browser half — see
  [Two Halves Contract](./halves-contract.md).

## Forbidden

| Do not | Because |
|---|---|
| Add an npm dependency, or import `@deepseek-ai/*` in the host half | the package is deliberately dependency-free and the suite asserts it |
| Throw inside `apply` | a throwing row takes the whole plugin tree down |
| Wrap a scope-returning registration in `ctx.effect` | `TypeError: Invalid effect` |
| Commit the meta-repo before the submodule | the pointer would name a commit that does not exist yet |

## Git

- Commits: submodule first, then the meta-repo pointer.
- Messages are `feat:` / `fix:` / `docs:` / `chore:` plus a short Chinese summary, e.g.
  `feat: ollama-usage 常驻插件包（Host+Client+清单+patch，四套自检 78 条断言）`.
- `README.md` is part of the change whenever a seat, endpoint or setting moves.
