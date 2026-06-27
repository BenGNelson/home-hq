import { Link } from 'react-router-dom'
import { Droplets, Wind, Thermometer } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { useDelayedFlag } from '../../../lib/useDelayedFlag.js'
import { weatherInfo, weatherGlow, formatTemp } from '../../../lib/weather.js'
import { glowFilter, radiantBackdrop } from '../../../lib/glow.js'
import { moduleAccent, ACCENT_HOVER } from '../../../lib/moduleAccent.js'
import { AccentArrow } from '../../../components/ui.jsx'

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

  // When live, back-light the banner with a radiant backdrop tinted to the
  // current condition (the icon glow is applied in Hero).
  const glow = data && data.available ? weatherGlow(data.current.code, data.current.is_day) : null

  return (
    <Link
      to="/weather"
      className={`${ACCENT_HOVER} relative mb-4 block rounded-xl border border-slate-800 bg-slate-900/50`}
      style={glow ? { background: radiantBackdrop(glow), '--accent': moduleAccent('/weather') } : { '--accent': moduleAccent('/weather') }}
    >
      {/* Stable accessible name that also CONTAINS the visible weather text
          (so it satisfies label-content-name-mismatch), and labels the link
          while the hero is still a loading skeleton. */}
      <span className="sr-only">Weather</span>
      <AccentArrow className="absolute right-4 top-4" />
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
  const glow = weatherGlow(c.code, c.is_day)
  // The three current-condition values, shared by both layouts so they can't
  // drift between mobile and desktop.
  const dir = compass(c.wind_dir)
  const feels = formatTemp(c.feels_like, d.temp_unit)
  const humidity = `${c.humidity}%`
  const wind = `${Math.round(c.wind_speed)} ${d.wind_unit}${dir ? ` ${dir}` : ''}`

  return (
    <div className="flex items-center gap-4 sm:gap-6">
      <Icon
        className={`h-14 w-14 shrink-0 ${tone}`}
        aria-hidden="true"
        style={{ filter: glowFilter(glow, c.is_day ? 0.7 : 0.4, { baseBlur: 6, blurGain: 16, baseAlpha: 0.2 }) }}
      />
      <div className="shrink-0">
        <div className="text-4xl font-semibold tabular-nums text-slate-100">
          {formatTemp(c.temp, d.temp_unit)}
        </div>
        <div className="text-sm text-slate-400">{label}</div>
      </div>

      {/* Mobile: the compact right-aligned column (unchanged). */}
      <div className="ml-auto grid grid-cols-1 gap-1 text-sm text-slate-400 sm:hidden">
        <span className="flex items-center justify-end gap-1.5">
          <Thermometer className="h-4 w-4 text-orange-300" aria-hidden="true" />
          Feels {feels}
        </span>
        <span className="flex items-center justify-end gap-1.5">
          <Droplets className="h-4 w-4 text-sky-300" aria-hidden="true" />
          {humidity}
        </span>
        <span className="flex items-center justify-end gap-1.5">
          <Wind className="h-4 w-4 text-slate-300" aria-hidden="true" />
          {wind}
        </span>
      </div>

      {/* Tablet/desktop: spread the stats across the empty banner width as
          larger labeled tiles so they're legible instead of jammed right. */}
      <div className="ml-2 hidden flex-1 items-center justify-around sm:flex">
        <Stat Icon={Thermometer} iconClass="text-orange-300" label="Feels like" value={feels} />
        <Stat Icon={Droplets} iconClass="text-sky-300" label="Humidity" value={humidity} />
        <Stat Icon={Wind} iconClass="text-slate-300" label="Wind" value={wind} />
      </div>
    </div>
  )
}

// One labeled current-condition tile for the wide hero layout: icon beside a
// small caption + a larger value.
function Stat({ Icon, iconClass, label, value }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className={`h-7 w-7 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="leading-tight">
        <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
        <div className="text-lg font-medium tabular-nums text-slate-200">{value}</div>
      </div>
    </div>
  )
}

// Sized to mirror Hero at BOTH breakpoints (compact column on mobile, spread
// tiles on sm+) so swapping real data in causes no layout shift either way.
function HeroSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4 sm:gap-6">
      <div className="h-14 w-14 shrink-0 rounded-full bg-slate-800" />
      <div className="shrink-0 space-y-2">
        <div className="h-9 w-24 rounded bg-slate-800" />
        <div className="h-4 w-16 rounded bg-slate-800" />
      </div>

      {/* mobile column */}
      <div className="ml-auto space-y-2 sm:hidden">
        <div className="h-4 w-24 rounded bg-slate-800" />
        <div className="h-4 w-16 rounded bg-slate-800" />
        <div className="h-4 w-20 rounded bg-slate-800" />
      </div>

      {/* tablet/desktop tiles */}
      <div className="ml-2 hidden flex-1 items-center justify-around sm:flex">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="h-7 w-7 shrink-0 rounded bg-slate-800" />
            <div className="space-y-1.5">
              <div className="h-3 w-16 rounded bg-slate-800" />
              <div className="h-5 w-14 rounded bg-slate-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
