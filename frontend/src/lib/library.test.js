import { describe, it, expect } from 'vitest'
import {
  fileUrl,
  coverUrl,
  saveStatesUrl,
  saveStateUrl,
  saveStateShotUrl,
  playerSrc,
  resumeHref,
  readerHref,
  groupByLabel,
  browseFolder,
  searchItems,
  folderCrumbs,
  pinLabel,
  naturalCompare,
  formatTime,
  comicPageUrl,
  comicCoverUrl,
  paperCoverUrl,
  sectionAccent,
  continueAccentKey,
  libraryHeadline,
  bookSubtitle,
  libraryNavSections,
  gameOfflineUrls,
} from './library.js'

describe('bookSubtitle', () => {
  it('shows the author when present', () => {
    expect(bookSubtitle({ author: 'Stephen King' })).toBe('Stephen King')
  })
  it('falls back when there is no author', () => {
    expect(bookSubtitle({ author: null })).toBe('Unknown author')
    expect(bookSubtitle({})).toBe('Unknown author')
    expect(bookSubtitle(undefined)).toBe('Unknown author')
  })
})

describe('resumeHref', () => {
  it('routes a reading entry to the reader', () => {
    expect(resumeHref({ kind: 'read', section: 'papers', id: 'a.pdf' })).toBe(
      '/library/read?section=papers&id=a.pdf'
    )
  })
  it('carries the reader hint for an ebook reading entry', () => {
    expect(resumeHref({ kind: 'read', section: 'books', id: 'Dune.epub', reader: 'epub' })).toBe(
      '/library/read?section=books&id=Dune.epub&reader=epub'
    )
  })
  it('routes a play entry to the player (no save slot — resume is the in-game Continue/SRAM)', () => {
    expect(
      resumeHref({ kind: 'play', id: 'Tetris.gb', core: 'gb', name: 'Tetris', slot: '123' })
    ).toBe('/library/play?id=Tetris.gb&core=gb&name=Tetris')
  })
  it('routes a listen entry to the audiobook player at the book path', () => {
    expect(resumeHref({ kind: 'listen', id: 'Orwell/Animal Farm' })).toBe(
      '/library/audiobooks?path=Orwell%2FAnimal%20Farm'
    )
  })
})

describe('naturalCompare', () => {
  it('orders embedded numbers numerically', () => {
    expect(['ch10', 'ch2', 'ch1'].sort(naturalCompare)).toEqual(['ch1', 'ch2', 'ch10'])
  })
})

describe('formatTime', () => {
  it('formats seconds as m:ss / h:mm:ss', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(3725)).toBe('1:02:05')
    expect(formatTime(NaN)).toBe('0:00')
  })
})

describe('readerHref', () => {
  it('builds a reader route with the item reader hint', () => {
    expect(readerHref('books', { id: 'sub/Dune.epub', reader: 'epub' })).toBe(
      '/library/read?section=books&id=sub%2FDune.epub&reader=epub'
    )
  })
  it('omits the reader param when the item has none', () => {
    expect(readerHref('papers', { id: 'a.pdf' })).toBe('/library/read?section=papers&id=a.pdf')
  })
})

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

describe('paperCoverUrl', () => {
  it('points at the papers cover endpoint with the encoded id', () => {
    expect(paperCoverUrl('Science News - March 25, 2023.pdf')).toBe(
      '/api/library/papers/cover?id=Science%20News%20-%20March%2025%2C%202023.pdf'
    )
  })
})

describe('sectionAccent', () => {
  it('gives each known section a constant-palette accent', () => {
    expect(sectionAccent('games').text).toBe('text-violet-300')
    expect(sectionAccent('audiobooks').rgb).toBe('244,63,94')
  })
  it('falls back to a neutral accent for an unknown section', () => {
    expect(sectionAccent('nope').text).toBe('text-slate-300')
  })
})

describe('continueAccentKey', () => {
  it('maps a resume item to its section for the spotlight accent', () => {
    expect(continueAccentKey({ kind: 'play' })).toBe('games')
    expect(continueAccentKey({ kind: 'listen' })).toBe('audiobooks')
    expect(continueAccentKey({ kind: 'read', section: 'comics' })).toBe('comics')
    expect(continueAccentKey(null)).toBe(null)
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

describe('gameOfflineUrls', () => {
  // The offline cache must fetch the SAME libretro core file the online loader
  // picks by default for each EmulatorJS system (src/emulator.js's core table).
  const coreFile = (core) => {
    const u = gameOfflineUrls('X', core).find((url) => url.includes('/cores/') && url.endsWith('-wasm.data'))
    return u.split('/cores/')[1].replace('-wasm.data', '')
  }
  it('maps each system to its default libretro core', () => {
    expect(coreFile('gb')).toBe('gambatte')
    expect(coreFile('gba')).toBe('mgba')
    expect(coreFile('nes')).toBe('fceumm')
    expect(coreFile('snes')).toBe('snes9x')
    expect(coreFile('segaMD')).toBe('genesis_plus_gx')
    expect(coreFile('segaGG')).toBe('genesis_plus_gx')
    // Master System defaults to smsplus, NOT genesis_plus_gx
    expect(coreFile('segaMS')).toBe('smsplus')
  })
  it('includes the ROM, both wasm variants, and the core report', () => {
    const urls = gameOfflineUrls('Sonic.md', 'segaMD')
    expect(urls.some((u) => u.includes('library/file') && u.includes('Sonic.md'))).toBe(true)
    expect(urls).toContain('/emulatorjs/cores/genesis_plus_gx-wasm.data')
    expect(urls).toContain('/emulatorjs/cores/genesis_plus_gx-legacy-wasm.data')
    expect(urls).toContain('/emulatorjs/cores/reports/genesis_plus_gx.json')
  })
})

describe('browseFolder', () => {
  const items = [
    { id: 'One-Punch Man.cbz', name: 'One-Punch Man' }, // root issue
    { id: 'Star Wars/Doctor Aphra/01.cbr', name: '01' },
    { id: 'Star Wars/Doctor Aphra/02.cbr', name: '02' },
    { id: 'Star Wars/Darth Vader/01.cbr', name: '01' },
    { id: 'Batman/Year One.cbr', name: 'Year One' },
  ]
  it('lists immediate folders (with deep counts) + issues at the root', () => {
    const { folders, issues } = browseFolder(items, '')
    expect(folders.map((f) => [f.name, f.count])).toEqual([
      ['Batman', 1],
      ['Star Wars', 3],
    ])
    expect(issues.map((i) => i.id)).toEqual(['One-Punch Man.cbz'])
  })
  it('drills into a subfolder', () => {
    const { folders, issues } = browseFolder(items, 'Star Wars')
    expect(folders.map((f) => [f.name, f.path, f.count])).toEqual([
      ['Darth Vader', 'Star Wars/Darth Vader', 1],
      ['Doctor Aphra', 'Star Wars/Doctor Aphra', 2],
    ])
    expect(issues).toEqual([])
  })
  it('lists issues in a leaf folder', () => {
    const { folders, issues } = browseFolder(items, 'Star Wars/Doctor Aphra')
    expect(folders).toEqual([])
    expect(issues.map((i) => i.id)).toEqual([
      'Star Wars/Doctor Aphra/01.cbr',
      'Star Wars/Doctor Aphra/02.cbr',
    ])
  })
  it('handles empty/undefined', () => {
    expect(browseFolder(undefined, '')).toEqual({ folders: [], issues: [] })
  })
})

describe('searchItems', () => {
  const items = [
    { id: 'Star Wars/Darth Vader/01.cbr', name: 'Darth Vader 01' },
    { id: 'Batman/Year One.cbr', name: 'Year One' },
  ]
  it('matches name or path, case-insensitive', () => {
    expect(searchItems(items, 'vader').map((i) => i.name)).toEqual(['Darth Vader 01'])
    expect(searchItems(items, 'batman').map((i) => i.name)).toEqual(['Year One']) // path match
  })
  it('empty query → no results', () => {
    expect(searchItems(items, '   ')).toEqual([])
  })
})

describe('folderCrumbs', () => {
  it('builds a cumulative trail', () => {
    expect(folderCrumbs('Star Wars/Doctor Aphra')).toEqual([
      { name: 'Star Wars', path: 'Star Wars' },
      { name: 'Doctor Aphra', path: 'Star Wars/Doctor Aphra' },
    ])
    expect(folderCrumbs('')).toEqual([])
  })
})

describe('pinLabel', () => {
  it('splits a pinned path into leaf name + parent trail', () => {
    expect(pinLabel('Star Wars/04. Rebellion era')).toEqual({
      name: '04. Rebellion era',
      parent: 'Star Wars',
    })
    expect(pinLabel('Saga')).toEqual({ name: 'Saga', parent: '' })
    expect(pinLabel('A/B/C')).toEqual({ name: 'C', parent: 'A / B' })
  })
})

describe('comic urls', () => {
  it('encode the id and page index', () => {
    expect(comicCoverUrl('Star Wars/X.cbr')).toContain('id=Star%20Wars%2FX.cbr')
    expect(comicPageUrl('a b.cbz', 4)).toContain('id=a%20b.cbz&n=4')
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

describe('libraryNavSections', () => {
  const sections = [
    { key: 'games', configured: true, count: 7 },
    { key: 'books', configured: true, count: 0 }, // empty -> excluded
    { key: 'comics', configured: false, count: 0 }, // not set up -> excluded
    { key: 'papers', configured: true, count: 3 },
  ]

  it('keeps only configured, non-empty sections', () => {
    expect(libraryNavSections({ sections }).map((s) => s.key)).toEqual(['games', 'papers'])
  })

  it('is empty for missing or sectionless data', () => {
    expect(libraryNavSections(null)).toEqual([])
    expect(libraryNavSections({})).toEqual([])
  })
})
