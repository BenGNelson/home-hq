import { describe, it, expect } from 'vitest'
import { watchdogBadge } from './watchdog.js'

describe('watchdogBadge', () => {
  it('flags a stale (not-running) watchdog as idle', () => {
    expect(watchdogBadge({ stale: true, healthy: true }).label).toBe('idle')
  })

  it('shows OK when healthy and fresh', () => {
    const b = watchdogBadge({ stale: false, healthy: true })
    expect(b.label).toBe('OK')
    expect(b.cls).toContain('emerald')
  })

  it('shows failed when a recovery did not restore health', () => {
    const b = watchdogBadge({ stale: false, healthy: false, note: 'recovery-failed' })
    expect(b.label).toBe('failed')
    expect(b.cls).toContain('rose')
  })

  it('shows recovering when unhealthy but still being worked on', () => {
    const b = watchdogBadge({ stale: false, healthy: false, note: 'probe-failed' })
    expect(b.label).toBe('recovering')
    expect(b.cls).toContain('amber')
  })
})
