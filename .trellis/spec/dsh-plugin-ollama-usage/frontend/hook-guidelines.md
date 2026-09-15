# Hook Guidelines

> Hooks in the browser half: where they live, how they subscribe, how they touch the DOM, and
> which timing primitives to use.

---

## Where hooks live

- Hooks are used **only inside components declared in `makeApply(ctx)`** — never at module scope,
  never in the bundle's outer `factory` body. Components are ordinary functions, so the usual rules
  apply: same order every render, no hooks in loops or conditions.
- `UsageSurface` calls `useUsage()` and `useState` **before** its
  `if (state.phase !== 'ok') return null` early exit (`lib/client.js:616`). Keep early returns after
  every hook.
- The React surface this bundle uses: `createElement`, `useState`, `useEffect`, `useLayoutEffect`.
  Nothing else is assumed of the platform baseline.

## DOM holders instead of `useRef`

```js
const useNodeHolder = () => React.useState(() => ({ current: null }))[0]
```

The holder is a lazily created, stable mutable object; refs are written with callback refs
(`ref: (node) => { box.current = node }`). This is the local convention — the bundle commits to the
smallest React surface the shell guarantees.

## Layout effects

```js
const useIsoLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect
```

Use `useIsoLayoutEffect` for anything that measures or positions before paint (both seat entries
do). Plain `React.useEffect` is for data subscriptions and async work, where a paint between commit
and effect is harmless.

## Subscription hooks

The store is not a React library; components subscribe to it with a listener set plus a version
counter (`lib/client.js:476`):

```js
function useUsage() {
  const [, setVersion] = React.useState(0)
  React.useEffect(() => {
    const listener = () => setVersion((current) => current + 1)
    dataListeners.add(listener)
    return () => dataListeners.delete(listener)
  }, [])
  return { phase: store.phase, usage: store.usage }
}
```

- Subscribe in the effect, unsubscribe in the cleanup — always return one.
- The hook returns the current snapshot; a component never copies store state into its own state.
- `useHero()` follows the same shape against `phaseListeners` and calls its listener once
  immediately, so a late subscriber still receives the current value.

## Effects that own something

| Owned thing | Primitive | Cleanup |
|---|---|---|
| Stylesheet | `ctx.effect(fn, 'ollama-usage: stylesheet')` — not a hook | returned `tag.remove()` |
| Polling | `ctx.interval(fn, REFRESH_INTERVAL_MS)` — refcounted ([State Management](./state-management.md)) | returned stop function |
| Settle timer | `ctx.timeout(fn, SETTLE_DELAY_MS)` | none needed (one-shot) |
| Dock mount counter | mount effect calling `markDockMounted()` | returned unmount function |
| DOM observers | `view.ResizeObserver` + `view.addEventListener('resize', …)` | `observer.disconnect()`, `removeEventListener` |

`ctx.effect` is for plugin-scoped resources and takes a label. `ctx.timeout` / `ctx.interval` come
from the `timer` service, which must be declared in the bundle's `inject`. Do not use
`setTimeout` / `setInterval`, and do not attach the poll to a component.

## Async effects

The config card loads two resources and re-loads on demand:

```js
React.useEffect(() => {
  let cancelled = false
  request('config/read', {}) // …
  return () => { cancelled = true }
}, [reloadToken])
```

- Guard every state write with the `cancelled` flag; the cleanup sets it.
- Re-running on demand is expressed as a **token**: `setReloadToken((current) => current + 1)`
  after a successful write. Do not call the loader imperatively from an event handler.

## Measurement effects

```js
const modeKey = align === null ? 'none' : align.mode
useIsoLayoutEffect(() => { /* measure + setAlign */ }, [phase, modeKey])       // DockEntry
useIsoLayoutEffect(() => { /* measure + setAlign */ }, [heroKey, modeKey, phase]) // HeroEntry
```

- Dependencies are **the data phase and the current placement mode**, never `[]`: a measurement
  taken before data arrives, or before a mode switch, is wrong rather than merely stale.
- Inside: measure, then `setAlign((current) => (samePlacement(current, next) ? current : next))`, so
  an unchanged measurement does not re-render and re-observe.
- Observe every anchor whose geometry can move the pill (the parent chain, the built-in row, the
  composer outlet) plus a viewport `resize` listener; disconnect all of them in the cleanup.
- Feature-detect before use: `typeof view.ResizeObserver !== 'function'` degrades to a single
  static measurement.

## Common mistakes

| Mistake | Symptom |
|---|---|
| Measuring with `[]` dependencies | The pill keeps its pre-data layout; a mode switch is never re-measured |
| Returning no cleanup from a subscription effect | Listeners accumulate per mount, so the count grows with navigation |
| Putting the poll inside a component effect | Every surface starts its own poll instead of sharing one refcounted interval |
| Calling `ctx.timeout` without declaring `timer` | `cannot get property "timer" without inject` |
| Using `setTimeout` for the settle delay | The timer outlives the plugin and is never disposed |
| Introducing `useRef` / `useMemo` / `useCallback` | The harness React stubs implement only `createElement`, `useState`, `useEffect`, `useLayoutEffect` — the suites throw |
