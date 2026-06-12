import { describe, it, expect } from 'vitest'
import { vpnVerdict, vpnExplanation } from './vpn.js'

describe('vpnVerdict', () => {
  it('reports protected when masked', () => {
    const v = vpnVerdict({ available: true, status: 'protected', leak: false })
    expect(v.tone).toBe('good')
    expect(v.label).toBe('Protected')
  })

  it('flags a leak as bad', () => {
    expect(vpnVerdict({ available: true, status: 'leak', leak: true }).tone).toBe('bad')
  })

  it('treats VPN off as neutral, not bad', () => {
    expect(vpnVerdict({ available: true, status: 'down' }).tone).toBe('idle')
  })

  it('treats stale as neutral regardless of status', () => {
    expect(vpnVerdict({ available: true, status: 'leak', stale: true }).tone).toBe('idle')
  })

  it('handles missing/unconfigured data', () => {
    expect(vpnVerdict(undefined).label).toBe('Not configured')
    expect(vpnVerdict({ available: false }).label).toBe('Not configured')
  })
})

describe('vpnExplanation', () => {
  it('explains a leak in plain terms', () => {
    expect(vpnExplanation({ available: true, status: 'leak', leak: true })).toMatch(/home IP/)
  })

  it('notes the kill-switch when down', () => {
    expect(vpnExplanation({ available: true, status: 'down' })).toMatch(/kill-switch/)
  })
})
