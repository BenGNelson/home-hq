import { describe, it, expect } from 'vitest'
import { buildUrl, buildNavLinks, haDeepLink, appLinkFromLinks } from './hostLocal.js'

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

describe('buildNavLinks', () => {
  it('returns [] when there are no host-local links', () => {
    expect(buildNavLinks(undefined, 'h')).toEqual([])
    expect(buildNavLinks(null, 'h')).toEqual([])
    expect(buildNavLinks([], 'h')).toEqual([])
  })

  it('resolves each url spec against the hostname and marks it external', () => {
    const links = [
      { id: 'ha', label: 'Home Assistant', icon: '🏡', group: 'Devices', url: { port: 8123 } },
    ]
    expect(buildNavLinks(links, '192.168.0.10')).toEqual([
      {
        id: 'ha',
        label: 'Home Assistant',
        icon: '🏡',
        group: 'Devices',
        url: { port: 8123 },
        external: true,
        path: 'http://192.168.0.10:8123',
      },
    ])
  })

  it('uses the current hostname, so the same entry resolves on LAN or Tailscale', () => {
    const links = [{ id: 'ha', url: { port: 8123 } }]
    expect(buildNavLinks(links, 'box.tailnet.ts.net')[0].path).toBe(
      'http://box.tailnet.ts.net:8123',
    )
  })

  it('drops entries whose url does not resolve to a link', () => {
    const links = [
      { id: 'good', url: { port: 8123 } },
      { id: 'empty', url: {} },
      { id: 'missing' },
    ]
    expect(buildNavLinks(links, 'h').map((l) => l.id)).toEqual(['good'])
  })
})

describe('appLinkFromLinks', () => {
  const links = [
    { id: 'games', url: 'https://box.tailnet.ts.net:8444' },
    { id: 'ha', url: { port: 8123 } },
  ]

  it('resolves a nav link URL by id (verbatim string or spec)', () => {
    expect(appLinkFromLinks(links, 'games', 'ignored')).toBe('https://box.tailnet.ts.net:8444')
    expect(appLinkFromLinks(links, 'ha', 'box.ts.net')).toBe('http://box.ts.net:8123')
  })

  it('returns null when the id is absent or unconfigured', () => {
    expect(appLinkFromLinks(links, 'nope', 'h')).toBe(null)
    expect(appLinkFromLinks(undefined, 'games', 'h')).toBe(null)
    expect(appLinkFromLinks([{ id: 'games' }], 'games', 'h')).toBe(null)
  })
})

describe('haDeepLink', () => {
  const links = [{ id: 'home-assistant', url: { port: 8123 } }]

  it('builds a per-entity deep link from the home-assistant nav entry', () => {
    expect(haDeepLink(links, '192.168.0.10', '/history?entity_id=sensor.x')).toBe(
      'http://192.168.0.10:8123/history?entity_id=sensor.x',
    )
  })

  it('resolves against the given hostname (LAN or Tailscale)', () => {
    expect(haDeepLink(links, 'box.tailnet.ts.net', '/lovelace')).toBe(
      'http://box.tailnet.ts.net:8123/lovelace',
    )
  })

  it('returns null when HA is not configured', () => {
    expect(haDeepLink(undefined, 'h', '/x')).toBeNull()
    expect(haDeepLink([], 'h', '/x')).toBeNull()
    expect(haDeepLink([{ id: 'other', url: { port: 1 } }], 'h', '/x')).toBeNull()
    expect(haDeepLink([{ id: 'home-assistant' }], 'h', '/x')).toBeNull()
  })

  it('passes an absolute-URL string spec through, appending the path', () => {
    const abs = [{ id: 'home-assistant', url: 'https://ha.example.com' }]
    expect(haDeepLink(abs, 'ignored', '/history')).toBe('https://ha.example.com/history')
  })

  it('preserves a configured base path before the suffix', () => {
    const based = [{ id: 'home-assistant', url: { port: 8123, path: '/base' } }]
    expect(haDeepLink(based, 'h', '/history')).toBe('http://h:8123/base/history')
  })
})
