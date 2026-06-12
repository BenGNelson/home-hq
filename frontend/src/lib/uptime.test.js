import { describe, it, expect } from 'vitest'
import { uptimeTone, formatPct, formatMs, uptimeHeadline } from './uptime.js'

describe('uptimeTone', () => {
  it('maps status to a tone', () => {
    expect(uptimeTone('up')).toBe('good')
    expect(uptimeTone('down')).toBe('bad')
    expect(uptimeTone('unknown')).toBe('idle')
  })
})

describe('formatPct', () => {
  it('drops trailing .0 but keeps real decimals', () => {
    expect(formatPct(100)).toBe('100%')
    expect(formatPct(99.8)).toBe('99.8%')
  })
  it('em-dashes null', () => {
    expect(formatPct(null)).toBe('—')
  })
})

describe('formatMs', () => {
  it('formats and em-dashes null', () => {
    expect(formatMs(12)).toBe('12 ms')
    expect(formatMs(null)).toBe('—')
  })
})

describe('uptimeHeadline', () => {
  it('counts services up', () => {
    const data = { configured: true, targets: [{ status: 'up' }, { status: 'down' }, { status: 'up' }] }
    expect(uptimeHeadline(data)).toBe('2/3 services up')
  })
  it('handles not configured', () => {
    expect(uptimeHeadline({ configured: false })).toMatch(/no uptime data/i)
  })
})
