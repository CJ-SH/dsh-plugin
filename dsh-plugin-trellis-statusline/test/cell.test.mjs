/**
 * Cell harness. Drives the real header cell with a minimal hook runtime, so the rendering
 * rules and the polling lifecycle are observable without a browser:
 * "ok renders [P1] title · state", "none renders nothing", "sessionId re-requests",
 * "unmount disposes the interval".
 *
 *   node test/cell.test.mjs
 */
import { readFile } from 'node:fs/promises'

const clientUrl = new URL('../lib/client.js', import.meta.url)

const results = []
const check = (label, actual, expected) => {
  results.push({ label, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
}

// --- Minimal hook runtime, one store per component ----------------------------------------
const stores = new WeakMap()
let active = null
let cursor = 0
let dirty = false
const storeOf = (component) => {
  let store = stores.get(component)
  if (store === undefined) {
    store = { states: [], deps: [], pending: [], cleanups: [] }
    stores.set(component, store)
  }
  return store
}
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: (initial) => {
    const store = storeOf(active)
    const index = cursor
    cursor += 1
    if (!(index in store.states)) store.states[index] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      const value = typeof next === 'function' ? next(store.states[index]) : next
      if (Object.is(value, store.states[index])) return
      store.states[index] = value
      dirty = true
    }
    return [store.states[index], set]
  },
  useEffect: (effect, list) => {
    const store = storeOf(active)
    const index = cursor
    cursor += 1
    const previous = store.deps[index]
    const changed =
      previous === undefined ||
      list === undefined ||
      list.length !== previous.length ||
      list.some((entry, at) => !Object.is(entry, previous[at]))
    if (!changed) return
    // React disposes the previous effect before running the replacement — the same rule
    // that makes "switching session" observable here rather than only on unmount.
    if (typeof store.cleanups[index] === 'function') store.cleanups[index]()
    store.cleanups[index] = null
    store.deps[index] = list
    store.pending.push([index, effect])
  },
  useLayoutEffect: (effect, list) => reactStub.useEffect(effect, list),
}

let factory = null
globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory } } }
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { append: () => undefined },
  querySelector: () => null,
}

await import(clientUrl.href)
const exported = factory((request) => {
  if (request === 'react') return reactStub
  throw new Error(`unexpected require("${request}")`)
})

const SESSION = 'session-66d44746-abbf-4a3d-bbf1-a9374eae2bd1'
const OTHER = 'session-3724610a-d67b-4d50-97ab-e7856427ab12'
const TASK = { id: '09-15-trellis-statusline', title: 'Trellis statusline plugin for dsh web', status: 'in_progress', priority: 'P1' }

const calls = []
const intervals = []
const disposed = []
let reply = { ok: true, value: { status: 'ok', task: TASK } }
let rejectNext = false

const caught = []
const services = {
  slots: {
    inject: (key, callback) => callback(),
    register: (options, component) => {
      caught.push({ options, component })
      return () => undefined
    },
  },
  locale: {
    getLocale: () => ({ active: 'zh' }),
    register: () => () => undefined,
  },
  connection: {
    rpc: {
      async call(channel, endpoint, payload) {
        calls.push({ channel, endpoint, payload })
        if (rejectNext) {
          rejectNext = false
          throw new Error('socket closed')
        }
        return reply
      },
    },
  },
}
const ctx = {
  ...services,
  get: (serviceName) => services[serviceName],
  effect: (callback) => callback(),
  interval(callback, delay) {
    intervals.push({ delay, callback })
    return () => disposed.push(delay)
  },
}

exported.apply(ctx)
const Cell = caught[0]?.component
check('captured the header cell', typeof Cell, 'function')
check('apply itself starts no interval', intervals.length, 0)

// --- Hook runtime driver ------------------------------------------------------------------
function render(props) {
  active = Cell
  cursor = 0
  const store = storeOf(Cell)
  store.pending = []
  const tree = Cell(props)
  for (const [index, effect] of store.pending) store.cleanups[index] = effect() ?? null
  return tree
}
async function settle(props, rounds = 12) {
  let tree = render(props)
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    if (!dirty) break
    dirty = false
    tree = render(props)
  }
  return tree
}
const flatten = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatten).join('')
  return (node.children ?? []).map(flatten).join('')
}
const findRoot = (node) => {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null
  return node.props?.className === 'trellis-statusline' ? node : null
}

// --- 1. A task is active ------------------------------------------------------------------
const tree = await settle({ sessionId: SESSION })
check('the cell requested this session', calls[0]?.payload, { sessionId: SESSION })
check('it used the private channel', calls[0]?.channel, '/trellis-statusline')
check('it used the read endpoint', calls[0]?.endpoint, 'task/read')
check('the pill reads [P1] title · state', flatten(tree), '[P1] Trellis statusline plugin for dsh web · 进行中')
check('the pill is one root element', findRoot(tree) !== null, true)
check('the root carries the state for styling', findRoot(tree)?.props?.['data-status'], 'in_progress')
check('the root carries the untruncated title', findRoot(tree)?.props?.title, TASK.title)
check('it polls on the designed cadence', intervals.map((entry) => entry.delay), [10_000])

// --- 2. Polling refreshes the pill --------------------------------------------------------
reply = { ok: true, value: { status: 'ok', task: { ...TASK, status: 'planning', priority: 'P2' } } }
intervals[0].callback()
check('the poll asks again', calls.length, 2)
check('the pill follows the new state', flatten(await settle({ sessionId: SESSION })), '[P2] Trellis statusline plugin for dsh web · 规划中')

// --- 3. No active task: the row must disappear, not go blank ------------------------------
reply = { ok: true, value: { status: 'none' } }
intervals[0].callback()
check('an empty state renders nothing at all', await settle({ sessionId: SESSION }), null)

// --- 4. Every failure mode is the same empty state ----------------------------------------
for (const [label, answer] of [
  ['a rejection', null],
  ['a malformed envelope', { ok: 'yes' }],
  ['a failed envelope', { ok: false, error: { code: 'unknown-endpoint', message: 'nope' } }],
  ['an unknown payload shape', { ok: true, value: { status: 'ok' } }],
]) {
  reply = answer
  intervals[0].callback()
  const settled = await settle({ sessionId: SESSION })
  check(`${label} renders nothing`, settled, null)
  reply = { ok: true, value: { status: 'ok', task: TASK } }
}
check('a rejected call is caught, not thrown', await (async () => {
  rejectNext = true
  intervals[0].callback()
  await new Promise((resolve) => setTimeout(resolve, 2))
  return (await settle({ sessionId: SESSION })) === null
})(), true)

// --- 5. An unknown task status still shows the task ---------------------------------------
reply = { ok: true, value: { status: 'ok', task: { ...TASK, status: 'archived' } } }
intervals[0].callback()
check('an unknown status falls back to a generic word', flatten(await settle({ sessionId: SESSION })), '[P1] Trellis statusline plugin for dsh web · 未知状态')

reply = { ok: true, value: { status: 'ok', task: { id: 'x', title: 'No priority', status: 'planning' } } }
intervals[0].callback()
check('a task without a priority drops the bracket', flatten(await settle({ sessionId: SESSION })), 'No priority · 规划中')

// --- 6. Switching session re-requests immediately -----------------------------------------
reply = { ok: true, value: { status: 'ok', task: TASK } }
const before = calls.length
await settle({ sessionId: OTHER })
check('a new sessionId triggers its own request', [calls.length - before, calls.at(-1)?.payload], [1, { sessionId: OTHER }])
check('a new sessionId starts its own interval', intervals.length, 2)
check('a new sessionId disposes the previous interval', disposed, [10_000])

// --- 7. Unmount disposes the interval -----------------------------------------------------
const store = storeOf(Cell)
for (const cleanup of store.cleanups) if (typeof cleanup === 'function') cleanup()
check('unmount disposed the remaining interval', disposed, [10_000, 10_000])

// --- 8. The cell survives a seat that does not project `t` --------------------------------
const plain = await settle({ sessionId: SESSION })
check('a missing translator still renders localized text', flatten(plain).endsWith('进行中'), true)

const failed = results.filter((entry) => !entry.ok)
for (const entry of results) {
  console.log(
    `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.label}` +
      (entry.ok ? '' : `\n      expected ${JSON.stringify(entry.expected)}\n      actual   ${JSON.stringify(entry.actual)}`),
  )
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length === 0 ? 0 : 1
