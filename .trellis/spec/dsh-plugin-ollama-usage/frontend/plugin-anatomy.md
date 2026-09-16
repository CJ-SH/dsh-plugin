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
