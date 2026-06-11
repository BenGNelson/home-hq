import { useState } from 'react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { alertEmoji } from '../../lib/alerts.js'

// The Alerts module: shows the push-notification status, every rule's current
// state (firing or OK), and a recent history — plus a button to fire a test
// push so you can confirm it reaches your phone.
export default function Alerts() {
  const { data, error, loading } = useApi('/alerts', 15000)
  const [test, setTest] = useState(null) // null | 'sending' | 'ok' | 'fail'

  const sendTest = async () => {
    setTest('sending')
    try {
      const r = await fetch(`${API_BASE}/alerts/test`, { method: 'POST' })
      setTest(r.ok ? 'ok' : 'fail')
    } catch {
      setTest('fail')
    }
    setTimeout(() => setTest(null), 4000)
  }

  const testLabel =
    test === 'sending' ? 'Sending…' : test === 'ok' ? 'Sent ✓' : test === 'fail' ? 'Failed ✗' : 'Send test'

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Alerts</h2>
        <button
          onClick={sendTest}
          disabled={test === 'sending' || !data?.configured}
          className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/40 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {testLabel}
        </button>
      </div>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && (
        <div className="space-y-4">
          <PushStatus data={data} />
          <Conditions rules={data.rules} />
          <History recent={data.recent} rules={data.rules} />
        </div>
      )}
    </div>
  )
}

function PushStatus({ data }) {
  let tone, text
  if (!data.configured) {
    tone = 'amber'
    text = 'Push not configured — set NTFY_URL and NTFY_TOPIC in .env.'
  } else if (!data.enabled) {
    tone = 'amber'
    text = 'Push is configured but the engine is off (set ALERTS_ENABLED=true).'
  } else {
    tone = 'emerald'
    text = 'Push active — alerts are watched and sent to your phone.'
  }
  const cls = tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm">
      <span className={cls}>● </span>
      {text}
    </div>
  )
}

function Conditions({ rules = [] }) {
  const firing = rules.filter((r) => r.firing)
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">
        Watched conditions{firing.length > 0 && ` — ${firing.length} active`}
      </h3>
      <div className="space-y-2 text-sm">
        {rules.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0 last:pb-0"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden>{alertEmoji(r.emoji)}</span>
              <span className="text-slate-200">{r.title}</span>
            </span>
            {r.firing ? (
              <span className="text-right text-amber-400">
                {r.message}
                {r.since && (
                  <span className="ml-2 text-xs text-slate-500">{formatAgo(r.since)}</span>
                )}
              </span>
            ) : (
              <span className="text-emerald-400">● OK</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function History({ recent = [], rules = [] }) {
  const emojiFor = (id) => alertEmoji(rules.find((r) => r.id === id)?.emoji)
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">Recent</h3>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-500">No alerts yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {recent.map((e, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="flex items-start gap-2">
                <span aria-hidden>{emojiFor(e.rule_id)}</span>
                <span className={e.kind === 'clear' ? 'text-emerald-300' : 'text-slate-200'}>
                  {e.message}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{formatAgo(e.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
