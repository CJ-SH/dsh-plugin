# Quality Guidelines

> How work in this package is verified, styled and shipped.

---

## Verification gate

Run inside `dsh-plugin-ollama-usage/`:

| Command | Proves |
|---|---|
| `node --check lib/index.js`, `node --check lib/client.js` | the file parses — do this before any long generated snippet is written to disk |
| `npm test` | 78 assertions across four harnesses; this suite is the gate |
| `dsh plugin --profile web add <dir>` then `dsh --profile web --dump-config` | the manifest is merged: a `- id: ollama-usage` row appears |
| restart `dsh web` and open the boot HTML | the bundle is served (`/plugins/??…`, `text/javascript`) and the shell boots without errors |
| `POST {channel}/{endpoint}` with a `{type:'client-request', rpcId, method, payload}` frame | the RPC channel is live without a browser |

The last two need a running dsh and are performed by the user: restarting ends the agent's own
process, so hand over the command instead of running it.

## Test harnesses

Four self-contained `node` scripts — no test framework, no dependencies. Each defines

```js
const check = (label, actual, expected) => {
  results.push({ label, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
}
```

and ends with `process.exitCode = failed.length === 0 ? 0 : 1`, so `npm test` fails the chain.

| Harness | Fake | Asserts |
|---|---|---|
| `test/host.test.mjs` (35) | fake cordis context with service stubs | namespace + schema, RPC channel, `config/read` envelope and endpoint derivation, credential write boundary, four empty states, no key leakage, "host half imports nothing from `@deepseek-ai/*`", bundle/manifest packaging contract |
| `test/client.test.mjs` (27) | fake `window.__ModuleLoader__`, React stub, fake `document` | bundle id equals the package name, only `react` is required, `apply`/`inject` exports, exactly three seats (slot name **and** cell id/key), order, stylesheet injection and removal, cross-half endpoint/channel/namespace agreement |
| `test/card.test.mjs` (10) | minimal hook runtime | the card reaches the host, asks for the credential, renders its fields, leaves the loading state |
| `test/hero.test.mjs` (6) | minimal hook runtime per component | the dock renders its pill, the overlay is suppressed while the dock is mounted, the overlay takes over after unmount |

Rules for changes:

- A new endpoint, seat, setting or manifest field lands with an assertion in the matching harness.
- Assertions compare **JSON-normalisable values**, so anything crossing the store boundary must be
  JSON-safe (ISO strings, not `Date`).
- Labels read as behaviour sentences (`'credential/set refuses in reference mode'`), so a failing
  line explains itself.
- Assertion counts quoted in `README.md` drift; `npm test` output is authoritative.

## Style conventions

- Two-space indent, single quotes, **no semicolons**, trailing commas in multi-line literals, `const`
  by default, arrow functions for small helpers, template literals for messages.
- Numeric separators for readability (`300_000`, `15_000`, `1_048_576`).
- Module and function doc comments are **English** and explain *why* — the host half's module header,
  `request()`'s payload note and the measurement comments in the client half are the model.
- Inline comments are rare and mark non-obvious invariants only.
- Import nothing: the host half has no imports at all, the bundle requires only `react`.

## Error and message conventions

- RPC results are `{ ok: true, value }` or `{ ok: false, error: { code, message } }`; `code` is
  lowercase kebab (`unknown-endpoint`, `unavailable`, `invalid`, `conflict`, `wrong-mode`, `empty`,
  `failed`).
- The host returns failures instead of throwing at the caller: `handleRequest` is the single switch
  and its default case is the only loud protocol error.
- The host half logs only when it degrades:
  `console.error('[ollama-usage] RPC channel unavailable: …')`. Nothing else prints.
- User-visible text comes from `COPY_ZH` / `COPY_EN`, which must keep identical key sets;
  `activeIsChinese(ctx.locale)` picks one per mount. Messages produced by the host (field
  validation) are shown verbatim.

## Secrets

- The key travels host → endpoint only. `credential/describe` returns `configured` / `writable` /
  `source` and never a value; the card writes but never reads back.
- Writes are pinned to the plugin's own reference (`OLLAMA_USAGE_API_KEY`). `credential/set` and
  `credential/unset` take no `ref` parameter, so a compromised client cannot overwrite a provider's
  shared `OLLAMA_API_KEY`.
- Nothing logs, echoes or stores a key in the browser half; the input is cleared after a successful
  write.
- Errors carry status codes or endpoint messages, never request headers.

## Forbidden

| Do not | Because |
|---|---|
| Add an npm dependency, or import `@deepseek-ai/*` from the host half | The package is deliberately dependency-free and both halves are asserted against it |
| Throw inside `apply` | A throwing row fails the whole plugin tree and dsh will not start |
| Wrap `settings.register` in `ctx.effect` | It returns a scope, not a disposer → `TypeError: Invalid effect` |
| Rebuild the user's `pnpm-lock.yaml` to get past `minimumReleaseAge` | The rejection comes from existing lockfile entries, not the package being added; use the one-off flag instead (recorded in the archive research) |
| Edit the user's `settings.yaml` / credentials by hand | The plugin owns its namespace through the settings service |
| Ship a diagnostic tool or a `layout/report` handler | Prototype instrumentation only; it was removed before delivery and must not come back |

## Documentation and git

- `README.md` states the surfaces, both credential modes, install/uninstall commands and the
  self-check. Update it in the same change as any seat, endpoint or setting.
- Commits happen in the submodule first; the meta-repo then records the moved pointer.
- Commit messages here are `feat:` / `fix:` / `chore:` plus a short Chinese summary, e.g.
  `feat: ollama-usage 常驻插件包（Host+Client+清单+patch，四套自检 78 条断言）`.
