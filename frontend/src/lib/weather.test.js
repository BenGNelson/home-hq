import { describe, it, expect } from 'vitest'
import {
  Sun,
  Moon,
  CloudSun,
  CloudRain,
  CloudLightning,
  Cloud,
} from 'lucide-react'
import {
  weatherInfo,
  weatherIcon,
  weatherGlow,
  formatTemp,
  dayName,
  tempColor,
  tempBarStyle,
  hourLabel,
} from './weather.js'

describe('weatherGlow', () => {
  it('is amber for a clear day, slate for a clear night', () => {
    expect(weatherGlow(0, true)).toBe('251,191,36')
    expect(weatherGlow(0, false)).toBe('148,163,184')
  })
  it('maps precipitation/storm conditions to their tone family', () => {
    expect(weatherGlow(63)).toBe('56,189,248') // rain → sky
    expect(weatherGlow(66)).toBe('34,211,238') // freezing → cyan
    expect(weatherGlow(75)).toBe('125,211,252') // snow → sky-300
    expect(weatherGlow(95)).toBe('167,139,250') // thunderstorm → violet
  })
  it('falls back to slate for overcast/unknown', () => {
    expect(weatherGlow(3)).toBe('148,163,184')
    expect(weatherGlow(999)).toBe('148,163,184')
  })
})

describe('weatherInfo', () => {
  it('swaps the icon by day/night for clear codes', () => {
    expect(weatherInfo(0, true).Icon).toBe(Sun)
    expect(weatherInfo(0, false).Icon).toBe(Moon)
  })
  it('maps grouped codes to their Lucide icon', () => {
    expect(weatherInfo(2, true).Icon).toBe(CloudSun)
    expect(weatherInfo(61).Icon).toBe(CloudRain)
    expect(weatherInfo(95).Icon).toBe(CloudLightning)
  })
  it('falls back to Unknown + a cloud for an unrecognized code', () => {
    const info = weatherInfo(999)
    expect(info.label).toBe('Unknown')
    expect(info.Icon).toBe(Cloud)
  })
  it('returns the right labels', () => {
    expect(weatherInfo(0).label).toBe('Clear')
    expect(weatherInfo(3).label).toBe('Overcast')
    expect(weatherInfo(45).label).toBe('Fog')
    expect(weatherInfo(61).label).toBe('Rain')
    expect(weatherInfo(71).label).toBe('Snow')
    expect(weatherInfo(95).label).toBe('Thunderstorm')
  })
})

describe('weatherIcon', () => {
  it('is the icon from weatherInfo', () => {
    expect(weatherIcon(0, true)).toBe(Sun)
    expect(weatherIcon(0, false)).toBe(Moon)
  })
})

describe('formatTemp', () => {
  it('rounds and appends the unit', () => {
    expect(formatTemp(67.8, '°F')).toBe('68°F')
    expect(formatTemp(20, '°C')).toBe('20°C')
  })
  it('shows an em dash for null', () => {
    expect(formatTemp(null, '°F')).toBe('—')
  })
})

describe('dayName', () => {
  it('returns a 3-letter weekday for a YYYY-MM-DD string', () => {
    const name = dayName('2026-06-22')
    expect(name).toHaveLength(3)
    expect(name).toMatch(/^[A-Za-z]{3}$/)
  })
  it('returns an empty string for invalid input', () => {
    expect(dayName('')).toBe('')
    expect(dayName('not-a-date')).toBe('')
  })
})

describe('tempColor', () => {
  it('ramps cold→hot from blue toward red', () => {
    const coldHue = Number(tempColor(10).match(/hsl\((\d+)/)[1])
    const hotHue = Number(tempColor(100).match(/hsl\((\d+)/)[1])
    expect(coldHue).toBeGreaterThan(hotHue) // blue (high hue) → red (low hue)
  })
  it('clamps out-of-range temps', () => {
    expect(tempColor(-50)).toBe(tempColor(10)) // both clamp to the cold end
    expect(tempColor(150)).toBe(tempColor(100)) // both clamp to the hot end
  })
  it('treats metric via a °F conversion (0°C ≈ 32°F, not the cold floor)', () => {
    expect(tempColor(0, '°C')).toBe(tempColor(32, '°F'))
  })
  it('returns a neutral color for null', () => {
    expect(tempColor(null)).toMatch(/^hsl\(/)
  })
})

describe('tempBarStyle', () => {
  it('positions a day within the week range', () => {
    // Week 50→90 (span 40); a 60→80 day sits 25% in and is 50% wide.
    expect(tempBarStyle(60, 80, 50, 90)).toEqual({ left: '25%', width: '50%' })
  })
  it('floors a tiny width so the bar stays visible', () => {
    const { width } = tempBarStyle(60, 60.1, 50, 90)
    expect(parseFloat(width)).toBeGreaterThanOrEqual(4)
  })
  it('keeps left+width within the track for a flat day at the hot end', () => {
    // A near-flat day at the week max: floored to a 4% bar, left must clamp so it
    // doesn't overflow the right edge.
    const { left, width } = tempBarStyle(89.9, 90, 50, 90)
    expect(parseFloat(left) + parseFloat(width)).toBeLessThanOrEqual(100)
  })
  it('falls back to full width on a degenerate or missing range', () => {
    expect(tempBarStyle(60, 80, 70, 70)).toEqual({ left: '0%', width: '100%' })
    expect(tempBarStyle(null, 80, 50, 90)).toEqual({ left: '0%', width: '100%' })
  })
})

describe('hourLabel', () => {
  it('formats 12-hour with a/p suffixes', () => {
    expect(hourLabel('2026-06-24T00:00')).toBe('12a')
    expect(hourLabel('2026-06-24T06:00')).toBe('6a')
    expect(hourLabel('2026-06-24T12:00')).toBe('12p')
    expect(hourLabel('2026-06-24T15:00')).toBe('3p')
  })
  it('returns an empty string for invalid input', () => {
    expect(hourLabel('')).toBe('')
    expect(hourLabel('nope')).toBe('')
  })
})
