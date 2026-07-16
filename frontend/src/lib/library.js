// Pure helpers for the Library (owned-content hub). The pages just render.
import { API_BASE } from './useApi.js'
import { Gamepad2, BookOpen, BookImage, Newspaper, Headphones, GraduationCap, Library as LibraryIcon } from 'lucide-react'

// The Lucide icon component for a library section, keyed by its `key`
// (monochrome, themeable — replaces the old per-section emoji). Falls back to
// the generic Library glyph. Used by the hub section cards.
const SECTION_ICONS = {
  games: Gamepad2,
  books: BookOpen,
  textbooks: GraduationCap,
  comics: BookImage,
  papers: Newspaper,
  audiobooks: Headphones,
}
export function sectionIcon(id) {
  return SECTION_ICONS[id] || LibraryIcon
}

// A constant-palette accent per section, so a section reads with its own colour
// across the hub (the peek-tile icon + the spotlight radiance). Constant RGB
// (not a theme token) so the colours survive a theme swap, same rule the
// back-lit radiance motif follows. `rgb` feeds the glow/backdrop helpers; `text`
// tints the Lucide icon.
const SECTION_ACCENTS = {
  games: { rgb: '139,92,246', text: 'text-violet-300' },
  books: { rgb: '56,189,248', text: 'text-sky-300' },
  textbooks: { rgb: '99,102,241', text: 'text-indigo-300' },
  comics: { rgb: '245,158,11', text: 'text-amber-300' },
  papers: { rgb: '16,185,129', text: 'text-emerald-300' },
  audiobooks: { rgb: '244,63,94', text: 'text-rose-300' },
}
const _DEFAULT_ACCENT = { rgb: '148,163,184', text: 'text-slate-300' }
export function sectionAccent(key) {
  return SECTION_ACCENTS[key] || _DEFAULT_ACCENT
}

// Which section a "continue" (resume) item belongs to, so the spotlight can take
// that section's accent. Games resume via the play kind (no section field);
// audiobooks via listen; everything else carries its reading section.
export function continueAccentKey(item) {
  if (!item) return null
  if (item.kind === 'play') return 'games'
  if (item.kind === 'listen') return 'audiobooks'
  return item.section || null
}

// Where the EmulatorJS engine + cores load from. Default: self-hosted at
// /emulatorjs/ (populate with scripts/fetch-emulatorjs.sh — a pinned, gitignored
// bundle, so nothing third-party is committed and play time makes no external
// calls). To use the official pinned CDN instead, set this to
// 'https://cdn.emulatorjs.org/4.2.3/data/'. emulator.html allowlists both forms.
export const EMULATORJS_DATA = '/emulatorjs/'

// URL the backend streams an item's bytes from. Range-capable, so a reader or
// emulator can fetch only the bytes it needs (matters for big PDFs later).
export function fileUrl(section, id) {
  return `${API_BASE}/library/file?section=${encodeURIComponent(section)}&id=${encodeURIComponent(id)}`
}

// Proxied + cached box art for a game (404 → caller shows a placeholder).
export function coverUrl(id) {
  return `${API_BASE}/library/games/cover?id=${encodeURIComponent(id)}`
}

// A book's cover art, extracted from the file + cached as WebP (404 → caller
// shows a titled placeholder, same as game box art).
export function bookCoverUrl(id) {
  return `${API_BASE}/library/books/cover?id=${encodeURIComponent(id)}`
}

// A textbook's cover — same extraction/cache as book covers, its own endpoint +
// cache dir (404 → caller shows a titled placeholder).
export function textbookCoverUrl(id) {
  return `${API_BASE}/library/textbooks/cover?id=${encodeURIComponent(id)}`
}

// Comics: page count, one downscaled page, and the cover (page 0, smaller). Each
// page is extracted from the CBZ/CBR/CB7 archive + cached as a WebP server-side.
export function comicInfoUrl(id) {
  return `${API_BASE}/library/comics/info?id=${encodeURIComponent(id)}`
}
export function comicPageUrl(id, n) {
  return `${API_BASE}/library/comics/page?id=${encodeURIComponent(id)}&n=${n}`
}
export function comicCoverUrl(id) {
  return `${API_BASE}/library/comics/cover?id=${encodeURIComponent(id)}`
}

// An audiobook's cover (a folder image or the first chapter's embedded art),
// cached as WebP. 404 → caller shows a 🎧 placeholder.
export function audiobookCoverUrl(path) {
  return `${API_BASE}/library/audiobooks/cover?path=${encodeURIComponent(path)}`
}

// A magazine/paper's cover = its first page, rendered + cached as WebP server-
// side (404 → caller shows a titled placeholder, same as the other covers).
export function paperCoverUrl(id) {
  return `${API_BASE}/library/papers/cover?id=${encodeURIComponent(id)}`
}

// Browse a comic library as a folder tree (it mirrors the filesystem, at any
// nesting depth). Given all items (ids are POSIX-style paths) and the current
// folder `path` ('' = root), return the immediate child folders (with a count of
// everything beneath them) + the issues that live directly in this folder. This
// keeps any one screen small even for a huge library — you drill in folder by
// folder instead of rendering thousands of covers at once.
// → { folders: [{ name, path, count }] (alphabetical), issues: items[] }
export function browseFolder(items, path = '') {
  const prefix = path ? path + '/' : ''
  const folderCounts = {}
  const issues = []
  for (const it of items ?? []) {
    if (prefix && !it.id.startsWith(prefix)) continue
    const rest = it.id.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash === -1) issues.push(it)
    else {
      const name = rest.slice(0, slash)
      folderCounts[name] = (folderCounts[name] || 0) + 1
    }
  }
  const folders = Object.keys(folderCounts)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, path: prefix + name, count: folderCounts[name] }))
  return { folders, issues }
}

// Filter a section's items by a free-text query over their title/path (client-
// side — the item list is just names, so no backend index is needed). Used by
// the folder-browser sections (comics, papers). Empty query → [].
export function searchItems(items, query) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  return (items ?? []).filter(
    (it) => (it.name || '').toLowerCase().includes(q) || it.id.toLowerCase().includes(q)
  )
}

// The breadcrumb trail for a folder path → [{ name, path }] from root to here.
export function folderCrumbs(path) {
  if (!path) return []
  const parts = path.split('/')
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
}

// Display a pinned folder path → { name (the folder), parent (the trail above
// it) } so a deep pin like "Star Wars/04. Rebellion era" reads with context.
export function pinLabel(path) {
  const parts = (path || '').split('/')
  return { name: parts[parts.length - 1] || path, parent: parts.slice(0, -1).join(' / ') }
}

// Endpoint for a section's pinned folders (GET). POST/DELETE hit /library/pins.
export function pinsUrl(section) {
  return `${API_BASE}/library/pins?section=${encodeURIComponent(section)}`
}

// Server-side save states for a game (roam across devices).
export function saveStatesUrl(id) {
  return `${API_BASE}/library/games/save-states?id=${encodeURIComponent(id)}`
}
// The state blob — what EJS_loadStateURL fetches to resume into a state.
export function saveStateUrl(id, slot) {
  return `${API_BASE}/library/games/save-state?id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`
}
// A save state's screenshot (detail-page thumbnail).
export function saveStateShotUrl(id, slot) {
  return `${API_BASE}/library/games/save-state/screenshot?id=${encodeURIComponent(id)}&slot=${encodeURIComponent(slot)}`
}

// A game's in-game battery save (SRAM) — the game's OWN save (e.g. Pokemon's
// "Save"), one per game, stored server-side so it roams. GET serves it, POST
// (multipart) overwrites it. The emulator captures + restores it.
export function gameSramUrl(id) {
  return `${API_BASE}/library/games/sram?id=${encodeURIComponent(id)}`
}

// The isolated player page (public/emulator.html) for a game item. Running
// EmulatorJS inside an iframe keeps its window globals + teardown out of the SPA.
export function playerSrc(item, data = EMULATORJS_DATA) {
  const q = new URLSearchParams({
    core: item.core,
    rom: fileUrl('games', item.id),
    data,
  })
  q.set('gid', item.id) // game id, so the emulator can upload save states for it
  if (item.name) q.set('name', item.name) // EJS_gameName — avoids an "undefined" title
  if (item.loadStateUrl) q.set('loadstate', item.loadStateUrl) // resume into a saved state
  return `/emulator.html?${q.toString()}`
}

// Where a "Jump back in" entry resumes to. A play entry opens the emulator into
// its newest save state; a listen entry opens the audiobook player at the book
// (which resumes its saved chapter+position itself); a reading entry opens the
// reader (which resumes its saved position; `reader` picks PDF vs ebook engine).
export function resumeHref(entry) {
  if (entry.kind === 'play') {
    // Open the game and let its in-game save (SRAM) resume via "Continue" — do
    // NOT auto-load a save state, which would snapshot-restore the whole machine
    // (incl. an older SRAM) on top of your latest in-game save.
    // `label` is the system ("Game Boy Color"), carried so the player can dress itself
    // in that machine's colours — a core can't tell us, since GBC games run on `gba`.
    const q = new URLSearchParams({
      id: entry.id,
      core: entry.core || '',
      name: entry.name || '',
      label: entry.label || '',
    })
    return `/library/play?${q.toString()}`
  }
  if (entry.kind === 'listen') {
    return `/library/audiobooks?path=${encodeURIComponent(entry.id)}`
  }
  const q = new URLSearchParams({ section: entry.section, id: entry.id })
  if (entry.reader) q.set('reader', entry.reader)
  return `/library/read?${q.toString()}`
}

// Natural string compare so chapter files order 1,2,…,10 (not 1,10,2) and are
// case-insensitive — used to sequence an audiobook's chapter files.
export function naturalCompare(a, b) {
  return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' })
}

// The Library sub-sections worth showing in the in-area section nav: configured
// and non-empty (an unconfigured or empty section has no list page to land on).
export function libraryNavSections(data) {
  return (data?.sections ?? []).filter((s) => s.configured && s.count > 0)
}

// Seconds → h:mm:ss / m:ss for the audio player.
export function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  s = Math.floor(s)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// The reader route for a section item (used by the browse lists). Carries the
// item's reader hint so the /library/read dispatcher picks the right engine.
export function readerHref(section, item) {
  const q = new URLSearchParams({ section, id: item.id })
  if (item.reader) q.set('reader', item.reader)
  return `/library/read?${q.toString()}`
}

// Where a downloaded manifest entry opens. Audiobooks → the ?path= player;
// games → the emulator player (needs the stored core + name); everything else
// → the /library/read reader. Used by the Downloads page / offline lists.
export function downloadHref(entry) {
  if (entry.section === 'audiobooks') {
    return `/library/audiobooks?path=${encodeURIComponent(entry.id)}`
  }
  if (entry.section === 'games') {
    // Boot + in-game "Continue" (SRAM) resumes — not an auto-loaded save state.
    const q = new URLSearchParams({ id: entry.id, core: entry.core || '', name: entry.name || '' })
    return `/library/play?${q.toString()}`
  }
  return readerHref(entry.section, { id: entry.id, reader: entry.reader })
}

// --- offline emulator (ROMs) -----------------------------------------------
// The shared EmulatorJS engine assets a game needs (cached once, not per-game).
// Captured live from a real game load. The host page (emulator.html) is matched
// by bare path in the SW since it's requested with per-game query params.
export const EMULATOR_ENGINE_URLS = [
  '/emulator.html',
  `${EMULATORJS_DATA}loader.js`,
  `${EMULATORJS_DATA}emulator.min.js`,
  `${EMULATORJS_DATA}emulator.min.css`,
  `${EMULATORJS_DATA}localization/en-US.json`,
  `${EMULATORJS_DATA}compression/extract7z.js`,
]

// EmulatorJS maps our system core name to the libretro core file it loads by
// DEFAULT (the first entry in its per-system core table, src/emulator.js) — so
// the offline cache fetches the same .data the online loader does. Note segaMS
// defaults to smsplus (not genesis_plus_gx, which Genesis/Game Gear use).
const LIBRETRO_CORE = {
  gb: 'gambatte',
  gbc: 'mgba',
  gba: 'mgba',
  nes: 'fceumm',
  snes: 'snes9x',
  segaMD: 'genesis_plus_gx',
  segaMS: 'smsplus',
  segaGG: 'genesis_plus_gx',
}

// The per-game offline URLs: the ROM + its core (both non-thread variants, since
// iOS may pick either) + the core's report. The shared engine is separate.
export function gameOfflineUrls(id, core) {
  const lib = LIBRETRO_CORE[core] || core
  return [
    fileUrl('games', id),
    `${EMULATORJS_DATA}cores/${lib}-wasm.data`,
    `${EMULATORJS_DATA}cores/${lib}-legacy-wasm.data`,
    `${EMULATORJS_DATA}cores/reports/${lib}.json`,
  ]
}

// --- Games: per-system drill-in ---------------------------------------------
// Frog browses one system at a time (Game Boy alone has hundreds of titles). These
// pure helpers shape the data behind that; the components just draw it.

// The letter buckets, in display order: A–Z then '#' (numeric/other titles) last.
// Frog's game-list letter rail (GameList.jsx) reads it.
export const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

// One system's games, alphabetised by title (natural compare so "Pokemon 2"
// orders before "Pokemon 10"). → items[]
export function systemGames(items, label) {
  return (items ?? [])
    .filter((it) => (it.label || 'Other') === label)
    .sort((a, b) => naturalCompare(a.name, b.name))
}

// Frog — the full-screen, controller-driven games browser. It lives at the root
// rather than under /library because it isn't a library page: it's a separate app
// that the library hands off to, and it will one day be served from its own repo.
export function frogHref() {
  return '/frog'
}

// Where the Library's section entries point. Games IS Frog now — its nav pill and hub
// card open the full-screen browser directly (Frog handles touch, controller AND
// offline, so it fully replaces the old /library/games grid, which now just redirects
// here). Every other section stays an ordinary /library/<key> page.
export function sectionHref(key) {
  return key === 'games' ? frogHref() : `/library/${key}`
}


// The scrubber bucket for a title: its uppercase first A–Z letter, else '#'
// (numbers, symbols, non-latin, empty). Diacritics are stripped first (NFD
// decomposes 'É' → 'E' + combining mark) so an accented title buckets under its
// base letter — matching how systemGames natural-sorts it (sensitivity 'base').
// → 'A'..'Z' | '#'
export function letterOf(name) {
  const c = (name || '').trim().normalize('NFD').charAt(0).toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

// Subtitle line for a Books search result — the author, or a clear fallback
// when a book had no embedded author (so the row never looks blank/broken).
export function bookSubtitle(item) {
  return item?.author ? item.author : 'Unknown author'
}

// One-line summary for the hub header.
export function libraryHeadline(data) {
  const ready = (data?.sections ?? []).filter((s) => s.configured)
  if (ready.length === 0) return 'No content configured yet'
  const total = ready.reduce((n, s) => n + (s.count || 0), 0)
  const secWord = ready.length === 1 ? 'section' : 'sections'
  return `${total} item${total === 1 ? '' : 's'} across ${ready.length} ${secWord}`
}
