import { ShieldBan } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { formatPercent, formatCount, topDomainsPreview, adguardUnavailableMessage } from '../../../lib/adguard.js'
import { containerUrl } from '../../../lib/hostLocal.js'
import { OpenLink } from '../../../components/ui.jsx'
import Widget from './Widget.jsx'

// Compact ad-blocking summary for the dashboard. Hides itself entirely when no
// AdGuard is configured, so the dashboard stays clean on setups without it.
export default function AdGuardWidget() {
  const { data, error, loading } = useApi('/adguard', 30000)
  if (data && data.available === false && data.reason === 'not_configured') return null

  const unavailable = data && data.available === false
  const domains = topDomainsPreview(data?.top_blocked_domains, 3)
  // Hand-off to AdGuard's own dashboard for control (pausing, blocklists). Opt-in
  // via the gitignored container note, so the host URL stays out of the repo.
  const link = containerUrl('adguard-home')

  return (
    <Widget title="Ad Blocking" loading={loading} error={error} action={<OpenLink href={link} />}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">{adguardUnavailableMessage(data.reason)}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <ShieldBan className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
              <span className="text-2xl font-semibold tabular-nums text-slate-100">
                {formatPercent(data.blocked_percent)}
              </span>
              {!data.protection_enabled && (
                <span className="ml-auto text-xs font-medium text-amber-400">paused</span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              {formatCount(data.blocked_queries)} of {formatCount(data.total_queries)} queries blocked
            </div>
            {domains.length > 0 && (
              <ul className="space-y-1 text-xs text-slate-400">
                {domains.map((row) => (
                  <li key={row.domain} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{row.domain}</span>
                    <span className="shrink-0 tabular-nums">{formatCount(row.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </Widget>
  )
}
