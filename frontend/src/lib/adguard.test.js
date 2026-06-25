import { describe, it, expect } from 'vitest'
import { formatPercent, formatCount, topDomainsPreview, adguardUnavailableMessage } from './adguard.js'

describe('formatPercent', () => {
  it('renders one decimal, dash for null', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(16.5)).toBe('16.5%')
  })
})

describe('formatCount', () => {
  it('adds thousands separators, dash for null', () => {
    expect(formatCount(null)).toBe('—')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(12345)).toBe('12,345')
  })
})

describe('topDomainsPreview', () => {
  it('takes the first N, tolerating non-arrays', () => {
    expect(topDomainsPreview(null)).toEqual([])
    const list = [{ domain: 'a' }, { domain: 'b' }, { domain: 'c' }, { domain: 'd' }]
    expect(topDomainsPreview(list, 2)).toEqual([{ domain: 'a' }, { domain: 'b' }])
    expect(topDomainsPreview(list)).toHaveLength(3)
  })
})

describe('adguardUnavailableMessage', () => {
  it('maps each reason', () => {
    expect(adguardUnavailableMessage('not_configured')).toMatch(/configured/)
    expect(adguardUnavailableMessage('unreachable')).toMatch(/reach/)
    expect(adguardUnavailableMessage('whatever')).toMatch(/unavailable/)
  })
})
