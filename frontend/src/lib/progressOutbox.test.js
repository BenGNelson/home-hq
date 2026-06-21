import { describe, it, expect } from 'vitest'
import { readingKey, listenKey } from './progressOutbox.js'

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
