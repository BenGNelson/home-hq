import { useApi } from '../../lib/useApi.js'
import { formatAgo } from '../../lib/format.js'
import { uptimeTone, formatPct, formatMs, uptimeHeadline } from '../../lib/uptime.js'

// Service-availability monitoring: each configured service's current status,
// uptime % over 24h/7d, latency, and a recent up/down history sparkline. The
// probing is done by a host script (it can reach LAN-restricted services the
// container can't); this just renders what it recorded.
export default function Uptime() {
  const { data, error, loading } = useApi('/uptime', 15000)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Uptime</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.configured === false && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <p className="text-amber-400">No uptime data yet.</p>
          <p className="mt-2 text-sm text-slate-400">
            The host prober (<code className="rounded bg-slate-800 px-1">scripts/uptime-probe.py</code>,
            run by a systemd timer) hasn’t written its state file yet. Set
            <code className="mx-1 rounded bg-slate-800 px-1">UPTIME_TARGETS</code> and install the
            timer — see the Server Guide.
          </p>
        </div>
      )}

      {data && data.configured && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-lg font-medium text-slate-200">{uptimeHeadline(data)}</span>
            {data.stale && (
              <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-amber-300">
                stale — prober not running
              </span>
            )}
          </div>

          <div className="space-y-3">
            {data.targets.map((t) => (
              <TargetRow key={t.label} t={t} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const DOT = { good: 'bg-emerald-400', bad: 'bg-rose-500', idle: 'bg-slate-600' }
const TEXT = { good: 'text-emerald-400', bad: 'text-rose-400', idle: 'text-slate-400' }
const LABEL = { up: 'up', down: 'down', unknown: 'pending' }

function TargetRow({ t }) {
  const tone = uptimeTone(t.status)
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tone]}`} />
          <span className="font-medium text-slate-100">{t.label}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
            {t.kind}
          </span>
          <span className={`text-sm ${TEXT[tone]}`}>{LABEL[t.status]}</span>
        </span>

        <div className="ml-auto flex items-center gap-5 text-sm tabular-nums">
          <Stat label="24h" value={formatPct(t.uptime_24h)} />
          <Stat label="7d" value={formatPct(t.uptime_7d)} />
          <Stat label="latency" value={formatMs(t.last_response_ms)} />
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <Sparkline history={t.history} />
        <span className="shrink-0 text-xs text-slate-600">
          {t.last_checked ? `checked ${formatAgo(t.last_checked)}` : 'never checked'}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-slate-200">{value}</span>
      <span className="text-[10px] uppercase text-slate-500">{label}</span>
    </span>
  )
}

// A compact up/down history strip: one bar per recent probe, green = up, red =
// down. Newest on the right.
function Sparkline({ history }) {
  if (!history || history.length === 0) {
    return <span className="text-xs text-slate-600">no history yet</span>
  }
  return (
    <div className="flex h-6 items-end gap-px">
      {history.map((p, i) => (
        <span
          key={i}
          title={p.up ? `up${p.ms != null ? ` · ${p.ms}ms` : ''}` : 'down'}
          className={`w-1 rounded-sm ${p.up ? 'bg-emerald-500/80' : 'bg-rose-500/80'}`}
          style={{ height: p.up ? '100%' : '40%' }}
        />
      ))}
    </div>
  )
}
