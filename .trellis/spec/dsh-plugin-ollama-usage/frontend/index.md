# Frontend Layer — dsh-plugin-ollama-usage

> Frozen contracts for a DeepSeek Harness (dsh) Cordis plugin: how its two halves are packaged,
> declared and wired together. UI and state conventions wait until the plugin's shape settles.

---

## Scope and stage

This package is at v1 and will keep changing, so this layer deliberately holds **only what a
rewrite should not have to rediscover** — the platform contracts and the failures they caused.

| In spec (settled) | Deliberately not in spec yet (v1, still moving) |
|---|---|
| package / manifest / patch shape, install and verify commands | component structure and props style |
| bundle format, host module surface, service declaration | hook patterns, subscription and measurement effects |
| RPC channel, envelope, endpoint rules, cross-half constants | the shared store, refcounted polling, phase model, card state machine |
| seat registration rules and the three seats in use | stylesheet contents, class names, layout measurement |
| self-check harness style, code and commit style | credential-mode UX details |

The deferred material is not lost — it is in the code (`lib/client.js`), in git history, and in the
research that produced the package:
`.trellis/tasks/archive/2026-09/09-14-ollama-usage-entry/research.md`. Add it here once the v2
shape settles.

**Reality rule**: when a guideline and the code disagree, the code is right and the guideline is
what needs fixing. Each file names the commit it was verified against.

---

## Pre-Development Checklist

- [ ] Read `dsh-plugin-ollama-usage/README.md` — the user-facing statement of the surfaces and credential modes.
- [ ] Classify the change: packaging, contract, seat, or UI. Only the first three are specified here; UI follows the code.
- [ ] Grep both halves for `CHANNEL`, `NS` and the endpoint names before renaming or adding one — those constants are duplicated on purpose and the suite compares them.
- [ ] Confirm the change cannot make `apply` throw; a throwing plugin row takes the whole plugin tree down.
- [ ] Read `.trellis/spec/guides/cross-layer-thinking-guide.md` when data moves between the two halves.
- [ ] Run `npm test` inside the package before and after.

## Quality Check

Before calling a change in this layer done:

- [ ] `node --check lib/index.js` and `node --check lib/client.js` pass.
- [ ] `npm test` is green (see [Self-Check and Verification](./self-check.md)).
- [ ] Cross-half agreement holds: a renamed channel, namespace or endpoint exists in both halves and in `test/client.test.mjs`.
- [ ] `README.md` updated if a seat, endpoint or setting moved.
- [ ] No new dependency, no `@deepseek-ai/*` import in the host half, nothing added to `apply` that can throw.
- [ ] No debug logging and no prototype instrumentation left behind.

## Hard constraints

Each row is an observed failure, not a style preference.

| Constraint | If violated |
|---|---|
| `export const inject = [...]` at module level in **both** halves | Undeclared service reads are denied: `ctx.settings` throws `cannot get property "settings" without inject`, `ctx.get('settings')` silently yields `undefined`. The plugin mounts, registers nothing, reports nothing. |
| The host half's `inject` includes `webServer` | `connection.rpc.handle` registers each channel as a web route on the reading context → `cannot get property "webServer" without inject`. |
| `window.__ModuleLoader__.load({ id })` uses the package name | The shell cannot resolve the bundle. |
| `slots.register({ name })` — `name` is the slot key, `id`/`key` is your own cell | `client-half-failed: slot "<your id>" is not declared`. |
| Every RPC call sends `payload`, `{}` when empty | The host answers `gateway/bad-request: invalid client-request message`; the caller's promise rejects and the surface stays on its loading state forever. |
| Nothing in `apply` may throw | `dsh: plugin tree failed to load: failed to apply loader entry …` — dsh will not boot. |
| `ctx.effect` only around registrations that return a disposer | `TypeError: Invalid effect` (`settings.register` returns a scope). |
| No dependencies, no build step | The host half must import no `@deepseek-ai/*`; the bundle may require only `react`. Both are asserted by the suite. |

## Guides

| Guide | Covers |
|---|---|
| [Plugin Anatomy](./plugin-anatomy.md) | Workspace and package layout, manifest, loader patch, install and verify commands, naming |
| [Two Halves Contract](./halves-contract.md) | Host module surface, bundle format, service declaration, private RPC, credential boundary |
| [Seats](./seats.md) | How UI is placed: registration rules, `name` vs `id`/`key`, the seats in use |
| [Self-Check and Verification](./self-check.md) | Harness style, release gate, code style, errors and secrets, forbidden patterns, git |
| [Type Safety](./type-safety.md) | No-TypeScript conventions, runtime narrowing, boundary rules, wire discipline |

## Key files

| File | Role |
|---|---|
| `dsh-plugin-ollama-usage/package.json` | manifest: entry points, `dsh.bundle.patch`, `dsh.client` |
| `dsh-plugin-ollama-usage/cordis.patch.yml` | loader row plus the one shipped-row override |
| `dsh-plugin-ollama-usage/lib/index.js` | host half: `name`, `inject`, `apply`, channel, endpoints |
| `dsh-plugin-ollama-usage/lib/client.js` | browser half: bundle wrapper, `inject`, seat registrations, UI |
| `dsh-plugin-ollama-usage/test/*.test.mjs` | the four self-check harnesses |
| `dsh-plugin-ollama-usage/README.md` | user-facing surfaces, credential modes, install |
