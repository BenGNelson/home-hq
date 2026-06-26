// Pure helpers for the weather widget: map an Open-Meteo WMO weather_code (with a
// day/night variant) to a label, a Lucide icon component, and an accent color (a
// literal Tailwind text class so the JIT keeps it). Plus a couple of small
// formatters. Kept pure (no globals) so they're unit-tested. Display only.

import {
  Sun,
  Moon,
  CloudSun,
  CloudMoon,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudHail,
  CloudSnow,
  CloudRainWind,
  CloudLightning,
} from 'lucide-react'

// Resolve a WMO weather_code to its label/icon/tone. Codes are grouped per the
// Open-Meteo table; clear/cloudy codes swap icon + tone by day vs night. Returns
// "Unknown" + a neutral cloud for anything we don't recognize.
export function weatherInfo(code, isDay = true) {
  switch (code) {
    case 0:
      return isDay
        ? { label: 'Clear', Icon: Sun, tone: 'text-amber-300' }
        : { label: 'Clear', Icon: Moon, tone: 'text-slate-300' }
    case 1:
      return isDay
        ? { label: 'Mainly clear', Icon: Sun, tone: 'text-amber-300' }
        : { label: 'Mainly clear', Icon: Moon, tone: 'text-slate-300' }
    case 2:
      return {
        label: 'Partly cloudy',
        Icon: isDay ? CloudSun : CloudMoon,
        tone: 'text-slate-300',
      }
    case 3:
      return { label: 'Overcast', Icon: Cloud, tone: 'text-slate-400' }
    case 45:
    case 48:
      return { label: 'Fog', Icon: CloudFog, tone: 'text-slate-400' }
    case 51:
    case 53:
    case 55:
      return { label: 'Drizzle', Icon: CloudDrizzle, tone: 'text-sky-300' }
    case 56:
    case 57:
      return { label: 'Freezing drizzle', Icon: CloudDrizzle, tone: 'text-cyan-300' }
    case 61:
    case 63:
    case 65:
      return { label: 'Rain', Icon: CloudRain, tone: 'text-sky-400' }
    case 66:
    case 67:
      return { label: 'Freezing rain', Icon: CloudHail, tone: 'text-cyan-300' }
    case 71:
    case 73:
    case 75:
      return { label: 'Snow', Icon: CloudSnow, tone: 'text-sky-200' }
    case 77:
      return { label: 'Snow grains', Icon: CloudSnow, tone: 'text-sky-200' }
    case 80:
    case 81:
    case 82:
      return { label: 'Rain showers', Icon: CloudRainWind, tone: 'text-sky-400' }
    case 85:
    case 86:
      return { label: 'Snow showers', Icon: CloudSnow, tone: 'text-sky-200' }
    case 95:
      return { label: 'Thunderstorm', Icon: CloudLightning, tone: 'text-violet-300' }
    case 96:
    case 99:
      return { label: 'Thunderstorm', Icon: CloudLightning, tone: 'text-violet-300' }
    default:
      return { label: 'Unknown', Icon: Cloud, tone: 'text-slate-400' }
  }
}

// The "back-lit" glow color (an "r,g,b" constant-palette string) for a weather
// condition, matching its icon tone family — so the hero icon reads as lit by the
// weather (warm amber sun, sky-blue rain, violet storm, icy cyan, calm slate at
// night/overcast). Used with glowFilter()/radiantBackdrop() (lib/glow.js).
export function weatherGlow(code, isDay = true) {
  if ((code === 0 || code === 1) && isDay) return '251,191,36' // clear day — amber-400
  if (code === 0 || code === 1) return '148,163,184' // clear night — slate-400
  switch (code) {
    case 51: case 53: case 55: // drizzle
    case 61: case 63: case 65: // rain
    case 80: case 81: case 82: // rain showers
      return '56,189,248' // sky-400
    case 56: case 57: // freezing drizzle
    case 66: case 67: // freezing rain
      return '34,211,238' // cyan-400
    case 71: case 73: case 75: // snow
    case 77: case 85: case 86: // snow grains/showers
      return '125,211,252' // sky-300
    case 95: case 96: case 99: // thunderstorm
      return '167,139,250' // violet-400
    default:
      return '148,163,184' // partly/overcast/fog/unknown — slate-400
  }
}

// Round a temperature and append its unit ("68°F"); null/undefined → an em dash.
export function formatTemp(t, unit) {
  if (t == null) return '—'
  return `${Math.round(t)}${unit}`
}

// A short weekday ("Mon") from a "YYYY-MM-DD" string; '' for invalid input.
export function dayName(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { weekday: 'short' })
}

// Map a temperature to a cold→hot color (an HSL string) for the forecast temp
// bars + accents. We ramp hue blue→red over a 10–100°F window (passing through
// cyan/green/amber), so cool days read blue and hot days red. Metric temps are
// converted to °F first so one ramp serves both units. null → a neutral slate.
export function tempColor(t, unit = '°F') {
  if (t == null) return 'hsl(215 16% 47%)' // slate-500-ish
  const f = unit === '°C' ? (t * 9) / 5 + 32 : t
  const frac = Math.min(1, Math.max(0, (f - 10) / 90)) // 0 at 10°F, 1 at 100°F
  const hue = Math.round(220 - frac * 220) // 220 (blue) → 0 (red)
  return `hsl(${hue} 75% 58%)`
}

// Position a day's lo→hi segment within the week's overall min–max range, so the
// bars line up like a range chart (Apple-Weather style). Returns left/width as
// CSS percentage strings. A degenerate range (all-equal, or missing bounds) →
// a full-width bar rather than a divide-by-zero.
export function tempBarStyle(lo, hi, weekMin, weekMax) {
  if (lo == null || hi == null || weekMin == null || weekMax == null) {
    return { left: '0%', width: '100%' }
  }
  const span = weekMax - weekMin
  if (span <= 0) return { left: '0%', width: '100%' }
  const width = Math.max(((hi - lo) / span) * 100, 4) // 4% floor so it's visible
  // Clamp the offset so left+width never exceeds 100% (a near-flat day at the hot
  // end would otherwise push the floored bar past the track's right edge).
  const left = Math.min(Math.max(((lo - weekMin) / span) * 100, 0), 100 - width)
  return { left: `${left}%`, width: `${width}%` }
}

// A compact hour label ("6a", "12p", "3p") from an Open-Meteo "YYYY-MM-DDTHH:MM"
// timestamp; '' for invalid input.
export function hourLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = d.getHours()
  const period = h < 12 ? 'a' : 'p'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${period}`
}

// Like hourLabel but with minutes ("6:02a", "8:31p") — for sunrise/sunset times.
export function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  let h = d.getHours()
  const m = d.getMinutes()
  const period = h < 12 ? 'a' : 'p'
  h = h % 12 === 0 ? 12 : h % 12
  return `${h}:${String(m).padStart(2, '0')}${period}`
}

// Fraction of daylight elapsed (0 at sunrise → 1 at sunset) for placing the sun on
// the day-arc. All three timestamps are the location's local naive ISO from the
// same response, so the browser-tz offset cancels in the differences. Returns null
// if any is missing/invalid or the day is degenerate; clamps outside [0,1].
export function sunFraction(sunrise, sunset, now) {
  // Guard empties first: new Date(null) is epoch 0 (finite!), which would slip
  // past the isFinite check below and yield a bogus fraction.
  if (!sunrise || !sunset || !now) return null
  const r = new Date(sunrise).getTime()
  const s = new Date(sunset).getTime()
  const n = new Date(now).getTime()
  if (![r, s, n].every(Number.isFinite) || s <= r) return null
  return Math.min(1, Math.max(0, (n - r) / (s - r)))
}

// Map a UV index to a risk label + accent tone (literal Tailwind classes so the
// JIT keeps them). Buckets follow the WHO UV scale. null → a neutral dash.
export function uvInfo(uv) {
  if (uv == null) return { label: '—', tone: 'text-slate-400' }
  if (uv < 3) return { label: 'Low', tone: 'text-emerald-300' }
  if (uv < 6) return { label: 'Moderate', tone: 'text-amber-300' }
  if (uv < 8) return { label: 'High', tone: 'text-orange-300' }
  if (uv < 11) return { label: 'Very high', tone: 'text-rose-300' }
  return { label: 'Extreme', tone: 'text-violet-300' }
}

// Format a precipitation amount for a chip ("0.2 in" / "5 mm"); null/zero → null so
// the caller can omit the chip entirely on a dry day. `metric` picks mm vs inches.
export function formatPrecip(amount, metric = false) {
  if (amount == null || amount <= 0) return null
  if (metric) {
    // Keep a decimal under 1mm so a light shower that cleared the >0 guard doesn't
    // round to a contradictory "0 mm"; whole millimetres above that.
    const mm = amount < 1 ? Math.round(amount * 10) / 10 : Math.round(amount)
    return `${mm} mm`
  }
  return `${Math.round(amount * 100) / 100} in`
}
