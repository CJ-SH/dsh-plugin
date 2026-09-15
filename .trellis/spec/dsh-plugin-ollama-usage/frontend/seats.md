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

## Session-header seats

> Measured against `dsh 0.1.5-rc.2` on 2026-09-15 while building `dsh-plugin-trellis-statusline`.

The `conversation.session.header.*` seats are declared by one entry in
`conversation.session.header` and share a single contract:

| Seat | Kind | Purpose | Occupied by |
|---|---|---|---|
| `conversation.session.header.actions` | list | "Title-adjacent Session actions in ascending order" | `agent-preset` (-10), `trellis-statusline` (10), `job-list` (20) |
| `conversation.session.header.utilities` | list | "Right-aligned Session utilities in ascending order" | `open-in-app` (-10), `session-log-download` (default 0), third-party toggles around 10 |

- **The two rows are not interchangeable.** `.actions` sits beside the session title and has room for
  a label; `.utilities` is right-aligned and narrow, which is why its shipped occupants are
  icon-sized. A cell that renders text belongs in `.actions`. Both seats take identical registration
  options, so this is a layout judgement, not a protocol one — and picking wrongly is cheap to fix
  (one constant), which is why it is worth testing in the real header rather than reasoning about it.
- **The seat's standard props carry the session.** `sessionId: SessionId` is among them, so a cell
  learns which session it belongs to from its props — no store lookup and no RPC needed for that.
- **A list seat that renders nothing hides itself.** `.utilities` is styled `:empty { display: none }`,
  so returning `null` *removes the row* rather than leaving a gap; in `.actions` the row is always
  present because `agent-preset` and `job-list` occupy it, so `null` simply contributes no cell.
  Either way `null` is the correct empty state, never placeholder text — matching the rule the
  official jobs cell states as "an ordinary conversation never grows a control for a capability it is
  not using".
- **`order` is the only ordering control**, and it is optional (default 0).
- **The whole header — and therefore every seat inside it — is absent in the hero (new-session)
  phase.** A surface that must be visible before the first message needs a second seat
  (`shell.overlay`); do not expect a header seat to cover that phase.
- **Localization**: register dictionaries with `ctx.locale.register(ns, { zh, en })` and pass the
  same `ns` as the registration's `locale` option. The owner then projects a namespace-bound `t`
  into the cell's props, so a locale change follows without re-registering. A cell cannot assume
  `t` arrives — keep the same dictionary reachable by hand and fall back to it.

## Overlay seats

`shell.overlay` is a click-through layer, but its **direct children get `pointer-events:auto`
automatically**. Keep the registered root box no larger than its content — a full-frame box swallows
every click in the application.

Positioning and measurement techniques are v1 UI detail and deliberately not specified yet; see
[index](./index.md) for where that knowledge currently lives.
