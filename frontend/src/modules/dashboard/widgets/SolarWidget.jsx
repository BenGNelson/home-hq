import { Sun } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { formatWatts, formatKwh, netLabel, solarUnavailableMessage } from '../../../lib/solar.js'
import Widget from './Widget.jsx'

// Compact solar summary for the dashboard. Hides itself entirely when no Envoy
// is configured, so the dashboard stays clean on setups without solar.
export default function SolarWidget() {
  const { data, error, loading } = useApi('/solar', 10000)
  if (data && data.available === false && data.reason === 'not_configured') return null

  const unavailable = data && data.available === false
  const p = data?.production
  const net = netLabel(data?.net_watts)

  return (
    <Widget title="Solar" loading={loading} error={error}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">{solarUnavailableMessage(data.reason)}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Sun className="h-5 w-5 shrink-0 text-yellow-400" aria-hidden="true" />
              <span className="text-2xl font-semibold tabular-nums text-slate-100">
                {formatWatts(p?.watts_now)}
              </span>
              {net && <span className={`ml-auto text-xs font-medium ${net.tone}`}>{net.text}</span>}
            </div>
            <div className="text-xs text-slate-400">
              {formatKwh(p?.watt_hours_today)} produced today
            </div>
          </div>
        ))}
    </Widget>
  )
}
