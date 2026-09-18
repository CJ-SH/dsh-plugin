# Plugin Anatomy

> Package layout, manifest fields, the loader patch, and the commands that prove an install.
> Verified against `dsh-plugin-ollama-usage@eb8c782`.

---

## Workspace layout

```
D:\project\dsh\dsh-plugin\       meta-repo (this git repository): Trellis config, AGENTS.md, no package.json
├── .trellis/                     workflow, specs, tasks, journals
├── .agents/skills/, .dsh/skills/ Trellis skills for the dsh host
└── dsh-plugin-ollama-usage/      one git submodule = one shippable plugin package
```

- A plugin is developed inside its own repository; the meta-repo only pins the commit. A change
  therefore lands as two commits: one in the submodule, then the moved pointer
  (`git add dsh-plugin-ollama-usage`).
- Further plugins arrive as sibling submodules. Spec layers are per package:
  `.trellis/spec/<package>/<layer>/`.

## Package layout

```
dsh-plugin-ollama-usage/
├── package.json        manifest (below)
├── cordis.patch.yml    loader rows merged into the dsh profile at install time
├── lib/index.js        host half — ordinary ESM module, loaded by the plugin loader
├── lib/client.js       browser half — module-loader bundle, shipped verbatim
├── test/*.test.mjs     four dependency-free self-check harnesses
└── README.md           user-facing: surfaces, credential modes, install, self-check
```

No build step and no dependencies: the browser half is written directly in the form the shell
consumes, and neither half imports anything beyond the platform baseline. Keep the bundle wrapper
in whichever file `exports['./client']` points at.

## Manifest fields

```jsonc
{
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-renderer"
      ]
    }
  }
}
```

`dsh.client.inject` lists the client-side rows that must load before this bundle — they provide the
connection, locale and slot services the browser half reads.

`cordis.patch.yml` carries the loader row and any override the plugin needs:

```yaml
- insert:
    - id: ollama-usage
      name: 'dsh-plugin-ollama-usage'
- id: connection            # override an existing row by id
  inject: [webRuntime, webServer]
```

A patched row's `inject` is a **whole-value override**, so a shipped row must be restated verbatim
when only one entry changes.

## Install and verify

| Step | Command | Expect |
|---|---|---|
| install | `dsh plugin --profile web add <dir>` | forwarded to pnpm; a `link:` / junction appears |
| pre-flight | `dsh --profile web --dump-config` | a `- id: ollama-usage` row |
| boot asset | open the boot HTML from a second instance | a `/plugins/??…&rev=…` URL, `text/javascript`, containing `__ModuleLoader__.load` |
| behaviour | `npm test` inside the package | every harness green |
| RPC probe | `POST {channel}/{endpoint}` with a browser session cookie | `{"ok":true,…}` |

Loading a plugin requires restarting dsh; that restart ends an agent's own process, so hand the
command to the user.

## Module resolution: why a `link:` plugin cannot import `@deepseek-ai/*`

> Measured against `dsh 0.1.5-rc.2` on 2026-09-17 while building `dsh-plugin-web-search`.

The dependency-free stance above is not only a style choice — for a **`link:`-installed** plugin it
is a hard constraint, and it is easy to discover too late (the failure is at plugin load, not at
type-check time).

**The rule.** Node resolves a module's bare imports from that module's **real path**, and it
realpaths a symlinked (junction) plugin directory before walking up. A plugin linked in from
`D:\project\...` therefore walks `D:\project\...` → `D:\...` and never reaches
`$DSH_HOME/profiles/node_modules` — the fallback `healProfilesModuleFallback` maintains to supply
"the installation dependency closure through Node's ordinary parent-walk". Measured three ways:

| Resolution base | `@deepseek-ai/dsh-web` |
|---|---|
| plugin's real path | `ERR_MODULE_NOT_FOUND` |
| through a real Windows junction in `profiles/web/node_modules` | `ERR_MODULE_NOT_FOUND` (realpathed) |
| a **copy** physically under `profiles/web/node_modules` | resolves |

So importing the installation's packages requires the plugin to **live** under the profile's
`node_modules` — i.e. a materialized install (tgz / copy), which is exactly how shipped
`dsh-llm-ollama` imports `@deepseek-ai/schemastery` and `@deepseek-ai/dsh-web` from a tgz.

**Three ways to satisfy it, in order of preference.**

1. **Stay dependency-free.** Ship the settings schema as a plain callable object carrying
   `toJSON()` — the shape `dsh-settings` actually consumes — and take errors as plain `Error`.
   `dsh-plugin-ollama-usage` does exactly this; see its module header.
2. **Install materialized** (tgz / copy). Bare imports then work with no extra step.
3. **Keep `link:` and link the peers by hand** (what `dsh-plugin-web-search` ships as
   `npm run link-imports`): create `<plugin>/node_modules/@deepseek-ai/<pkg>` junctions pointing at
   `$DSH_HOME/profiles/node_modules/@deepseek-ai/<pkg>`. Those entries are themselves symlinks to
   the very files the harness loads, so **one module instance** is shared — which is what makes
   `error instanceof HarnessError` hold.

> **Never `npm install` those packages into the plugin.** A copy resolves but is a *different*
> module instance, so `dsh-tools`' `error instanceof HarnessError` check
> (`dsh-tools/lib/index.js:2515-2518`) returns false and the structured `{name, code}` metadata
> silently disappears — the failure is a missing error code, not an exception.

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Package | `dsh-plugin-<topic>` | `dsh-plugin-ollama-usage` |
| Loader row id, settings namespace | `<topic>` | `ollama-usage` |
| Bundle id | the package name | `dsh-plugin-ollama-usage` |
| RPC channel | `/<topic>` | `/ollama-usage` |
| CSS classes | `.<topic>-*` | `.ollama-usage-pill` |
| Constants | `SCREAMING_SNAKE_CASE` at the top of a half | `REFRESH_INTERVAL_MS` |
| Tests | `<subject>.test.mjs`, labels are behaviour sentences | `check('dock seat: slot name', …)` |
