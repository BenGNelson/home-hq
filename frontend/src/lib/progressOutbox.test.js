import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import 'fake-indexeddb/auto' // provides a real-enough indexedDB for the IO tests
import { IDBFactory } from 'fake-indexeddb'
import {
  readingKey,
  listenKey,
  chooseResume,
  saveProgress,
  flushOutbox,
  pendingEntries,
} from './progressOutbox.js'

describe('progressOutbox keys', () => {
  it('reading keys are stable so repeated saves coalesce (last-write-wins)', () => {
    expect(readingKey('books', 'a/b.epub')).toBe(readingKey('books', 'a/b.epub'))
  })

  it('different items get different reading keys', () => {
    expect(readingKey('books', 'x')).not.toBe(readingKey('books', 'y'))
    expect(readingKey('books', 'x')).not.toBe(readingKey('papers', 'x'))
  })

  it('namespaces reading vs listening so they can never collide', () => {
    // Same underlying id, different activity → distinct keys.
    expect(readingKey('audiobooks', 'My Book')).not.toBe(listenKey('My Book'))
    expect(listenKey('x')).toMatch(/^listen:/)
    expect(readingKey('books', 'x')).toMatch(/^read:/)
  })
})

describe('chooseResume', () => {
  const unsynced = { synced: false, body: { page: 9 } }
  const synced = { synced: true, body: { page: 5 } }
  const server = { page: 7 }

  it('unsynced local (offline progress) always wins, even online', () => {
    expect(chooseResume(unsynced, true, server)).toBe(unsynced.body)
    expect(chooseResume(unsynced, false, null)).toBe(unsynced.body)
  })

  it('prefers the server when online and the local copy is synced', () => {
    // This is the cross-device case: another device advanced the server.
    expect(chooseResume(synced, true, server)).toBe(server)
  })

  it('falls back to the local copy when offline (the downloaded-and-read-online bug)', () => {
    expect(chooseResume(synced, false, null)).toBe(synced.body)
  })

  it('uses the local copy when online but the server has nothing / failed', () => {
    expect(chooseResume(synced, true, null)).toBe(synced.body)
  })

  it('uses the server when online with no local copy', () => {
    expect(chooseResume(null, true, server)).toBe(server)
  })

  it('returns null when there is nothing to resume from', () => {
    expect(chooseResume(null, false, null)).toBe(null)
    expect(chooseResume(null, true, null)).toBe(null)
  })
})

// The replay engine (status branching) over a real fake IndexedDB + a mocked
// fetch. Losing this logic silently loses offline reading progress or retries a
// doomed write forever, so the 2xx/4xx/5xx/network branches each get a case.
describe('flushOutbox (offline-sync replay)', () => {
  // A pristine IndexedDB per test (the module never closes its connection, so
  // deleteDatabase would block — a fresh factory is the clean reset).
  beforeEach(() => {
    global.indexedDB = new IDBFactory()
  })
  afterAll(() => {
    delete global.fetch
  })

  const body = { section: 'papers', id: 'x', page: 3 }
  // Queue one unsynced entry by making the save's PUT fail (offline).
  async function queueUnsynced(key) {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'))
    await saveProgress({ key, path: '/library/reading-progress', body })
  }
  const syncedOf = async (key) => (await pendingEntries()).find((e) => e.key === key)?.synced

  it('marks an entry synced on a 2xx and counts it as flushed', async () => {
    await queueUnsynced('read:papers:ok')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    expect(await flushOutbox()).toBe(1)
    expect(await syncedOf('read:papers:ok')).toBe(true)
  })

  it('gives up (marks synced) on a 4xx but does not count it as flushed', async () => {
    await queueUnsynced('read:papers:rejected')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    expect(await flushOutbox()).toBe(0)
    expect(await syncedOf('read:papers:rejected')).toBe(true)
  })

  it('leaves the entry unsynced on a 5xx (retry next reconnect)', async () => {
    await queueUnsynced('read:papers:server-err')
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    expect(await flushOutbox()).toBe(0)
    expect(await syncedOf('read:papers:server-err')).toBe(false)
  })

  it('leaves the entry unsynced on a network error', async () => {
    await queueUnsynced('read:papers:net')
    global.fetch = vi.fn().mockRejectedValue(new Error('network'))
    expect(await flushOutbox()).toBe(0)
    expect(await syncedOf('read:papers:net')).toBe(false)
  })
})
