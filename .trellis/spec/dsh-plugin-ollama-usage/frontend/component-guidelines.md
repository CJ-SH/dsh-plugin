# Component Guidelines

> How the browser half builds UI: plain function components, `createElement`, one stylesheet,
> additive seats.

---

## Component structure

Every component is a plain function declared inside `makeApply(ctx)` — never at module level — so
it closes over `h`, `copy` and the store:

```js
function makeApply(ctx) {
  const copy = activeIsChinese(ctx.locale) ? COPY_ZH : COPY_EN
  const h = React.createElement
  // …
  function UsagePill(props) { /* … */ }
}
```

Rules that follow from that shape:

- **No JSX and no build step.** `h = React.createElement` is the only constructor and the file
  ships as written; elements are built by nesting `h(type, props, ...children)`.
- **No class components, no HOCs, no context providers.** Components are functions, and shared
  state arrives through `useUsage()` / `useHero()` ([Hook Guidelines](./hook-guidelines.md)).
- **`null` means "nothing to show".** `UsageSurface` returns `null` unless the store phase is `ok`;
  a seat entry returns `null` only for its *contents*, never for its positioning box.
- **Every element in an array gets a `key`.** `WindowRow` keys its parts by name (`key: 'head'`,
  `key: 'bar'`); model rows use ``key: `${model.name}#${index}` ``.

Real examples: `lib/client.js:563` (`WindowRow`), `lib/client.js:593` (`UsagePill`),
`lib/client.js:616` (`UsageSurface`), `lib/client.js:793` (`ConfigCard`).

## Seats are the only way UI is placed

A surface is not rendered into a container the plugin owns; it is offered to a slot the shell
already renders. All three registrations live at the end of `makeApply`, wrapped in
`ctx.slots.inject`, which defers registration until that seat exists:

```js
ctx.slots.inject('conversation.composer.dock', () =>
  ctx.slots.register({ name: 'conversation.composer.dock', id: DOCK_ID, order: DOCK_ORDER }, DockEntry),
)
ctx.slots.inject('settings.plugin.item', () =>
  ctx.slots.register({ name: 'settings.plugin.item', key: NS }, ConfigCard),
)
```

| Seat | Own identity | Kind |
|---|---|---|
| `conversation.composer.dock` | `id: 'ollama-usage'`, `order: 1` | list — one line under the composer |
| `shell.overlay` | `id: 'ollama-usage-hero'`, `order: 1` | frame-wide floating layer, click-through except for its own children |
| `settings.plugin.item` | `key: 'ollama-usage'` (the settings namespace) | plugin configuration card |

`name` is the slot key; `id` / `key` is *your* cell. Writing the plugin's own id into `name` fails
the client half with `slot "<id>" is not declared` — the mistake `test/client.test.mjs` exists to
catch.

## Props conventions

- One `props` object, read explicitly in the body: `props.windowKey`, `props.headline`,
  `props.holder` (`lib/client.js:563`, `lib/client.js:593`).
- No destructuring in the signature, no `propTypes`, no defaults objects — the caller is a sibling
  function in the same closure.
- Callbacks are passed in (`onToggle`, `onChange`); a presentational component does not reach for
  the store, only a seat entry does.
- DOM nodes are captured with callback refs into a holder from `useNodeHolder()`:
  `ref: (node) => { props.holder.current = node }`.
- Repeated DOM shapes get a small helper instead of a component: `textInput(id, value, onChange)`
  (`lib/client.js:789`), `chevronSvg(open)` (`lib/client.js:541`).

## Styling patterns

- **One stylesheet, injected once.** `CSS` is a single joined string of `.ollama-usage-*` rules; it
  is appended as `<style data-plugin="ollama-usage-client">` inside `ctx.effect` and removed when
  the plugin unloads (`lib/client.js:390`).
- **Design tokens only, always with a fallback.** Colours and type come from `--dsw-*`
  (`--dsw-alias-label-tertiary`, `--dsw-alias-border-l1`, `--dsw-specific-tip`); composer geometry
  comes from `--dsh-*` (`var(--dsh-chat-content-width,720px)`).
- **State is expressed as `data-*` attributes**, not conditional class names or inline styles:
  `data-open="true"`, `data-flow`, `data-mode="anchored"`, `data-active="true"`.
- **Inline styles are reserved for measured geometry** (`left` / `top` in px on the slot) and the
  progress-bar width; everything else is a class.
- Values that change size (percentages, counts) use `font-variant-numeric: tabular-nums`.

## Layout and measurement

The dock cannot move the built-in cluster, so it positions itself beside it:

- The seat's root box is **always mounted** and is `height:0; position:relative`; the pill lives in
  an absolutely positioned `.ollama-usage-slot` inside it. Only the contents are gated.
- `getBoundingClientRect()` returns **viewport** coordinates; relative positioning subtracts the
  plugin's own rect (`left = metrics.right - own.left + INLINE_GAP_PX`, `lib/client.js:497`).
- The built-in cluster is found by walking siblings (`findPillRow`) and unioning its children
  (`rowMetrics`); `resolveBox` walks through `display:contents` wrappers and `narrowToContent`
  descends single-child wrappers.
- `measureHero` anchors under `[data-slot="conversation.composer.bar"]` and subtracts the
  container's `padding-bottom` (`lib/client.js:519`).
- Every measurement has a fallback mode (`flow` for the dock, `fixed` for the hero) that keeps the
  pill visible when nothing can be measured.

## Accessibility

| Requirement | Implementation |
|---|---|
| Interactive elements are real buttons | `<button type="button">` with a class-based reset |
| Expanded state is announced | `aria-expanded` on the pill and the card header |
| Icons are decorative | `aria-hidden` on `chevronSvg` output; the glyph is a styled `<i>` |
| The pill has a full description | composed `aria-label` + `title` from `copy.pillTitle(...)` |
| The panel is a dialog | `role="dialog"` on `.ollama-usage-panel` |
| The mode picker is a radio group | `role="radiogroup"` with `aria-checked` per option |
| Keyboard exit | `Esc` closes the panel and returns focus to the pill (`lib/client.js:623`) |
| Focus is visible | `:focus-visible` outline defined in `CSS`, not the browser default |

## Common mistakes

| Mistake | Symptom |
|---|---|
| Gating the positioning box (`return null` while loading) | It never reaches the DOM, so measurement never runs and the pill permanently falls back to its own centered row |
| Mixing viewport and local coordinates | The pill lands on top of the built-in cluster (observed during prototyping) |
| Making an overlay root full-frame | `shell.overlay` children get `pointer-events:auto` automatically, so a full-frame box blocks the whole app |
| Forgetting a `key` in mapped children | Unstable reconciliation and React warnings in the panel |
| Hardcoding a user-visible string | The other locale shows a missing or stale label — text belongs in `COPY_ZH` and `COPY_EN` |
| Using the plugin id as the slot `name` | `client-half-failed: slot "<id>" is not declared` |
