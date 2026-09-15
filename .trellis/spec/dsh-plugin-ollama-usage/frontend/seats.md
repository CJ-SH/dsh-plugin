# Seats

> How a plugin places UI in the shell. Verified against `dsh-plugin-ollama-usage@eb8c782`.

---

## Registration rule

Surfaces are **additive**: a plugin never replaces or wraps a built-in seat, it registers a cell
inside one and waits for that seat to exist.

```js
ctx.slots.inject('conversation.composer.dock', () =>
  ctx.slots.register({ name: 'conversation.composer.dock', id: DOCK_ID, order: DOCK_ORDER }, DockEntry),
)
```

| Key in the options object | Meaning | Failure if confused |
|---|---|---|
| `name` | the **slot key** being joined | `client-half-failed: slot "<your id>" is not declared` |
| `id` (list seats) / `key` (keyed seats) | the plugin's own cell identity | duplicate or undiscoverable cell |
| `order` | position within the seat | the cell lands somewhere unexpected |

`slots.inject(key, callback)` defers registration until the seat exists; register without it and a
seat that is not rendered yet stays empty.

## Seats in use

| Seat | Own identity | Kind |
|---|---|---|
| `conversation.composer.dock` | `id: 'ollama-usage'`, `order: 1` | list — one row under the composer |
| `shell.overlay` | `id: 'ollama-usage-hero'`, `order: 1` | frame-wide floating layer |
| `settings.plugin.item` | `key: 'ollama-usage'` (the settings namespace) | plugin configuration card |

A settings card appears only when **both** halves agree: the host registers the settings namespace
and the browser registers a cell under the same key.

## Overlay seats

`shell.overlay` is a click-through layer, but its **direct children get `pointer-events:auto`
automatically**. Keep the registered root box no larger than its content — a full-frame box swallows
every click in the application.

Positioning and measurement techniques are v1 UI detail and deliberately not specified yet; see
[index](./index.md) for where that knowledge currently lives.
