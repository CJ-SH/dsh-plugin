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

## The blank-session (Hero) phase

> Measured against `dsh 0.1.5-rc.2` on 2026-09-15 while building `dsh-plugin-trellis-statusline`.

The Hero — the new-session view before the first message — is where a header-seat plugin silently
disappears, and three facts about it are easy to get backwards:

- **A blank session is a real session.** `ConversationRoot` computes
  `hero = sessionId === undefined || shellPhase === "blank" && (openState === "open" || summaryBlank === true)`.
  So the usual "new session" flow has a real id, and **session-scoped seats are alive in the Hero**.
- **The header is hidden, not unmounted.** The Hero adds `.wSkVaW_headerHidden{display:none}` to the
  whole header block, so a header cell stays *mounted* while invisible.
- **The Hero's composer stack has nothing additive below the card.** It is
  `HeroShell → heroWorkspaceRow → conversation.input.dock → inputBar`, so the card is the last
  child and the room under it is the stack's own `padding-bottom`.

Consequences worth remembering:

- **Never detect the Hero with "is the header cell mounted?"** — a mount counter will conclude the
  header is showing, forever. Read the flag the shell itself reads instead:

  ```js
  const blank = useSessions((s) => (sessionId === undefined ? undefined : s.byId[sessionId]?.blank))
  ```

  `SessionListState.byId[id].blank` is the "empty-log bit" `ConversationRoot` uses as `summaryBlank`.
  A root-scoped seat has no `sessionId` prop, so take it from the same store
  (`useSessions((s) => s.current)`), and make each selector return a primitive — a selector that
  builds a fresh object defeats the store's reference comparison on every read. **In a frame-wide
  seat, `blank` is not enough**: it stays true while another main panel is on screen, so also
  require `usePanelInfo((s) => s.activePanelId) === null` ("the Conversation is displayed").
  Guard the hooks like any projected prop, and mind the hook rules: an early `return null` *before*
  other hooks would change the hook count when `blank` flips. Pass the flags into a shared hook as
  an `enabled` argument, keep every hook unconditional, and let the effect return early so a hidden
  seat costs no request.
- **Read the render site, not the slot catalog description.** The catalog says
  `conversation.composer.dock` is "Ambient entries below the composer card", which reads as exactly
  the seat for a status line under the input. Its render site gates it on `variant === "composer"`,
  and the Hero sets `variant === "hero"`, so it never renders there at all.
  `conversation.input.dock` renders in both (gated only on `input`/`sessionId`). A minute at the
  render site beats a rewrite.
- **When no seat is where you need it, `shell.overlay` plus measurement is the sanctioned route.**
  The overlay is root-scoped, `replaceRisk: none`, and click-through. Anchor with the slot protocol's
  own marker (`document.querySelector('[data-slot="conversation.composer.bar"]')`), never a product
  CSS class. A **zero-sized rect means a `display:contents` wrapper**, so keep descending a bounded
  depth instead of concluding "not found". Measure relative to your own box — the overlay layer's
  origin is not the viewport — and subtract the anchor's computed `padding-bottom` to land under its
  visible edge. Re-measure with a `ResizeObserver` on your parent and on the anchor, plus a viewport
  `resize` listener, and release them together. Keep `pointer-events:none` on the zero-size entry and
  `auto` only on the child that draws, and render **nothing** when measurement fails: a changed
  layout should cost the surface, not misplace it.
- **One trap in that pattern**: the wrapper cannot be measured before it exists, and its data often
  arrives a render later. An effect keyed only on "should this show" measures nothing on the first
  pass and never tries again — the surface then stays hidden forever. Include "is there anything to
  draw" in the dependencies.

## Popovers inside a list seat

A header cell may open its own dropdown. There is no platform helper for it in a
dependency-free bundle — the official cells use `dsh-client-ui-primitives`, which a
`react`-only bundle cannot require — so the pattern is:

- **Root is `position:relative`, the popover is `position:absolute`.** The official jobs cell
  does exactly this inside `.actions` (`top:calc(100% + 5px); left:0`), which is the proof that
  the header does not clip its children. Give the popover a `z-index`.
- **Register dismissal listeners on `document` while open, and remove them together.** One
  `pointerdown` (close when the event target is outside the root) and one `keydown` (Escape).
  Owning both in a single effect means they cannot leak one without the other, and unmounting
  the cell is enough to release them.
- **Only render a click target when there is something to open.** A `<span>` when there is not
  — no `onClick`, no `tabindex`, no focus ring. A cell that can do nothing must not look like a
  control.
- **Indent a tree with margins, not `padding`.** A guide line drawn with `border-left` sits on
  the row's own edge, so the edge has to move inward per level; `margin-left` does that and
  `padding-left` does not. Same reasoning for drawing a chevron with two borders instead of a
  `▾` character: a glyph depends on whichever font the user runs.

## Overlay seats

`shell.overlay` is a click-through layer, but its **direct children get `pointer-events:auto`
automatically**. Keep the registered root box no larger than its content — a full-frame box swallows
every click in the application.

Positioning and measurement techniques are v1 UI detail and deliberately not specified yet; see
[index](./index.md) for where that knowledge currently lives.
