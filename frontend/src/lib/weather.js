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

// The Lucide icon component for a weather code (convenience, mirrors entityIcon).
export const weatherIcon = (code, isDay) => weatherInfo(code, isDay).Icon

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
