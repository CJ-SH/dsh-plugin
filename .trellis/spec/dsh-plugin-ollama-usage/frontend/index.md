# Frontend Layer — dsh-plugin-ollama-usage

> Guidelines for the browser half of a DeepSeek Harness (dsh) Cordis plugin, and for the
> host-half contracts that half cannot be written without.

---

## What this layer covers

Trellis auto-detected this package as `dsh-plugin-ollama-usage` with a `frontend` layer. The name
is kept, but read it as **"everything that ships to the web shell"**:

| Area | File |
|------|------|
| Browser half — loader bundle, three seats, all UI | `dsh-plugin-ollama-usage/lib/client.js` |
| Host half — settings namespace, credential seam, `/usage` read, RPC channel | `dsh-plugin-ollama-usage/lib/index.js` |
| Packaging — manifest, loader patch | `dsh-plugin-ollama-usage/package.json`, `dsh-plugin-ollama-usage/cordis.patch.yml` |
| Self-checks | `dsh-plugin-ollama-usage/test/*.test.mjs` |

Host-only internals appear here only where the browser half must agree with them (channel name,
endpoint set, envelope shape, settings namespace). The rest of the host-side reasoning is written
in the module doc comments of `lib/index.js` and in the research that produced this package:
`.trellis/tasks/archive/2026-09/09-14-ollama-usage-entry/research.md`.

**Reality rule**: this layer documents what the code does today. When a guideline and the code
disagree, the code is right and the guideline is what needs fixing.

---

## Pre-Development Checklist

- [ ] Read `dsh-plugin-ollama-usage/README.md` — the user-facing statement of the three surfaces and the two credential modes.
- [ ] Decide which surface the change belongs to. A new surface needs a seat in `lib/client.js`, a host endpoint if it needs data, and assertions in `test/client.test.mjs`.
- [ ] Grep both halves for `CHANNEL`, `NS` and the endpoint names before renaming or adding one — those constants are duplicated on purpose and the suite compares them.
- [ ] Confirm the change cannot make `apply` throw; a throwing plugin row takes the whole plugin tree down.
- [ ] Read `.trellis/spec/guides/cross-layer-thinking-guide.md` when data moves between the two halves.
- [ ] Run `npm test` inside the package before and after.

## Quality Check

Before calling a change in this layer done (details in [Quality Guidelines](./quality-guidelines.md)):

- [ ] `node --check lib/index.js` and `node --check lib/client.js` pass.
- [ ] `npm test` is green — 78 assertions across the four harnesses.
- [ ] Cross-half agreement holds: a renamed `CHANNEL`, `NS` or endpoint exists in both halves and in `test/client.test.mjs`.
- [ ] `README.md` was updated if a seat, endpoint or setting changed.
- [ ] No new dependency, no `@deepseek-ai/*` import in the host half, and nothing added to `apply` that can throw.
- [ ] No debug logging and no prototype instrumentation left behind.

## Hard constraints

Each row is an observed failure, not a style preference.

| Constraint | If violated |
|---|---|
| `export const inject = [...]` at module level in **both** halves | Undeclared service reads are denied: `ctx.settings` throws `cannot get property "settings" without inject`, `ctx.get('settings')` silently yields `undefined`. The plugin mounts, registers nothing, and reports nothing. |
| The host half's `inject` includes `webServer` | `connection.rpc.handle` registers every channel as a web route on the reading context → `cannot get property "webServer" without inject`. |
| `window.__ModuleLoader__.load({ id })` uses the package name | The shell cannot resolve the bundle. |
| `slots.register({ name })` — `name` is the slot key, `id`/`key` is your own cell | `client-half-failed: slot "<your id>" is not declared`. |
| Every RPC call sends `payload`, `{}` when empty | The host answers `gateway/bad-request: invalid client-request message`; the caller's promise rejects and the surface stays on its loading state forever. |
| Nothing in `apply` may throw | `dsh: plugin tree failed to load: failed to apply loader entry …` — dsh will not boot. |
| `ctx.effect` only around registrations that return a disposer | `TypeError: Invalid effect` (`settings.register` returns a scope, not a disposer). |
| No dependencies, no build step | The host half must import no `@deepseek-ai/*`; the bundle may require only `react`. Both are asserted by the suite. |

## Guides

| Guide | Covers | Question it answers |
|---|---|---|
| [Directory Structure](./directory-structure.md) | Workspace, package layout, naming, where new code goes | "Where does this belong?" |
| [Component Guidelines](./component-guidelines.md) | Component shape, seats, props, styling, layout measurement, a11y | "How do I build a surface?" |
| [Hook Guidelines](./hook-guidelines.md) | Hook placement, subscriptions, effects, timers, measurement | "How do I wire a component to the store or the DOM?" |
| [State Management](./state-management.md) | Shared store, refcounted polling, phase model, card state machine | "Who owns this state?" |
| [Quality Guidelines](./quality-guidelines.md) | Self-check harnesses, style, errors, secrets, install and verify | "How do I prove it works and ship it?" |
| [Type Safety](./type-safety.md) | No-TypeScript conventions, runtime narrowing, wire discipline | "How do I handle unknown data?" |

## Reference code map

| Look at | To learn |
|---|---|
| `lib/client.js:16` | the module-loader bundle wrapper (`id` + `factory`) |
| `lib/client.js:385` | `makeApply(ctx)`: stylesheet effect, store, polling, subscription hooks |
| `lib/client.js:434` | `request(endpoint, payload)` — the RPC caller and its always-present payload |
| `lib/client.js:497` | `measureDock` — viewport-to-local coordinate conversion |
| `lib/client.js:616` | `UsageSurface` — pill + panel, Esc handling, focus return |
| `lib/client.js:651` | `DockEntry` — always-mounted positioning box + measurement effect |
| `lib/client.js:727` | `HeroEntry` — the overlay half of the phase rule |
| `lib/client.js:793` | `ConfigCard` — snapshot/draft, revision conflict, secret handling |
| `lib/client.js:1108` | the three `slots.inject` + `slots.register` calls |
| `lib/index.js:438` | host `inject` + `apply` (what must not throw) |
| `test/client.test.mjs` | the seat, lifecycle and cross-half assertions to extend |
