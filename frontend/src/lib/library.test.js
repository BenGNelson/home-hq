import { describe, it, expect } from 'vitest'
import {
  fileUrl,
  coverUrl,
  saveStatesUrl,
  saveStateUrl,
  saveStateShotUrl,
  playerSrc,
  groupByLabel,
  libraryHeadline,
} from './library.js'

describe('fileUrl', () => {
  it('encodes section + id as query params', () => {
    expect(fileUrl('games', 'sub/My Game.gb')).toBe(
      '/api/library/file?section=games&id=sub%2FMy%20Game.gb'
    )
  })
})

describe('coverUrl', () => {
  it('points at the cover proxy with the encoded id', () => {
    expect(coverUrl('Metroid Fusion (USA).gba')).toBe(
      '/api/library/games/cover?id=Metroid%20Fusion%20(USA).gba'
    )
  })
})

describe('playerSrc', () => {
  it('points at emulator.html with core, rom, data, and name', () => {
    const src = playerSrc({ id: 'Tetris.gb', core: 'gb', name: 'Tetris' })
    expect(src.startsWith('/emulator.html?')).toBe(true)
    const q = new URLSearchParams(src.split('?')[1])
    expect(q.get('core')).toBe('gb')
    expect(q.get('rom')).toBe('/api/library/file?section=games&id=Tetris.gb')
    expect(q.get('data')).toBe('/emulatorjs/')
    expect(q.get('name')).toBe('Tetris')
  })
  it('omits name when absent but always carries the game id (gid)', () => {
    const q = new URLSearchParams(playerSrc({ id: 'Tetris.gb', core: 'gb' }).split('?')[1])
    expect(q.has('name')).toBe(false)
    expect(q.get('gid')).toBe('Tetris.gb')
    expect(q.has('loadstate')).toBe(false)
  })
  it('passes a resume-state URL through as loadstate', () => {
    const q = new URLSearchParams(
      playerSrc({ id: 'Tetris.gb', core: 'gb', loadStateUrl: '/api/library/games/save-state?id=Tetris.gb&slot=42' }).split('?')[1]
    )
    expect(q.get('loadstate')).toBe('/api/library/games/save-state?id=Tetris.gb&slot=42')
  })
})

describe('save-state urls', () => {
  it('build list / blob / screenshot urls', () => {
    expect(saveStatesUrl('A B.gba')).toBe('/api/library/games/save-states?id=A%20B.gba')
    expect(saveStateUrl('A B.gba', '99')).toBe('/api/library/games/save-state?id=A%20B.gba&slot=99')
    expect(saveStateShotUrl('A B.gba', '99')).toBe(
      '/api/library/games/save-state/screenshot?id=A%20B.gba&slot=99'
    )
  })
})

describe('groupByLabel', () => {
  it('groups by label and sorts the groups', () => {
    const items = [
      { id: 'a', label: 'Game Boy Color' },
      { id: 'b', label: 'Game Boy' },
      { id: 'c', label: 'Game Boy' },
    ]
    const groups = groupByLabel(items)
    expect(groups.map(([label]) => label)).toEqual(['Game Boy', 'Game Boy Color'])
    expect(groups[0][1].map((i) => i.id)).toEqual(['b', 'c'])
  })
  it('handles empty/undefined', () => {
    expect(groupByLabel(undefined)).toEqual([])
  })
})

describe('libraryHeadline', () => {
  it('totals items across configured sections', () => {
    const data = {
      sections: [
        { configured: true, count: 3 },
        { configured: false, count: 0 },
      ],
    }
    expect(libraryHeadline(data)).toBe('3 items across 1 section')
  })
  it('messages when nothing is configured', () => {
    expect(libraryHeadline({ sections: [{ configured: false }] })).toMatch(/no content/i)
  })
})
