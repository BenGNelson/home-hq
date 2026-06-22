import { useApi } from '../../../lib/useApi.js'
import { weatherInfo, formatTemp } from '../../../lib/weather.js'
import Widget from './Widget.jsx'

// Compact current-weather summary for the dashboard. Hides itself entirely when
// no location is configured, so the dashboard stays clean without it.
export default function WeatherWidget() {
  const { data, error, loading } = useApi('/weather', 600000)
  if (data && data.available === false && data.reason === 'not_configured') return null

  const unavailable = data && data.available === false
  const c = data?.current
  const today = data?.daily?.[0]
  const info = c ? weatherInfo(c.code, c.is_day) : null

  return (
    <Widget title="Weather" loading={loading} error={error}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">Can’t reach the weather service.</p>
        ) : (
          <div className="flex items-center gap-3">
            {info && <info.Icon className={`h-10 w-10 shrink-0 ${info.tone}`} aria-hidden="true" />}
            <div>
              <div className="text-2xl font-semibold tabular-nums text-slate-100">
                {formatTemp(c?.temp, data.temp_unit)}
              </div>
              <div className="text-xs text-slate-400">{info?.label}</div>
            </div>
            {today && (
              <div className="ml-auto text-right text-xs text-slate-400">
                <div className="tabular-nums text-slate-300">{formatTemp(today.hi, data.temp_unit)}</div>
                <div className="tabular-nums text-slate-500">{formatTemp(today.lo, data.temp_unit)}</div>
              </div>
            )}
          </div>
        ))}
    </Widget>
  )
}
