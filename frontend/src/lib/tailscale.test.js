import { describe, it, expect } from 'vitest'
import { Monitor, Smartphone, MonitorDot } from 'lucide-react'
import { tailscaleVerdict, tailscaleExplanation, osIcon } from './tailscale.js'

const UP = { available: true, status: 'up', stale: false, online_count: 2, peer_count: 3 }

describe('tailscaleVerdict', () => {
  it('is good when connected', () => {
    expect(tailscaleVerdict(UP)).toEqual({ tone: 'good', label: 'Connected' })
  })
  it('is idle and not-configured when unavailable', () => {
    expect(tailscaleVerdict({ available: false }).tone).toBe('idle')
    expect(tailscaleVerdict(null).label).toBe('Not configured')
  })
  it('flags a stale snapshot as idle', () => {
    expect(tailscaleVerdict({ ...UP, stale: true }).label).toMatch(/stale/i)
  })
  it('is bad when the host is disconnected', () => {
    expect(tailscaleVerdict({ ...UP, status: 'down' })).toEqual({
      tone: 'bad',
      label: 'Disconnected',
    })
  })
  it('is idle when Tailscale is not running', () => {
    expect(tailscaleVerdict({ available: true, status: 'unavailable' }).tone).toBe('idle')
  })
})

describe('tailscaleExplanation', () => {
  it('summarizes the online count when connected', () => {
    expect(tailscaleExplanation(UP)).toContain('2 of 3')
  })
  it('singularizes a one-device tailnet', () => {
    const msg = tailscaleExplanation({ ...UP, online_count: 1, peer_count: 1 })
    expect(msg).toContain('device online')
    expect(msg).not.toContain('devices')
  })
})

describe('osIcon', () => {
  it('maps known platforms to a generic device-type Lucide component', () => {
    expect(osIcon('linux')).toBe(Monitor)
    expect(osIcon('iOS')).toBe(Smartphone)
  })
  it('falls back to MonitorDot for unknown/empty', () => {
    expect(osIcon('plan9')).toBe(MonitorDot)
    expect(osIcon(undefined)).toBe(MonitorDot)
  })
})
