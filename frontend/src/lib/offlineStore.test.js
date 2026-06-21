import { describe, it, expect } from 'vitest'
import { downloadKey, auditCache, summarizeStorage } from './offlineStore.js'

describe('downloadKey', () => {
  it('combines section + id into one stable key', () => {
    expect(downloadKey('books', 'Author/Title.epub')).toBe('books:Author/Title.epub')
  })
})

describe('auditCache', () => {
  const entries = [
    { urls: ['/api/library/file?id=a', '/api/library/file?id=b'] },
    { urls: ['/api/library/comics/page?id=c&n=0'] },
  ]

  it('is clean when the cache exactly matches the manifest', () => {
    const cached = ['/api/library/file?id=a', '/api/library/file?id=b', '/api/library/comics/page?id=c&n=0']
    const r = auditCache(entries, cached)
    expect(r.orphans).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.clean).toBe(true)
  })

  it('flags orphan cached bytes not referenced by any download', () => {
    const cached = ['/api/library/file?id=a', '/api/library/file?id=b', '/api/library/comics/page?id=c&n=0', '/sneaky']
    const r = auditCache(entries, cached)
    expect(r.orphans).toEqual(['/sneaky'])
    expect(r.clean).toBe(false)
  })

  it('flags manifest URLs missing from the cache (partial eviction)', () => {
    const cached = ['/api/library/file?id=a'] // b + the comic page were evicted
    const r = auditCache(entries, cached)
    expect(r.missing).toContain('/api/library/file?id=b')
    expect(r.missing).toContain('/api/library/comics/page?id=c&n=0')
    expect(r.clean).toBe(false)
  })

  it('tolerates empty/undefined inputs', () => {
    expect(auditCache(undefined, undefined)).toEqual({ orphans: [], missing: [], clean: true })
  })
})

describe('summarizeStorage', () => {
  const entries = [
    { key: 'books:dune', name: 'Dune', bytes: 1_400_000, date: 200 },
    { key: 'comics:saga', name: 'Saga Vol 1', bytes: 62_000_000, date: 300 },
  ]

  it('totals downloads, adds the shell, and orders items newest-first', () => {
    const s = summarizeStorage(entries, { usage: 70_000_000, quota: 12_000_000_000 }, 2_000_000)
    expect(s.items.map((e) => e.key)).toEqual(['comics:saga', 'books:dune']) // newest first
    expect(s.downloadsBytes).toBe(63_400_000)
    expect(s.shellBytes).toBe(2_000_000)
    expect(s.accounted).toBe(65_400_000)
    expect(s.quota).toBe(12_000_000_000)
  })

  it('computes unaccounted bytes from the browser usage figure', () => {
    // usage exceeds what we can attribute → surfaced, not hidden
    const s = summarizeStorage(entries, { usage: 70_000_000 }, 2_000_000)
    expect(s.unaccounted).toBe(70_000_000 - 65_400_000)
  })

  it('never reports negative unaccounted bytes', () => {
    const s = summarizeStorage(entries, { usage: 10 }, 0)
    expect(s.unaccounted).toBe(0)
  })

  it('reports null usage/unaccounted when the browser gives no estimate', () => {
    const s = summarizeStorage(entries, {}, 0)
    expect(s.usage).toBeNull()
    expect(s.unaccounted).toBeNull()
  })

  it('handles an empty store', () => {
    const s = summarizeStorage([], { usage: 0, quota: 100 }, 0)
    expect(s.items).toEqual([])
    expect(s.downloadsBytes).toBe(0)
    expect(s.accounted).toBe(0)
  })

  it('adds captured game saves as their own line in the accounting', () => {
    const e = [{ key: 'games:g', section: 'games', name: 'G', bytes: 4_000_000, date: 1 }]
    const s = summarizeStorage(e, {}, 1_000_000, 250_000) // shell 1MB, game saves 250KB
    expect(s.gameSavesBytes).toBe(250_000)
    expect(s.downloadsBytes).toBe(4_000_000)
    expect(s.accounted).toBe(4_000_000 + 1_000_000 + 250_000) // downloads + shell + saves
  })

  it('breaks the shared emulator engine out of the items as its own line', () => {
    const e = [
      { key: 'books:d', section: 'books', name: 'D', bytes: 1000, date: 2 },
      { key: 'emulator:engine', section: 'emulator', name: 'Emulator engine', bytes: 5000, date: 1 },
    ]
    const s = summarizeStorage(e, {}, 0)
    expect(s.items.map((i) => i.key)).toEqual(['books:d']) // engine not a content item
    expect(s.engineBytes).toBe(5000)
    expect(s.downloadsBytes).toBe(1000)
    expect(s.accounted).toBe(6000) // downloads + shell(0) + engine
  })
})
