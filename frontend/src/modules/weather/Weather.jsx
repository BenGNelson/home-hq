import { useState } from 'react'
import { Droplets, Wind, Thermometer, ChevronDown } from 'lucide-react'
import { useApi } from '../../lib/useApi.js'
import {
  weatherInfo,
  formatTemp,
  dayName,
  tempColor,
  tempBarStyle,
  hourLabel,
} from '../../lib/weather.js'

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
  // Which day's hourly strip is expanded (null = none). Default to today open.
  const [openDate, setOpenDate] = useState(d.daily?.[0]?.date ?? null)

  // The week's overall lo/hi, so every day's range bar is drawn on one shared
  // scale (an Apple-Weather-style range chart). Filter nulls before min/max.
  const los = d.daily.map((x) => x.lo).filter((x) => x != null)
  const his = d.daily.map((x) => x.hi).filter((x) => x != null)
  const weekMin = los.length ? Math.min(...los) : null
  const weekMax = his.length ? Math.max(...his) : null

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

      {/* 5-day forecast — one full-width row per day (never lopsided), with a
          color range bar and a tap-to-expand hourly strip. */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:p-4">
        <h3 className="mb-1 px-1 text-sm font-medium text-slate-300">5-day forecast</h3>
        <div className="divide-y divide-slate-800/70">
          {d.daily.map((day, i) => (
            <DayRow
              key={day.date}
              day={day}
              label={i === 0 ? 'Today' : dayName(day.date)}
              unit={d.temp_unit}
              weekMin={weekMin}
              weekMax={weekMax}
              open={openDate === day.date}
              onToggle={() => setOpenDate(openDate === day.date ? null : day.date)}
            />
          ))}
        </div>
      </div>

      <p className="text-[11px] text-slate-600">Data from Open-Meteo.</p>
    </div>
  )
}

// A single forecast day: a clickable row that toggles its hourly strip. The row
// shows day · icon · lo · color range bar · hi · precip%.
function DayRow({ day, label, unit, weekMin, weekMax, open, onToggle }) {
  const w = weatherInfo(day.code, true)
  const bar = tempBarStyle(day.lo, day.hi, weekMin, weekMax)
  const hasHours = Array.isArray(day.hours) && day.hours.length > 0

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-slate-800/30"
      >
        <span className="w-12 shrink-0 text-sm font-medium text-slate-300">{label}</span>
        <w.Icon className={`h-6 w-6 shrink-0 ${w.tone}`} aria-hidden="true" />
        <span className="flex items-center gap-1 text-[11px] tabular-nums text-sky-300/90">
          {day.precip_prob != null && day.precip_prob > 0 ? (
            <>
              <Droplets className="h-3 w-3" aria-hidden="true" />
              {day.precip_prob}%
            </>
          ) : null}
        </span>

        {/* Range bar: the lo→hi segment positioned on the shared week scale, its
            fill a cool→warm gradient between the lo and hi colors. */}
        <span
          className="w-10 shrink-0 text-right text-sm tabular-nums"
          style={{ color: tempColor(day.lo, unit) }}
        >
          {formatTemp(day.lo, unit)}
        </span>
        <span className="relative ml-1 mr-1 h-1.5 flex-1 rounded-full bg-slate-800">
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              left: bar.left,
              width: bar.width,
              background: `linear-gradient(to right, ${tempColor(day.lo, unit)}, ${tempColor(day.hi, unit)})`,
            }}
          />
        </span>
        <span
          className="w-10 shrink-0 text-left text-sm font-medium tabular-nums"
          style={{ color: tempColor(day.hi, unit) }}
        >
          {formatTemp(day.hi, unit)}
        </span>

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open &&
        (hasHours ? (
          <HourlyStrip hours={day.hours} unit={unit} />
        ) : (
          <p className="px-1 pb-3 text-xs text-slate-500">No hourly data for this day.</p>
        ))}
    </div>
  )
}

// A horizontally-scrollable strip of a day's hours: label · icon · temp-colored
// number · precip%. Mobile-first — it scrolls rather than wrapping.
function HourlyStrip({ hours, unit }) {
  return (
    <div className="overflow-x-auto pb-3 pt-1">
      <div className="flex gap-4 px-1">
        {hours.map((h) => {
          const info = weatherInfo(h.code, h.is_day)
          return (
            <div key={h.time} className="flex shrink-0 flex-col items-center gap-1 text-center">
              <span className="text-[11px] text-slate-400">{hourLabel(h.time)}</span>
              <info.Icon className={`h-4 w-4 ${info.tone}`} aria-hidden="true" />
              <span
                className="text-xs font-medium tabular-nums"
                style={{ color: tempColor(h.temp, unit) }}
              >
                {h.temp == null ? '—' : `${Math.round(h.temp)}°`}
              </span>
              <span className="flex h-3 items-center text-[10px] text-sky-300/90">
                {h.precip_prob != null && h.precip_prob > 0 ? `${h.precip_prob}%` : ''}
              </span>
            </div>
          )
        })}
      </div>
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
