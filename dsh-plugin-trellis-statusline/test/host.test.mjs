/**
 * Host-half harness. Mounts the real Host half against a fake cordis context and a
 * throwaway workspace on disk, so the whole resolution chain — session → cwd → session
 * pointer → workspace scan → none — is observable without dsh running.
 *
 *   node test/host.test.mjs
 *
 * The fixture workspace lives in `test/.tmp/` and is removed again before the process
 * exits, so a run leaves nothing behind.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostUrl = new URL('../lib/index.js', import.meta.url)
const clientUrl = new URL('../lib/client.js', import.meta.url)
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const results = []
const check = (label, actual, expected) => {
  results.push({ label, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
}

const SESSION = 'session-66d44746-abbf-4a3d-bd21-a9374eae2bd1'
const OTHER_SESSION = 'session-3724610a-d67b-4d50-97ab-e7856427ab12'

// --- Fake cordis context ----------------------------------------------------------------
let liveSessions = {}
let workspaces = []
const seen = { channel: null, handler: null, disposed: false }

const services = {
  sessions: { get: (id) => liveSessions[id] },
  workspaceRegistry: { list: () => workspaces },
  connection: {
    rpc: {
      handle(channel, handler) {
        seen.channel = channel
        seen.handler = handler
        return () => {
          seen.disposed = true
        }
      },
    },
  },
  webServer: {},
}
const effects = []
const ctx = {
  ...services,
  get: (serviceName) => services[serviceName],
  effect(callback, label) {
    const disposer = callback()
    effects.push({ label, disposer })
    return disposer
  },
}

const { apply, inject, name } = await import(hostUrl.href)
apply(ctx)

const read = (sessionId, extra) => seen.handler('task/read', { sessionId, ...extra })

// --- Fixture workspaces -----------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url))
const scratch = join(here, '.tmp')
await rm(scratch, { recursive: true, force: true })
await mkdir(scratch, { recursive: true })

// `branch` is what `task.py start` records; a task without one was never started. Scan
// fixtures carry it so they look like real work, and the dedicated cases below omit it.
const taskJson = (title, status, priority = 'P2', branch = 'master') => ({
  id: title,
  name: title,
  title,
  status,
  priority,
  branch,
})

async function makeWorkspace(label) {
  const root = join(scratch, label)
  await mkdir(join(root, '.trellis', 'tasks'), { recursive: true })
  return root
}
async function writeTask(root, dirName, task) {
  const dir = join(root, '.trellis', 'tasks', dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'task.json'), JSON.stringify(task, null, 2))
}
async function writePointer(root, sessionId, taskRef) {
  const dir = join(root, '.trellis', '.runtime', 'sessions')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `dsh_${sessionId}.json`),
    JSON.stringify({ platform: 'dsh', last_seen_at: '2026-09-15T05:30:12Z', current_task: taskRef, current_run: null }),
  )
}
const pointAt = (cwd) => {
  liveSessions = { [SESSION]: { header: { id: SESSION, cwd } } }
}

// --- Packaging contract -----------------------------------------------------------------
check('plugin name is the package name', name, packageJson.name)
check('inject declares the three required services', inject, ['sessions', 'connection', 'webServer'])
check('the RPC channel is mounted at the plugin channel', seen.channel, '/trellis-statusline')
check('the channel registration is wrapped in an effect', typeof effects[0]?.disposer, 'function')

// A row that throws in `apply` fails the whole plugin tree, so an unavailable channel must
// degrade to "one UI surface fewer" instead of blocking the boot.
const logged = []
const originalError = console.error
console.error = (message) => logged.push(String(message))
const throwingCtx = {
  get: () => undefined,
  effect: (callback) => callback(),
  connection: {
    rpc: {
      handle() {
        throw new Error('cannot get property "webServer" without inject')
      },
    },
  },
}
let survived = true
try {
  apply(throwingCtx)
} catch {
  survived = false
}
console.error = originalError
check('apply survives an unavailable RPC channel', survived, true)
check('the degradation is logged once', logged.length, 1)
check('the log names the plugin', logged[0]?.startsWith('[trellis-statusline]'), true)

// --- cwd resolution (design.md §2.1, conclusions A and B) --------------------------------
const wsLive = await makeWorkspace('live')
await writeTask(wsLive, '09-15-alpha', taskJson('Alpha task', 'in_progress', 'P1'))

pointAt(wsLive)
check('cwd comes from the live session header', (await read(SESSION)).value.task.id, '09-15-alpha')

liveSessions = {}
workspaces = [{ id: 'ws-1', path: wsLive, sessionIds: [SESSION] }]
check('cwd falls back to the workspace registry', (await read(SESSION)).value.task.id, '09-15-alpha')

workspaces = []
check('no cwd anywhere is an empty state', await read(SESSION), { ok: true, value: { status: 'none' } })
check('a blank sessionId is an empty state', await read(''), { ok: true, value: { status: 'none' } })
check('an unknown session does not borrow another session\'s workspace', await (async () => {
  workspaces = [{ id: 'ws-1', path: wsLive, sessionIds: [OTHER_SESSION] }]
  const reply = await read(SESSION)
  workspaces = []
  return reply
})(), { ok: true, value: { status: 'none' } })

// --- D1 step 2: the session pointer wins over the scan -----------------------------------
const wsPointer = await makeWorkspace('pointer')
pointAt(wsPointer)
// The pointed-at task is deliberately never-started (no `branch`): a pointer is direct
// evidence that a session started the task, so the pointer path does not apply the
// scan's "was it ever started" filter — it must still win here.
await writeTask(wsPointer, '09-15-older', { ...taskJson('Older planning task', 'planning', 'P3'), branch: null })
await writeTask(wsPointer, '09-16-newer', taskJson('Newer in-progress task', 'in_progress', 'P1'))
await writePointer(wsPointer, SESSION, '.trellis/tasks/09-15-older')
check('an explicit session pointer outranks the scan', (await read(SESSION)).value.task, {
  id: '09-15-older',
  title: 'Older planning task',
  status: 'planning',
  priority: 'P3',
})

// --- D1 step 3: the scan, its ranking and its tie-break ----------------------------------
const wsScan = await makeWorkspace('scan')
pointAt(wsScan)
await writeTask(wsScan, '09-15-alpha', taskJson('Alpha planning', 'planning'))
await writeTask(wsScan, '09-16-beta', taskJson('Beta in progress', 'in_progress'))
check('in_progress outranks planning', (await read(SESSION)).value.task.id, '09-16-beta')

await writeTask(wsScan, '09-17-gamma', taskJson('Gamma also in progress', 'in_progress'))
await writeTask(wsScan, '09-18-delta', taskJson('Delta also in progress', 'in_progress'))
check('equal ranks take the lexicographically greatest directory name', (await read(SESSION)).value.task.id, '09-18-delta')

await writeTask(wsScan, '09-19-epsilon', taskJson('Epsilon completed', 'completed'))
check('a completed task is not a candidate', (await read(SESSION)).value.task.id, '09-18-delta')

// A never-started task is skipped even when it would otherwise win the tie-break.
await writeTask(wsScan, '09-20-never-started', { ...taskJson('Never started', 'in_progress'), branch: null })
check('a never-started task is not a scan candidate', (await read(SESSION)).value.task.id, '09-18-delta')

// A pointer that names something unusable must degrade to the scan, not to an error.
await writePointer(wsScan, SESSION, '.trellis/tasks/does-not-exist')
check('a stale pointer falls through to the scan', (await read(SESSION)).value.task.id, '09-18-delta')
await writePointer(wsScan, SESSION, '../../../../etc/passwd')
check('a pointer escaping .trellis is refused', (await read(SESSION)).value.task.id, '09-18-delta')
await writePointer(wsScan, SESSION, '.trellis/tasks/09-18-delta')
await writeFile(join(wsScan, '.trellis', 'tasks', '09-18-delta', 'task.json'), '{ not json')
check('a corrupt pointed-at task.json falls through to the scan', (await read(SESSION)).value.task, {
  id: '09-17-gamma',
  title: 'Gamma also in progress',
  status: 'in_progress',
  priority: 'P2',
})

// --- Empty states -----------------------------------------------------------------------
const wsEmpty = await makeWorkspace('empty')
pointAt(wsEmpty)
check('a workspace with no tasks is an empty state', await read(SESSION), { ok: true, value: { status: 'none' } })

// --- The reported false positive: `trellis init` scaffolding is not active work -----------
// Every fresh Trellis project carries this task at `status: in_progress` with `branch: null`,
// forever, because nothing ever started it. Reporting it made the pill claim that a
// never-touched setup task was the workspace's active work.
const wsScaffold = await makeWorkspace('scaffold')
pointAt(wsScaffold)
const scaffold = {
  id: '00-bootstrap-guidelines',
  name: '00-bootstrap-guidelines',
  title: 'Bootstrap Guidelines',
  status: 'in_progress',
  priority: 'P1',
  branch: null,
  base_branch: null,
  notes: 'First-time setup task created by trellis init (fullstack project)',
}
await writeTask(wsScaffold, '00-bootstrap-guidelines', scaffold)
check('a never-started scaffolding task is not reported', await read(SESSION), { ok: true, value: { status: 'none' } })

// The same file, differing only in the one field `task.py start` writes.
await writeTask(wsScaffold, '00-bootstrap-guidelines', { ...scaffold, branch: 'master' })
check('the same task counts once it has been started', (await read(SESSION)).value.task, {
  id: '00-bootstrap-guidelines',
  title: 'Bootstrap Guidelines',
  status: 'in_progress',
  priority: 'P1',
})

const wsNoTrellis = join(scratch, 'no-trellis')
await mkdir(wsNoTrellis, { recursive: true })
pointAt(wsNoTrellis)
check('a workspace without .trellis is an empty state', await read(SESSION), { ok: true, value: { status: 'none' } })

pointAt(join(scratch, 'does-not-exist'))
check('a cwd that does not exist is an empty state', await read(SESSION), { ok: true, value: { status: 'none' } })

const wsBroken = await makeWorkspace('broken')
pointAt(wsBroken)
await writeTask(wsBroken, '09-15-broken', taskJson('Broken', 'in_progress'))
await writeFile(join(wsBroken, '.trellis', 'tasks', '09-15-broken', 'task.json'), '{ not json')
check('a corrupt task.json is an empty state', await read(SESSION), { ok: true, value: { status: 'none' } })

// --- Field discipline -------------------------------------------------------------------
const wsFields = await makeWorkspace('fields')
pointAt(wsFields)
await writeTask(wsFields, '09-15-fields', { title: '  Spaced title  ', status: 'in_progress', priority: '', branch: 'master' })
check('a blank priority is omitted, not defaulted', (await read(SESSION)).value.task, {
  id: '09-15-fields',
  title: 'Spaced title',
  status: 'in_progress',
})
await writeTask(wsFields, '09-15-fields', { status: 'in_progress', title: '', branch: 'master' })
check('a missing title falls back to the directory name', (await read(SESSION)).value.task.title, '09-15-fields')
await writeTask(wsFields, '09-15-fields', { title: 'x'.repeat(80), status: 'in_progress', branch: 'master' })
const long = (await read(SESSION)).value.task.title
check('a long title is truncated to 48 characters', [long.length, long.endsWith('…')], [48, true])

// --- Protocol ---------------------------------------------------------------------------
check('an unknown endpoint is the one loud protocol error', await seen.handler('task/write', {}), {
  ok: false,
  error: { code: 'unknown-endpoint', message: 'unknown trellis-statusline endpoint: task/write' },
})
check('a missing payload does not throw', (await seen.handler('task/read', undefined)).ok, true)
check('a non-record payload does not throw', (await seen.handler('task/read', 'nonsense')).value.status, 'none')

// --- AC6: the read path never writes ----------------------------------------------------
async function snapshot(root) {
  const rows = []
  const walk = async (dir) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const info = await stat(full)
      const digest = createHash('sha256').update(await readFile(full)).digest('hex').slice(0, 16)
      rows.push([full.slice(root.length), info.mtimeMs, info.size, digest])
    }
  }
  await walk(root)
  return rows
}
pointAt(wsScan)
const before = await snapshot(join(wsScan, '.trellis'))
for (const sessionId of [SESSION, OTHER_SESSION, '']) await read(sessionId)
const after = await snapshot(join(wsScan, '.trellis'))
check('reading a workspace leaves its .trellis byte-identical', after, before)

const hostSource = await readFile(hostUrl, 'utf8')
check('host half imports nothing from the harness', /from\s+['"]@deepseek-ai\//.test(hostSource), false)
check('host half imports only node: builtins and relative paths', [...hostSource.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]).sort(), ['node:fs/promises', 'node:path'])
check(
  'host half contains no write API',
  /writeFile|appendFile|rename\(|unlink|rmdir|\bmkdir\b|\brm\(|createWriteStream|truncate/.test(hostSource),
  false,
)

// --- Cross-half contract ----------------------------------------------------------------
const clientSource = await readFile(clientUrl, 'utf8')
const endpointsIn = (source) => [...new Set([...source.matchAll(/'([a-z]+\/[a-z]+)'/g)].map((match) => match[1]))].sort()
check('both halves agree on the channel', [
  hostSource.includes("const CHANNEL = '/trellis-statusline'"),
  clientSource.includes("const CHANNEL = '/trellis-statusline'"),
], [true, true])
check('both halves agree on the endpoint', endpointsIn(hostSource), ['task/read'])
check('the client calls the endpoint the host handles', endpointsIn(clientSource), endpointsIn(hostSource))

await rm(scratch, { recursive: true, force: true })

const failed = results.filter((entry) => !entry.ok)
for (const entry of results) {
  console.log(
    `${entry.ok ? 'PASS' : 'FAIL'}  ${entry.label}` +
      (entry.ok ? '' : `\n      expected ${JSON.stringify(entry.expected)}\n      actual   ${JSON.stringify(entry.actual)}`),
  )
}
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length === 0 ? 0 : 1
