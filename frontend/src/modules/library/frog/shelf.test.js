import { describe, it, expect } from 'vitest'
import { buildShelf, buildSystems, jumpBackIn, favoriteGames, agoLabel, stepLetter, SYSTEM_ORDER } from './shelf.js'

const g = (id, name, label) => ({ id, name, label, core: 'gb' })

const LIBRARY = [
  g('1', 'Pokemon Red', 'Game Boy'),
  g('2', "Link's Awakening", 'Game Boy'),
  g('3', 'Pokemon Crystal', 'Game Boy Color'),
  g('4', 'Sonic 2', 'Sega Genesis'),
]

describe('buildSystems', () => {
  it('shows all six machines, in hardware order, always', () => {
    const systems = buildSystems(LIBRARY)
    expect(systems.map((s) => s.label)).toEqual(SYSTEM_ORDER)
  })

  it('keeps a system with no games — dimmed, not missing', () => {
    // A gap in the row is more confusing than an empty shelf, and it's the only
    // thing that tells you what Frog *could* play if you dropped a ROM in.
    const snes = buildSystems(LIBRARY).find((s) => s.label === 'Super Nintendo')
    expect(snes.count).toBe(0)
  })

  it('counts the games on each machine', () => {
    const byLabel = Object.fromEntries(buildSystems(LIBRARY).map((s) => [s.label, s.count]))
    expect(byLabel['Game Boy']).toBe(2)
    expect(byLabel['Game Boy Color']).toBe(1)
    expect(byLabel['Sega Genesis']).toBe(1)
  })

  it('puts an unknown system at the end rather than dropping it', () => {
    // A new core added to the backend must not silently vanish from the shelf.
    const systems = buildSystems([...LIBRARY, g('9', 'Some Game', 'Nintendo 64')])
    expect(systems.at(-1)).toMatchObject({ label: 'Nintendo 64', count: 1 })
    expect(systems).toHaveLength(SYSTEM_ORDER.length + 1)
  })
})

describe('jumpBackIn', () => {
  it('matches recent markers back to the live library, newest first', () => {
    const jump = jumpBackIn(LIBRARY, [{ id: '4', ts: 200 }, { id: '1', ts: 100 }])
    expect(jump.map((j) => j.name)).toEqual(['Sonic 2', 'Pokemon Red'])
  })

  it('takes the name from the LIBRARY, not the stale marker', () => {
    const jump = jumpBackIn(LIBRARY, [{ id: '1', name: 'an old name', ts: 5 }])
    expect(jump[0].name).toBe('Pokemon Red')
    expect(jump[0].ts).toBe(5)
  })

  it('drops a game that has left the library', () => {
    expect(jumpBackIn(LIBRARY, [{ id: 'gone', ts: 1 }])).toEqual([])
  })
})

describe('buildShelf', () => {
  it('puts Jump back in FIRST — where focus lands', () => {
    // The whole argument of the shelf: you are almost always coming back to the
    // same game, so most sessions should never touch the alphabet.
    const rails = buildShelf(LIBRARY, [{ id: '1', ts: 1 }])
    expect(rails[0].id).toBe('jump')
    expect(rails[1].id).toBe('systems')
  })

  it('drops the row entirely when there is nothing to jump back into', () => {
    // A heading over an empty row is a worse first impression than no heading.
    const rails = buildShelf(LIBRARY, [])
    expect(rails.map((r) => r.id)).toEqual(['systems'])
  })

  it('puts Favorites right after Jump back in', () => {
    const rails = buildShelf(LIBRARY, [{ id: '1', ts: 1 }], [{ id: '3' }])
    expect(rails.map((r) => r.id)).toEqual(['jump', 'favorites', 'systems'])
  })

  it('shows Favorites even with no recents', () => {
    const rails = buildShelf(LIBRARY, [], [{ id: '3' }])
    expect(rails.map((r) => r.id)).toEqual(['favorites', 'systems'])
  })
})

describe('favoriteGames', () => {
  it('re-hydrates against the live library, dropping games that have left', () => {
    const favs = favoriteGames(LIBRARY, [{ id: '3' }, { id: 'gone' }])
    expect(favs.map((g) => g.id)).toEqual(['3'])
  })

  it('uses the library name, not the stored copy', () => {
    const favs = favoriteGames(LIBRARY, [{ id: '1', name: 'Stale Name' }])
    expect(favs[0].name).toBe('Pokemon Red')
  })
})

describe('stepLetter', () => {
  // A, then a gap where B/C/D would be, then E, then two Ss.
  const list = [
    g('a1', 'Alleyway', 'Game Boy'),
    g('a2', 'Astro Rabby', 'Game Boy'),
    g('e1', 'Earthbound', 'Game Boy'),
    g('s1', 'Super Mario Land', 'Game Boy'),
    g('s2', 'Survival Kids', 'Game Boy'),
  ]

  it('skips the empty letters — a trigger press always moves', () => {
    // From "Astro Rabby" (A), the next letter with anything behind it is E, not B.
    expect(stepLetter(list, 1, 1)).toBe(2)
  })

  it('lands on the FIRST game of the letter it jumps to', () => {
    expect(stepLetter(list, 2, 1)).toBe(3) // E → the first S
  })

  it('rewinds to the top of the current letter before leaving it', () => {
    // Mid-S, LT goes to the top of S. It's a scrub bar, not a catapult.
    expect(stepLetter(list, 4, -1)).toBe(3)
    // Already at the top of S — now it moves a letter.
    expect(stepLetter(list, 3, -1)).toBe(2)
  })

  it('pins at the ends instead of wrapping', () => {
    // Wrapping from Z back to A after a press you didn't quite mean is disorienting
    // in a way a hard stop never is.
    expect(stepLetter(list, 0, -1)).toBe(0)
    expect(stepLetter(list, 4, 1)).toBe(4)
  })

  it('has nothing to do with an empty list', () => {
    expect(stepLetter([], 0, 1)).toBe(0)
  })

  it('treats a NUMERIC title as the letter before A, because that is where it sits', () => {
    // The bug this replaces: `letterOf` files "3D Pocket Pool" under '#', which sorts
    // FIRST in the list but LAST in the alphabet. Reading the order from ALPHABET
    // walked straight off the end and dumped you on the last game in the library —
    // from row 0 of the biggest system, which is the row focus lands on by default.
    const withNumbers = [
      g('n1', '3D Pocket Pool', 'Game Boy Color'),
      g('n2', '4-in-1 Funpak', 'Game Boy Color'),
      ...list,
    ]
    expect(stepLetter(withNumbers, 0, 1)).toBe(2) // → the first A, NOT the last game
    expect(stepLetter(withNumbers, 2, -1)).toBe(0) // → back to the first number
    expect(stepLetter(withNumbers, 0, -1)).toBe(0) // → nowhere to go; stay put
  })
})

describe('agoLabel', () => {
  const now = Date.parse('2026-07-14T12:00:00Z')
  const ago = (ms) => agoLabel(now - ms, now)

  it('is coarse on purpose — how cold is the save, not what time it was', () => {
    expect(ago(30_000)).toBe('Just now')
    expect(ago(20 * 60_000)).toBe('20 min ago')
    expect(ago(3 * 3_600_000)).toBe('3 hours ago')
    expect(ago(26 * 3_600_000)).toBe('Yesterday')
    expect(ago(4 * 86_400_000)).toBe('4 days ago')
    expect(ago(9 * 86_400_000)).toBe('Last week')
    expect(ago(70 * 86_400_000)).toBe('2 months ago')
  })

  it('says nothing when it has nothing to say', () => {
    expect(agoLabel(undefined)).toBe('')
  })
})
