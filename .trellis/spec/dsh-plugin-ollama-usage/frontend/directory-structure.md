# Directory Structure

> Where plugin code lives, how a package is laid out, and where a new piece of code belongs.

---

## Workspace layout

```
D:\project\dsh\dsh-plugin\            meta-repo (this git repository)
├── AGENTS.md                         standing workspace instructions
├── .gitmodules                       one submodule per plugin
├── .trellis/                         workflow, specs, tasks, journals
├── .agents/skills/, .dsh/skills/     Trellis skills for the dsh host
└── dsh-plugin-ollama-usage/          one git submodule = one shippable plugin package
```

- The meta-repo pins plugin commits; it has no `package.json` and builds nothing.
- A plugin is developed inside its own repository, so a change lands as two commits: one in the
  submodule, then the moved pointer in the meta-repo (`git add dsh-plugin-ollama-usage`).
- Further plugins sit as sibling submodules. Spec layers are per package, at
  `.trellis/spec/<package>/<layer>/`.

## Package layout

```
dsh-plugin-ollama-usage/
├── package.json         manifest: "type":"module", main, exports "." + "./client", dsh.*, scripts.test
├── cordis.patch.yml     loader rows merged into the dsh profile at install time
├── lib/index.js         host half — settings namespace, credential seam, /usage read, RPC channel
├── lib/client.js        browser half — one module-loader bundle carrying all three surfaces
├── test/host.test.mjs   35 assertions: host behaviour against a fake cordis context
├── test/client.test.mjs 27 assertions: bundle wrapper, seats, stylesheet lifecycle, cross-half agreement
├── test/card.test.mjs   10 assertions: settings card state machine under a minimal hook runtime
├── test/hero.test.mjs    6 assertions: dock/overlay phase rule under a minimal hook runtime
└── README.md            user-facing: surfaces, credential modes, install, self-check
```

Two source files and no build step. `lib/client.js` is shipped verbatim to the shell, so it is
written directly in the bundle format instead of being compiled; `lib/index.js` is loaded by the
plugin loader as an ordinary ESM module. Keep the bundle wrapper (the outer
`window.__ModuleLoader__.load({ id, factory })` call) in whichever file the manifest points at.

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Package | `dsh-plugin-<topic>` | `dsh-plugin-ollama-usage` |
| Loader row id, settings namespace | `<topic>` | `ollama-usage` |
| Bundle-internal plugin name | `<topic>-client` | `ollama-usage-client` |
| RPC channel | `/<topic>` | `/ollama-usage` |
| CSS classes | `.<topic>-*` | `.ollama-usage-pill` |
| Constants | `SCREAMING_SNAKE_CASE` at the top of a half | `REFRESH_INTERVAL_MS`, `DOCK_ORDER` |
| Components | `PascalCase`, declared inside `makeApply` | `UsagePill`, `ConfigCard` |
| Helpers | `camelCase`, module-level in the half that uses them | `resolveBox`, `parseWindow` |
| Tests | `<subject>.test.mjs`, lowercase behaviour-sentence labels | `check('dock seat: slot name', …)` |

Values both halves must agree on (`CHANNEL`, `NS`, endpoint names, window keys) are **duplicated
constants**, not shared imports — the bundle cannot import from the host half. `test/client.test.mjs`
compares the two sides, so renaming in one file fails the suite.

## Where new code goes

| Change | Touch |
|---|---|
| New UI surface | `lib/client.js`: component + `ctx.slots.inject(key, () => ctx.slots.register(...))` + CSS rules + `COPY_ZH`/`COPY_EN` entries; extend `test/client.test.mjs` |
| New RPC endpoint | `lib/index.js`: a `case` in `handleRequest`; `lib/client.js`: the `request()` caller; `test/client.test.mjs`: the endpoint-set assertion |
| New setting | `lib/index.js`: `settingsSchema` default + `.toJSON()` descriptor + `configView` normalisation; `lib/client.js`: card field, `draft`/`patchDraft` key, COPY entry |
| New account datum | `lib/index.js`: `parseWindow`/`parseUsage`; `lib/client.js`: `decodeWindow`/`decodeUsage`, then render |
| Installer change | `cordis.patch.yml` (loader rows, `inject` overrides) |
| Anything user-visible | `README.md` (surfaces table, credential modes, verification steps) |

## Related

- [Component Guidelines](./component-guidelines.md) — how the surfaces in `lib/client.js` are built.
- [Quality Guidelines](./quality-guidelines.md) — how a change is verified before it ships.
