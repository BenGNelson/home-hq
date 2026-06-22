import { Droplets, Wind, Thermometer } from 'lucide-react'
import { useApi } from '../../lib/useApi.js'
import { weatherInfo, formatTemp, dayName } from '../../lib/weather.js'

// The Weather module: current conditions + a 5-day forecast from Open-Meteo
// (free, no API key). Hides/degrades until WEATHER_LAT/WEATHER_LON are set.
export default function Weather() {
  const { data, error, loading } = useApi('/weather', 600000)

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Weather</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && <Unavailable reason={data.reason} />}
      {data && data.available && <Live d={data} />}
    </div>
  )
}

// Wind degrees → 8-point compass abbreviation.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 45) % 8])

function Live({ d }) {
  const c = d.current
  const { label, Icon, tone } = weatherInfo(c.code, c.is_day)

  return (
    <div className="space-y-4">
      {/* Current conditions */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center gap-4">
          <Icon className={`h-14 w-14 shrink-0 ${tone}`} aria-hidden="true" />
          <div>
            <div className="text-4xl font-semibold tabular-nums text-slate-100">
              {formatTemp(c.temp, d.temp_unit)}
            </div>
            <div className="text-sm text-slate-400">{label}</div>
          </div>
          <div className="ml-auto grid grid-cols-1 gap-1 text-sm text-slate-400">
            <span className="flex items-center justify-end gap-1.5">
              <Thermometer className="h-4 w-4 text-orange-300" aria-hidden="true" />
              Feels {formatTemp(c.feels_like, d.temp_unit)}
            </span>
            <span className="flex items-center justify-end gap-1.5">
              <Droplets className="h-4 w-4 text-sky-300" aria-hidden="true" />
              {c.humidity}%
            </span>
            <span className="flex items-center justify-end gap-1.5">
              <Wind className="h-4 w-4 text-slate-300" aria-hidden="true" />
              {Math.round(c.wind_speed)} {d.wind_unit} {compass(c.wind_dir)}
            </span>
          </div>
        </div>
      </div>

      {/* 5-day forecast */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Forecast</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {d.daily.map((day, i) => {
            const w = weatherInfo(day.code, true)
            return (
              <div
                key={day.date}
                className="flex flex-col items-center gap-1 rounded-lg bg-slate-800/40 p-3 text-center"
              >
                <span className="text-xs font-medium text-slate-300">
                  {i === 0 ? 'Today' : dayName(day.date)}
                </span>
                <w.Icon className={`h-7 w-7 ${w.tone}`} aria-hidden="true" />
                <span className="text-sm tabular-nums text-slate-100">
                  {formatTemp(day.hi, d.temp_unit)}
                </span>
                <span className="text-xs tabular-nums text-slate-500">
                  {formatTemp(day.lo, d.temp_unit)}
                </span>
                {day.precip_prob != null && day.precip_prob > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-sky-300">
                    <Droplets className="h-3 w-3" aria-hidden="true" />
                    {day.precip_prob}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-[11px] text-slate-600">Data from Open-Meteo.</p>
    </div>
  )
}

function Unavailable({ reason }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">
        {reason === 'unreachable' ? 'Can’t reach the weather service right now.' : 'Weather isn’t configured yet.'}
      </p>
      {reason === 'not_configured' && (
        <p className="mt-2 text-sm text-slate-400">
          Set{' '}
          <code className="rounded bg-slate-800 px-1">WEATHER_LAT</code> and{' '}
          <code className="rounded bg-slate-800 px-1">WEATHER_LON</code> in{' '}
          <code className="rounded bg-slate-800 px-1">.env</code> (your location’s
          coordinates) and restart the backend. No API key needed — it uses Open-Meteo.
        </p>
      )}
    </div>
  )
}
