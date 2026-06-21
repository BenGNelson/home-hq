import { describe, it, expect } from 'vitest'
import { Battery, Droplet, Zap, Route, Lock, WashingMachine } from 'lucide-react'
import { entityIcon, entityLabel, entityValue, lowBattery } from './ha.js'

describe('entityIcon', () => {
  it('prefers device_class over domain', () => {
    expect(entityIcon({ device_class: 'battery', domain: 'sensor' })).toBe(Battery)
    expect(entityIcon({ device_class: 'humidity', domain: 'sensor' })).toBe(Droplet)
  })

  it('maps the Tesla-style device classes (charging, distance)', () => {
    // binary_sensor.*_charging would otherwise fall through to the bell icon.
    expect(entityIcon({ device_class: 'battery_charging', domain: 'binary_sensor' })).toBe(Zap)
    // sensor.*_range would otherwise fall through to null.
    expect(entityIcon({ device_class: 'distance', domain: 'sensor' })).toBe(Route)
  })

  it('falls back to domain, then id keywords, then null', () => {
    expect(entityIcon({ domain: 'lock' })).toBe(Lock)
    expect(entityIcon({ domain: 'sensor', entity_id: 'sensor.dryer_time_remaining' })).toBe(WashingMachine)
    expect(entityIcon({ domain: 'sensor', entity_id: 'sensor.mystery' })).toBe(null)
  })
})

describe('entityLabel', () => {
  it('uses the friendly name when present', () => {
    expect(entityLabel({ name: 'Dryer', entity_id: 'sensor.x' })).toBe('Dryer')
  })

  it('prettifies the entity id when no name', () => {
    expect(entityLabel({ entity_id: 'sensor.phone_battery' })).toBe('Phone Battery')
  })
})

describe('entityValue', () => {
  it('appends a word unit with a space and percent without', () => {
    expect(entityValue({ state: '42', unit: 'min' })).toBe('42 min')
    expect(entityValue({ state: '15', unit: '%' })).toBe('15%')
  })

  it('maps common bare states to friendly labels', () => {
    expect(entityValue({ state: 'on' })).toBe('On')
    expect(entityValue({ state: 'not_home' })).toBe('Away')
    expect(entityValue({ state: 'unavailable' })).toBe('—')
  })

  it('leaves non-numeric states and empty values sensible', () => {
    expect(entityValue({ state: 'Running' })).toBe('Running')
    expect(entityValue({ state: '' })).toBe('—')
    expect(entityValue({ state: '   ' })).toBe('—') // whitespace-only -> dash
    // A unit on a non-numeric state is ignored (no "Running min").
    expect(entityValue({ state: 'Running', unit: 'min' })).toBe('Running')
  })

  it('coerces a numeric-typed state and survives a missing entity', () => {
    expect(entityValue({ state: 42, unit: 'min' })).toBe('42 min')
    expect(entityValue(undefined)).toBe('—')
  })

  it('rounds raw floats for display and keeps whole numbers whole', () => {
    expect(entityValue({ state: '63.1833333333333', unit: 'min' })).toBe('63.2 min')
    expect(entityValue({ state: '20.0', unit: 'min' })).toBe('20 min')
    expect(entityValue({ state: '47.5', unit: '%' })).toBe('47.5%')
    expect(entityValue({ state: '12.0' })).toBe('12') // numeric, no unit
  })
})

describe('lowBattery', () => {
  it('flags a battery at/under the threshold', () => {
    expect(lowBattery({ device_class: 'battery', state: '15' })).toBe(true)
    expect(lowBattery({ device_class: 'battery', state: '20' })).toBe(true)
    expect(lowBattery({ device_class: 'battery', state: '80' })).toBe(false)
  })

  it('ignores non-battery entities and non-numeric states', () => {
    expect(lowBattery({ device_class: 'humidity', state: '5' })).toBe(false)
    expect(lowBattery({ device_class: 'battery', state: 'unknown' })).toBe(false)
  })
})
