import { ShieldBan, ShieldCheck, ShieldX, Ban } from 'lucide-react'
import { useApi } from '../../lib/useApi.js'
import { formatPercent, formatCount, adguardUnavailableMessage } from '../../lib/adguard.js'
import { containerUrl } from '../../lib/hostLocal.js'
import { OpenLink } from '../../components/ui.jsx'

// The Ad Blocking module: a read-only glance at the AdGuard Home DNS resolver
// that filters the phone's traffic over the mesh VPN. The resolver is a separate
// host-side service; HQ only reads its stats (blocked %, queries, top domains) —
// pausing and blocklist config live in AdGuard's own UI, true to "HA is the
// brain": this is the cockpit gauge, not the control surface.
export default function Adguard() {
  const { data, error, loading } = useApi('/adguard', 30000)

  return (
    <div>
      {/* No page title — the shell's top bar already shows "Ad Blocking". */}
      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && <Unavailable reason={data.reason} />}
      {data && data.available && <Live d={data} />}
    </div>
  )
}

function Live({ d }) {
  const on = d.protection_enabled
  const domains = d.top_blocked_domains || []
  const link = containerUrl('adguard-home')

  return (
    <div className="space-y-4">
      {/* Headline: blocked % + protection state. The icon + percentage are the
          primary first row; the badge + Open link wrap to a second row on mobile
          (so the link never runs off-screen) but sit inline on the right — a
          touch larger — on sm+. */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
            <ShieldBan className="h-7 w-7" aria-hidden="true" />
          </span>
          <div>
            <div className="text-4xl font-semibold tabular-nums text-slate-100">
              {formatPercent(d.blocked_percent)}
            </div>
            <div className="text-sm text-slate-400">of DNS queries blocked</div>
          </div>
          <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium sm:px-3 sm:py-1.5 sm:text-sm ${
                on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
              }`}
            >
              {on ? (
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <ShieldX className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {on ? 'Protection on' : 'Protection paused'}
            </span>
            <OpenLink href={link} label="Open AdGuard" className="sm:px-3 sm:py-1.5 sm:text-sm" />
          </div>
        </div>
      </div>

      {/* Query totals */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Queries blocked" value={formatCount(d.blocked_queries)} tone="red" />
        <Stat label="Total queries" value={formatCount(d.total_queries)} />
      </div>

      {/* Top blocked domains */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
          <Ban className="h-4 w-4 text-red-400" aria-hidden="true" /> Top blocked domains
        </h3>
        {domains.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing blocked yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {domains.map((row) => (
              <li key={row.domain} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-200">{row.domain}</span>
                <span className="shrink-0 tabular-nums text-slate-400">{formatCount(row.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-slate-600">
        Stats from AdGuard Home. Pausing and blocklists are managed in AdGuard’s own dashboard.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'red' ? 'text-red-400' : 'text-slate-100'
  return (
    <div className="rounded-lg bg-slate-800/40 p-3 text-center">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}

function Unavailable({ reason }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">{adguardUnavailableMessage(reason)}</p>
      {reason === 'not_configured' && (
        <p className="mt-2 text-sm text-slate-400">
          Set{' '}
          <code className="rounded bg-slate-800 px-1">ADGUARD_HOST</code> (and the{' '}
          <code className="rounded bg-slate-800 px-1">ADGUARD_USERNAME</code> /{' '}
          <code className="rounded bg-slate-800 px-1">ADGUARD_PASSWORD</code> admin login) in{' '}
          <code className="rounded bg-slate-800 px-1">.env</code> and restart the backend. The
          ad-blocking resolver itself runs as a separate service.
        </p>
      )}
      {reason === 'unreachable' && (
        <p className="mt-2 text-sm text-slate-400">
          The backend is configured but can’t reach AdGuard — check that the resolver’s container
          is running and that <code className="rounded bg-slate-800 px-1">ADGUARD_HOST</code> points
          at its admin/API address.
        </p>
      )}
    </div>
  )
}
