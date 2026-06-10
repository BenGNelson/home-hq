import { describe, it, expect } from 'vitest'
import { buildUrl } from './hostLocal.js'

describe('buildUrl', () => {
  it('returns null when there is no spec', () => {
    expect(buildUrl(undefined, 'host')).toBeNull()
    expect(buildUrl(null, 'host')).toBeNull()
  })

  it('passes an absolute-URL string through unchanged', () => {
    expect(buildUrl('https://example.test/app', 'ignored')).toBe(
      'https://example.test/app',
    )
  })

  it('builds http://<hostname>:<port> from a port spec', () => {
    expect(buildUrl({ port: 8484 }, '192.168.0.10')).toBe(
      'http://192.168.0.10:8484',
    )
  })

  it('uses the current hostname, so LAN and Tailscale both resolve', () => {
    expect(buildUrl({ port: 8080 }, 'box.tailnet.ts.net')).toBe(
      'http://box.tailnet.ts.net:8080',
    )
  })

  it('honors a custom scheme and path', () => {
    expect(buildUrl({ port: 9443, scheme: 'https', path: '/ui' }, 'h')).toBe(
      'https://h:9443/ui',
    )
  })

  it('allows a path with no port (default port)', () => {
    expect(buildUrl({ path: '/dash' }, 'h')).toBe('http://h/dash')
  })

  it('returns null for an empty object (nothing to link to)', () => {
    expect(buildUrl({}, 'h')).toBeNull()
  })
})
