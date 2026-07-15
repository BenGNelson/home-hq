import { describe, it, expect } from 'vitest'
import { KEYS, COLS, matches, searchGames, liveKeys, gridMove } from './search.js'

const g = (id, name, label = 'Game Boy') => ({ id, name, label, core: 'gb' })

const LIBRARY = [
  g('1', 'Super Mario World', 'Super Nintendo'),
  g('2', 'Super Mario Land', 'Game Boy'),
  g('3', 'The Legend of Zelda', 'Super Nintendo'),
  g('4', 'Sonic the Hedgehog', 'Sega Genesis'),
  g('5', '3D Pocket Pool', 'Game Boy Color'),
]

describe('KEYS', () => {
  it('is exactly a full 6×6 grid — A–Z then 0–9, nothing left over', () => {
    expect(KEYS.length).toBe(COLS * 6)
    expect(KEYS.join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
  })
})

describe('matches', () => {
  it('is a substring test, not a prefix test', () => {
    // The word you remember is usually buried mid-title.
    expect(matches('The Legend of Zelda', 'zelda')).toBe(true)
    expect(matches('Super Mario World', 'mario')).toBe(true)
  })

  it('ignores case', () => {
    expect(matches('Sonic the Hedgehog', 'SONIC')).toBe(true)
  })

  it('an empty query matches everything', () => {
    expect(matches('anything', '')).toBe(true)
  })
})

describe('searchGames', () => {
  it('finds every title containing the query, across systems', () => {
    const hits = searchGames(LIBRARY, 'super').map((g) => g.name)
    expect(hits).toEqual(['Super Mario Land', 'Super Mario World'])
  })

  it('returns nothing for an empty query — the grid is the whole UI until you type', () => {
    expect(searchGames(LIBRARY, '')).toEqual([])
  })

  it('natural-sorts the hits', () => {
    const lib = [g('a', 'Mario 10'), g('b', 'Mario 2')]
    expect(searchGames(lib, 'mario').map((x) => x.name)).toEqual(['Mario 2', 'Mario 10'])
  })

  it('caps the result count', () => {
    const many = Array.from({ length: 200 }, (_, i) => g(String(i), `Mario ${i}`))
    expect(searchGames(many, 'mario', 60)).toHaveLength(60)
  })
})

describe('liveKeys', () => {
  it('lights only the keys that extend the query to a real hit', () => {
    // After "mario " the only next letters in the library are L(and) and W(orld)...
    // but we never type spaces, so test the letter straight after "mario".
    const live = liveKeys(LIBRARY, 'mari')
    expect(live.has('O')).toBe(true) // "mario"
    expect(live.has('Z')).toBe(false) // nothing is "mariz…"
  })

  it('an empty query lights every character present anywhere in the library', () => {
    const live = liveKeys(LIBRARY, '')
    expect(live.has('S')).toBe(true) // Super, Sonic
    expect(live.has('3')).toBe(true) // 3D Pocket Pool
    expect(live.has('Q')).toBe(false) // no title contains a Q
  })

  it('finds a query buried mid-title, not just at the start', () => {
    // "zelda" is live because a title CONTAINS it; the key after "zeld" is "a".
    expect(liveKeys(LIBRARY, 'zeld').has('A')).toBe(true)
  })
})

describe('gridMove', () => {
  it('wraps left and right around the whole grid', () => {
    expect(gridMove(0, 'left')).toEqual({ index: KEYS.length - 1 })
    expect(gridMove(KEYS.length - 1, 'right')).toEqual({ index: 0 })
  })

  it('wraps up from the top row to the bottom of the same column', () => {
    expect(gridMove(2, 'up')).toEqual({ index: 2 + KEYS.length - COLS })
  })

  it('moves down a row inside the grid', () => {
    expect(gridMove(0, 'down')).toEqual({ index: COLS })
  })

  it('leaves the grid — into the results — when you press down off the bottom row', () => {
    // The bottom row is the last COLS keys; down from any of them exits.
    expect(gridMove(KEYS.length - 1, 'down')).toEqual({ exit: 'results' })
    expect(gridMove(KEYS.length - COLS, 'down')).toEqual({ exit: 'results' })
  })
})
