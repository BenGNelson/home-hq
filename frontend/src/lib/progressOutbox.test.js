import { describe, it, expect } from 'vitest'
import { readingKey, listenKey, chooseResume } from './progressOutbox.js'

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
