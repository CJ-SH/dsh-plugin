/**
 * dsh-plugin-trellis-statusline — browser half.
 *
 * Shipped in the module-loader bundle form: this file's only job is to register a factory
 * with the shell's loader, which materializes it as a plugin when the web shell needs it.
 * `react` is resolved from the platform baseline, so this bundle requests nothing else.
 *
 * One additive surface: a cell in `conversation.session.header.actions` — the title-adjacent
 * session actions row, immediately right of the session-preset selector — showing the Trellis
 * task the session's workspace is working on. The cell asks the Host half over the private
 * `/trellis-statusline` channel and renders nothing at all when there is no task — an ordinary
 * conversation must not grow a control for a capability it is not using.
 *
 * It registers its own locale namespace and lets the seat project `t`, which is how the
 * official same-header cells stay translatable without re-registering on a locale change.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-trellis-statusline',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const name = 'dsh-plugin-trellis-statusline'
    const inject = ['slots', 'locale', 'connection', 'timer']

    const CHANNEL = '/trellis-statusline'
    const ENDPOINT_READ = 'task/read'

    /** The seat: title-adjacent session actions, in ascending order. */
    const SEAT = 'conversation.session.header.actions'
    const CELL_ID = 'trellis-statusline'
    /**
     * Right of the session-preset selector (`agent-preset`, order -10) and left of the
     * background-jobs counter (`job-list`, order 20). The title-adjacent row has room for a
     * task title where the right-aligned utilities row does not.
     */
    const CELL_ORDER = 10

    const REFRESH_INTERVAL_MS = 10_000

    /**
     * Statuses this seat has words for. Trellis' full vocabulary is
     * `planning | in_progress | review | completed` (`task.py`'s `--status` help), and only
     * the first two are ever *scanned* for; but the session pointer is authoritative and
     * unfiltered, so it can legitimately deliver `review` or `completed`. Anything outside
     * this table falls back to a generic word rather than leaking a raw token into the header.
     */
    const STATE_KEYS = {
      in_progress: 'state.in_progress',
      planning: 'state.planning',
      review: 'state.review',
      completed: 'state.completed',
    }
    const STATE_UNKNOWN = 'state.unknown'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'state.in_progress': '进行中',
      'state.planning': '规划中',
      'state.review': '审核中',
      'state.completed': '已完成',
      'state.unknown': '未知状态',
    }
    /** English dictionary, key-identical to the Chinese source of truth. */
    const en = {
      'state.in_progress': 'in progress',
      'state.planning': 'planning',
      'state.review': 'in review',
      'state.completed': 'completed',
      'state.unknown': 'unknown state',
    }

    /** Theme tokens only, so the pill follows light/dark without its own palettes. */
    const CSS = [
      '.trellis-statusline{box-sizing:border-box;min-width:0;max-width:100%;color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;padding:3px 2px;font-size:12px;line-height:18px;white-space:nowrap;display:inline-flex}',
      '.trellis-statusline-priority{flex:none;color:var(--dsw-alias-brand-primary);font-weight:500;font-variant-numeric:tabular-nums}',
      '.trellis-statusline-title{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.trellis-statusline-separator{flex:none;opacity:.6}',
      '.trellis-statusline-state{flex:none}',
      '.trellis-statusline[data-status="in_progress"] .trellis-statusline-state{color:var(--dsw-alias-state-success-primary)}',
      '.trellis-statusline[data-status="planning"] .trellis-statusline-state{color:var(--dsw-alias-state-warn-primary)}',
    ].join('\n')

    const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
    const readText = (value) => (typeof value === 'string' ? value.trim() : '')

    function errorMessage(error) {
      if (error === null || error === undefined) return 'unknown error'
      const message = error.message
      if (typeof message === 'string' && message.length > 0) return message
      return String(error)
    }

    /**
     * Chinese unless the locale service says otherwise — the same default the sibling plugin
     * uses, so a service that cannot answer does not silently flip the UI to English.
     */
    function activeIsChinese(locale) {
      try {
        const active = readText(locale.getLocale().active)
        return active.length === 0 ? true : active.indexOf('zh') === 0
      } catch {
        return true
      }
    }

    /**
     * Re-narrow the Host half's reply rather than trusting it. Anything that is not exactly
     * `{ status: 'ok', task: { title, status, ... } }` means "nothing to show" — the same
     * `null` this seat renders for a session without a task.
     */
    function decodeTask(value) {
      if (!isRecord(value) || value.status !== 'ok' || !isRecord(value.task)) return null
      const title = readText(value.task.title)
      const status = readText(value.task.status)
      if (title.length === 0 || status.length === 0) return null
      return { title, status, priority: readText(value.task.priority) }
    }

    function makeApply(ctx) {
      const h = React.createElement
      const copy = activeIsChinese(ctx.locale) ? zh : en

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = name
        tag.textContent = CSS
        document.head.append(tag)
        return () => tag.remove()
      }, 'trellis-statusline: stylesheet')

      // Dictionaries are registered under the cell id, which is also the namespace handed to
      // the seat, so the `t` a cell receives resolves against exactly these keys. A namespace
      // that is refused (it is already taken, say) must cost the *shared* dictionaries only:
      // `StatuslineCell` reads the same table directly when the seat projects no `t`, so the
      // pill keeps working instead of the whole client half failing.
      try {
        ctx.effect(() => ctx.locale.register(CELL_ID, { zh, en }), 'trellis-statusline: dictionaries')
      } catch (error) {
        console.error(`[trellis-statusline] locale namespace unavailable: ${errorMessage(error)}`)
      }

      /**
       * One request to the Host half. A rejection is not an error surface: every caller
       * treats "no answer" as "nothing to show".
       *
       * The envelope must carry `payload` — an omitted one is answered with
       * `gateway/bad-request` and the caller's promise rejects.
       */
      async function request(endpoint, payload) {
        const answered = await ctx.connection.rpc.call(CHANNEL, endpoint, payload)
        if (!isRecord(answered) || answered.ok !== true) return null
        return answered.value
      }

      /**
       * The session-header cell.
       *
       * @param props - runtime slot currency plus the namespace translator. `t` is used when
       *   the seat projects it; the same dictionaries are read directly otherwise, so a seat
       *   that does not project a translator degrades to the locale captured at apply time
       *   instead of blanking out or throwing.
       * @returns the pill, or `null` when this workspace has no task to show.
       */
      function StatuslineCell({ sessionId, t }) {
        const [task, setTask] = React.useState(null)
        const say = typeof t === 'function' ? t : (key) => copy[key] ?? key

        React.useEffect(() => {
          let live = true
          const refresh = () => {
            request(ENDPOINT_READ, { sessionId }).then(
              (value) => {
                if (live) setTask(decodeTask(value))
              },
              () => {
                if (live) setTask(null)
              },
            )
          }
          refresh()
          // Owned by this component: a new sessionId disposes it and starts a fresh one, and
          // unmounting leaves no timer behind.
          const stop = ctx.interval(refresh, REFRESH_INTERVAL_MS)
          return () => {
            live = false
            stop()
          }
        }, [sessionId])

        if (task === null) return null

        const state = say(STATE_KEYS[task.status] ?? STATE_UNKNOWN)
        const bracket = task.priority.length === 0 ? null : `[${task.priority}]`
        return h(
          'span',
          { className: 'trellis-statusline', 'data-status': task.status, title: task.title },
          bracket === null ? null : h('span', { className: 'trellis-statusline-priority', key: 'priority' }, bracket),
          bracket === null ? null : ' ',
          h('span', { className: 'trellis-statusline-title', key: 'title' }, task.title),
          h('span', { className: 'trellis-statusline-separator', key: 'separator' }, ' · '),
          h('span', { className: 'trellis-statusline-state', key: 'state' }, state),
        )
      }

      // `slots.inject` defers registration until the seat exists; a seat that was renamed or
      // is never rendered leaves this plugin inert instead of failing the client half.
      ctx.slots.inject(SEAT, () =>
        ctx.slots.register({ name: SEAT, id: CELL_ID, order: CELL_ORDER, locale: CELL_ID }, StatuslineCell),
      )
    }

    function apply(ctx) {
      makeApply(ctx)
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
