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

| Seat | Own identity | Kind | Used since |
|---|---|---|---|
| `conversation.composer.dock` | `id: 'ollama-usage'`, `order: 1` | list — one row **below** the composer card (not rendered in the hero phase) | v1 |
| `conversation.input.dock` | `id: 'ollama-usage-hero'`, `order: 1`; `id: 'trellis-statusline-dock'`, `order: 30` | list — full-width entries **above** the composer card; flow-laid, renders in both phases | 2026-09-20 |
| `conversation.session.header.actions` | `id: 'trellis-statusline'`, `order: 10` | list — title-adjacent actions | 2026-09-15 |
| `settings.plugin.item` | `key: 'ollama-usage'` (the settings namespace) | plugin configuration card | v1 |
| `shell.overlay` | — | frame-wide floating layer; **these plugins no longer use it** | retired 2026-09-20 |

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
  phase.** A surface that must be visible before the first message needs a second seat; since
  2026-09-20 that seat is `conversation.input.dock` (see the next section), not `shell.overlay`.
  Do not expect a header seat to cover that phase.
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
- **The hero-phase seat is `conversation.input.dock`, a flow row — measure nothing.** Both plugins
  moved there on 2026-09-20 and the entire overlay path (`measureHero()`, `ResizeObserver`,
  viewport listener, computed `padding-bottom` arithmetic, the `shell.overlay` registrations) was
  deleted. The measured overlay was the *shared* explanation for the collision it produced: two
  independently positioned pills in unmanaged space overlapped by ~9px, and no plugin can see the
  other's coordinates. A flow row removes the class of bug rather than tuning it.
- **The seat's anchor is `display:contents` — inline — so entries stack in the composer's column.**
  The catalog calls `conversation.input.dock` "full-width entries above the composer card", and the
  anchor renders as `<div data-slot="conversation.input.dock" style="display:contents">`. Each entry
  is therefore a direct child of the composer's vertical stack: **one row per entry**. Two compact
  pills that belong on one line need the anchor re-flowed, and only `!important` beats the inline
  style:
  ```css
  [data-slot="conversation.input.dock"]{display:flex !important;flex-flow:row wrap;justify-content:center;align-items:center;gap:var(--dsh-composer-stack-gap,6px)}
  ```
  **Both plugins inject that identical rule** — idempotent, so one installation alone is still
  correct. Under `row wrap` the official full-width entrants (queue / todo / goal) still take a line
  of their own, so this override does not reshuffle them.
- **A pill in that row must be content-sized.** `display:inline-flex` on the entry, **no**
  `width:100%`, or it claims the whole line and the two-pill row degrades to two rows.
- **State the residual cost honestly**: this override is the one place these plugins style a
  shell-owned element. If the shell ever changes that anchor's semantics, the failure mode is "two
  rows instead of one" (or a spacing change), not a lost surface.
- **A hero entry is gated on "blank **and** nothing to draw".** The composer row stays mounted across
  the blank→active transition, so an entry that only checks the phase renders a stale pill next to
  the header one — the trap the cell harness pins.

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

## Overlay seats (retired here, still a platform seat)

These plugins no longer register anything on `shell.overlay` (2026-09-20), but the seat's own
contract is worth keeping: it is a click-through layer whose **direct children get
`pointer-events:auto` automatically**. Keep the registered root box no larger than its content — a
full-frame box swallows every click in the application.

Positioning and measurement techniques are v1 UI detail and deliberately not specified yet; see
[index](./index.md) for where that knowledge currently lives.
