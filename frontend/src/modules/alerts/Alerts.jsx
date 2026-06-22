import { useState } from 'react'
import { BellOff, Bell, Check, X } from 'lucide-react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { alertIcon } from '../../lib/alerts.js'

// The Alerts module: shows the push-notification status, every rule's current
// state (firing or OK), and a recent history — plus a button to fire a test
// push so you can confirm it reaches your phone.
export default function Alerts() {
  const { data, error, loading } = useApi('/alerts', 15000)
  const [test, setTest] = useState(null) // null | 'sending' | 'ok' | 'fail'
  // Optimistic mute overrides keyed by rule id, so a toggle reflects instantly
  // (the 15s poll reconciles with the persisted server value afterward).
  const [muteOverrides, setMuteOverrides] = useState({})

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

  const toggleMute = async (ruleId, muted) => {
    setMuteOverrides((o) => ({ ...o, [ruleId]: muted }))
    try {
      const r = await fetch(`${API_BASE}/alerts/${ruleId}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted }),
      })
      if (!r.ok) throw new Error()
    } catch {
      // Revert the optimistic flip if the request failed.
      setMuteOverrides((o) => ({ ...o, [ruleId]: !muted }))
    }
  }

  const testLabel =
    test === 'sending' ? (
      'Sending…'
    ) : test === 'ok' ? (
      <span className="flex items-center gap-1">
        Sent <Check className="h-4 w-4" aria-hidden="true" />
      </span>
    ) : test === 'fail' ? (
      <span className="flex items-center gap-1">
        Failed <X className="h-4 w-4" aria-hidden="true" />
      </span>
    ) : (
      'Send test'
    )

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-3">
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
          <Conditions rules={data.rules} overrides={muteOverrides} onToggleMute={toggleMute} />
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

function Conditions({ rules = [], overrides = {}, onToggleMute }) {
  // A muted rule is still watched but sends no push, so it doesn't count toward
  // the "active" tally that flags things needing attention.
  const isMuted = (r) => overrides[r.id] ?? r.muted ?? false
  const firing = rules.filter((r) => r.firing && !isMuted(r))
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">
        Watched conditions{firing.length > 0 && ` — ${firing.length} active`}
      </h3>
      <div className="space-y-2 text-sm">
        {rules.map((r) => {
          const muted = isMuted(r)
          const Icon = alertIcon(r.emoji)
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 last:border-0 last:pb-0"
            >
              <span className={`flex items-center gap-2 ${muted ? 'opacity-50' : ''}`}>
                <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className="text-slate-200">{r.title}</span>
                {muted && (
                  <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-xs text-slate-400">
                    muted
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3">
                {r.firing ? (
                  // When muted, the firing condition stays visible but reads
                  // neutral (no push is going out), not alarming amber.
                  <span className={`text-right ${muted ? 'text-slate-400' : 'text-amber-400'}`}>
                    {r.message}
                    {r.since && (
                      <span className="ml-2 text-xs text-slate-500">{formatAgo(r.since)}</span>
                    )}
                  </span>
                ) : (
                  <span className={muted ? 'text-slate-500' : 'text-emerald-400'}>● OK</span>
                )}
                <button
                  onClick={() => onToggleMute(r.id, !muted)}
                  title={muted ? 'Unmute — resume pushes' : 'Mute — silence pushes'}
                  aria-label={muted ? `Unmute ${r.title}` : `Mute ${r.title}`}
                  className="rounded px-1.5 py-0.5 leading-none text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200"
                >
                  {muted ? (
                    <BellOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Bell className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function History({ recent = [], rules = [] }) {
  const iconFor = (id) => alertIcon(rules.find((r) => r.id === id)?.emoji)
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">Recent</h3>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-500">No alerts yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {recent.map((e, i) => {
            const Icon = iconFor(e.rule_id)
            return (
            <li key={i} className="flex items-start justify-between gap-3">
              <span className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className={e.kind === 'clear' ? 'text-emerald-300' : 'text-slate-200'}>
                  {e.message}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">{formatAgo(e.ts)}</span>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
