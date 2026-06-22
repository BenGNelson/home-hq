import { describe, it, expect } from 'vitest'
import {
  Sun,
  Moon,
  CloudSun,
  CloudRain,
  CloudLightning,
  Cloud,
} from 'lucide-react'
import { weatherInfo, weatherIcon, formatTemp, dayName } from './weather.js'

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
