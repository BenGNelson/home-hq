import { Link } from 'react-router-dom'
import { Droplets, Wind, Thermometer } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { useDelayedFlag } from '../../../lib/useDelayedFlag.js'
import { weatherInfo, formatTemp } from '../../../lib/weather.js'

// Wind degrees → 8-point compass abbreviation (mirrors the Weather page).
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 45) % 8])

// Full-width "hero" weather banner pinned to the top of the dashboard: the
// Weather page's current-conditions bar (big icon + temp + condition on the
// left, feels/humidity/wind on the right). The whole card links to the Weather
// page. Hides itself entirely when no location is configured so the dashboard
// stays clean without it.
export default function WeatherWidget() {
  const { data, error, loading } = useApi('/weather', 600000)
  // Only reveal the skeleton if the first load is actually slow, so a fast load
  // never flashes a placeholder (same idea as the shared Widget skeleton).
  const showSkeleton = useDelayedFlag(loading && !data && !error)

  if (data && data.available === false && data.reason === 'not_configured') return null

  return (
    <Link
      to="/weather"
      aria-label="Open the Weather page"
      className="group mb-4 block rounded-xl border border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-700 hover:bg-slate-900/80"
    >
      <div className="p-5">
        {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
        {!error && !data && (showSkeleton ? <HeroSkeleton /> : <div className="h-[3.5rem]" />)}
        {data && data.available === false && (
          <p className="text-sm text-amber-400">Can’t reach the weather service.</p>
        )}
        {data && data.available && <Hero d={data} />}
      </div>
    </Link>
  )
}

function Hero({ d }) {
  const c = d.current
  const { label, Icon, tone } = weatherInfo(c.code, c.is_day)
  return (
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
  )
}

// Sized to match Hero so swapping real data in causes no layout shift.
function HeroSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4">
      <div className="h-14 w-14 shrink-0 rounded-full bg-slate-800" />
      <div className="space-y-2">
        <div className="h-9 w-24 rounded bg-slate-800" />
        <div className="h-4 w-16 rounded bg-slate-800" />
      </div>
      <div className="ml-auto space-y-2">
        <div className="h-4 w-24 rounded bg-slate-800" />
        <div className="h-4 w-16 rounded bg-slate-800" />
        <div className="h-4 w-20 rounded bg-slate-800" />
      </div>
    </div>
  )
}
