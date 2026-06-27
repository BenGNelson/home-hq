import { ArrowDown, ArrowUp } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { formatMbps, formatPing } from '../../../lib/speedtest.js'
import Widget from './Widget.jsx'

// Compact internet-speed summary for the dashboard: latest download / upload /
// ping. Hides itself entirely when the feature is off (mirrors SolarWidget), so
// the dashboard stays clean on setups without a speedtest configured.
export default function SpeedtestWidget() {
  const { data, error, loading } = useApi('/speedtest', 5000)
  if (data && data.available === false && data.reason === 'not_enabled') return null

  const noData = data && data.available === false // reason === 'no_data'
  const l = data?.latest

  return (
    <Widget title="Internet Speed" to="/speedtest" loading={loading} error={error}>
      {data &&
        (noData ? (
          <p className="text-sm text-slate-400">
            {data.running ? 'testing…' : 'no tests yet'}
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <ArrowDown className="h-5 w-5 shrink-0 text-sky-400" aria-hidden="true" />
              <span className="text-2xl font-semibold tabular-nums text-slate-100">
                {formatMbps(l?.download_mbps)}
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
                <ArrowUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                {formatMbps(l?.upload_mbps)}
              </span>
            </div>
            <div className="text-xs text-slate-400">ping {formatPing(l?.ping_ms)}</div>
          </div>
        ))}
    </Widget>
  )
}
