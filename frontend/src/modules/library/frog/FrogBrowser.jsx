import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Search as SearchIcon, Plane } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { useOnline } from '../../../lib/online.jsx'
import { useDownloadedEntries } from '../../../lib/useDownloaded.js'
import { useDownload } from '../../../lib/useDownload.js'
import {
  systemGames, gameOfflineUrls, saveStatesUrl, gameMetaUrl, gameCandidatesUrl, postGameMatch,
} from '../../../lib/library.js'
import { isFavorite, toggleFavorite } from '../../../lib/favorites.js'
import { ensureEmulatorEngine, cacheGameSram } from '../../../lib/offlineStore.js'
import { offlineGamesToItems } from './offline.js'
import { getRecent, recordPlayed } from '../../../lib/recentGames.js'
import { getFavorites } from '../../../lib/favorites.js'
import { moveInRails } from '../../../lib/gridNav.js'
import { useGamepad } from '../../../lib/useGamepad.js'
import { mediaMatches } from '../../../lib/useMediaQuery.js'
import { SkeletonLine } from '../../../components/ui.jsx'
import ButtonLegend from '../player/ButtonLegend.jsx'
import { defaultFrogMode, nextFrogMode, usesNativeKeyboard } from './input.js'
import { FROG, systemStyle } from './theme.js'
import { buildShelf, stepLetter } from './shelf.js'
import { searchGames, matches, KEYS, gridMove } from './search.js'
import { FrogMark } from './Frog.jsx'
import Boot from './Boot.jsx'
import Shelf from './Shelf.jsx'
import Search from './Search.jsx'
import GameScreen from './GameScreen.jsx'
import GameList, { GameListHeader } from './GameList.jsx'
import './frog.css'

// FROG — the games browser.
//
// One screen at a time, one thing in focus, everything reachable from a D-pad
// without ever touching the glass. It's a front-end for a couch and a controller,
// which is a genuinely different product from the Games pages in Home HQ (built for
// a thumb, on a phone, standing up) — so it is a different app, not a wider layout.
//
// It owns the navigation for the whole browser; the screens under it are drawn from
// props and hold no state of their own. That's what lets the controller, the arrow
// keys and a mouse all drive the same code with none of them a special case, and
// it's what will make lifting this folder into its own repo a copy rather than a
// rewrite.
// The actions that move the shelf. 'search' is handled before we ever get here (it
// opens a whole screen); everything else — the triggers, a stray button — is inert,
// and inert must mean inert, not "quietly re-render into an identical focus object".
const MOVES = new Set(['up', 'down', 'left', 'right', 'railPrev', 'railNext'])

// Frog's place, held for the life of the tab rather than the life of the component.
//
// This has to live outside React. FrogBrowser UNMOUNTS every time you launch a game
// (the player is a different route), so with `useState` alone, quitting a game would
// replay the whole boot animation, ask you to PRESS A again, and dump you back on
// rail zero — having forgotten which system you were three hundred games into. The
// boot is once per app open; your place survives a session.
const place = { booted: false, screen: 'shelf', system: null, focus: { rail: 0, index: 0 }, row: 0 }

export default function FrogBrowser() {
  const navigate = useNavigate()
  const { online } = useOnline()

  // Re-fetch the library once the server becomes reachable again, so a Frog opened in
  // airplane mode fills in the full library on its own when the network returns —
  // WITHOUT polling, which would churn a steady online session's data every interval
  // (each poll a fresh array ref, yanking the game list's scroll back to focus). The
  // nonce, ignored by the API, re-runs the one-shot fetch on the offline→online edge
  // and only there.
  const [reloadNonce, setReloadNonce] = useState(0)
  const wasOnline = useRef(online)
  useEffect(() => {
    if (online && !wasOnline.current) setReloadNonce((n) => n + 1)
    wasOnline.current = online
  }, [online])
  const { data, loading } = useApi(`/library/games${reloadNonce ? `?r=${reloadNonce}` : ''}`, 0)
  const apiItems = data?.items ?? []

  // The fallback when the API gives us nothing: the games you've DOWNLOADED (the
  // on-device manifest, via the shared hook the rest of the Library uses). `null`
  // until the read resolves, so we can tell "still reading" from "nothing downloaded".
  const entries = useDownloadedEntries()
  const offlineItems = useMemo(() => (entries === null ? null : offlineGamesToItems(entries)), [entries])

  // The live library wins WHENEVER it has answered — the item source is NOT gated on
  // the health probe, so a flaky /health check can never hide a reachable library
  // behind the downloaded-only view. Only when the API has handed us nothing do we
  // fall back to the downloaded games.
  const items = apiItems.length ? apiItems : offlineItems ?? []
  // Skeleton only while we truly have nothing to show and a source might still land.
  // Keyed on `items` (not the API alone) so a reconnect refetch keeps the offline
  // shelf up rather than flashing a skeleton over it.
  const booting = !items.length && (loading || offlineItems === null)
  // The chip means "you're seeing downloaded games only because the server is
  // unreachable" — precisely when the probe says offline AND the API gave us nothing.
  const offline = !online && !apiItems.length

  // 'boot' → 'shelf' ⇄ 'games'.
  const [screen, setScreen] = useState(place.booted ? place.screen : 'boot')
  const [system, setSystem] = useState(place.system)

  const [focus, setFocus] = useState(place.focus)
  const [memory, setMemory] = useState({})
  const [row, setRow] = useState(place.row) // focus within a system's game list

  // Search is transient — a fresh keyboard every time you open it, never restored.
  // `query` is the string you're building; `zone` is which half of the screen has the
  // cursor (the keyboard grid or the results); `from` is where to land when you close.
  const [query, setQuery] = useState('')
  const [zone, setZone] = useState('grid')
  const [keyIndex, setKeyIndex] = useState(0)
  const [resultRow, setResultRow] = useState(0)
  const [searchFrom, setSearchFrom] = useState('shelf')

  // Touch vs pad. Opens from the pointer kind (a phone starts in touch), then every
  // real input keeps it honest — a gamepad button flips to pad, a finger back to
  // touch. It decides the two places a finger and a D-pad disagree: the search
  // keyboard (native vs the 6×6 grid) and whether the controller legend even shows.
  const [mode, setMode] = useState(() => defaultFrogMode(mediaMatches('(pointer: coarse)')))
  const native = usesNativeKeyboard(mode)

  // Which keyboard the OPEN search screen uses, snapshotted when it opens rather than
  // read live. If it tracked `mode`, tapping a 6×6 grid key with a finger (which flips
  // mode to touch on pointerdown) would unmount the grid before the tap's click landed
  // — the key would be lost. Frozen per session, the grid stays put; the tap types.
  const [searchNative, setSearchNative] = useState(false)

  // The game page ('detail' screen). `detailGame` is the game being viewed, `detailFrom`
  // the screen to return to. Its focus is two zones — the actions row and the save list
  // — mirroring search's grid⇄results. `confirm` guards a destructive action (delete a
  // save / remove a download) behind one deliberate step.
  const [detailGame, setDetailGame] = useState(null)
  const [detailFrom, setDetailFrom] = useState('shelf')
  const [detailFocus, setDetailFocus] = useState({ zone: 'actions', index: 0 })
  const [confirm, setConfirm] = useState(null)
  const [favorited, setFavorited] = useState(false)
  const [saves, setSaves] = useState([])
  const [savesLoading, setSavesLoading] = useState(false)
  const [savesRefresh, setSavesRefresh] = useState(0)
  // The open game's rich IGDB metadata (screenshots/summary/genres/rating). `null`
  // until it lands / when the game isn't matched or IGDB isn't configured — in which
  // case GameScreen renders its basic layout (a ROM hack looks exactly like today).
  const [meta, setMeta] = useState(null)
  // A screenshot opened fullscreen: its index into meta.screenshot_ids, or null.
  const [lightbox, setLightbox] = useState(null)
  // The game hero's active background screenshot — it slowly crossfades on its own
  // (and the D-pad can peek). Owned here so the auto-advance pauses while the lightbox
  // is open and resets when you open a different game.
  const [heroSlide, setHeroSlide] = useState(0)
  // The "Wrong game?" picker: null, or { candidates, current, matched, index }. Bumping
  // metaRefresh re-fetches the open game's meta after a manual re-match/clear.
  const [rematch, setRematch] = useState(null)
  const [metaRefresh, setMetaRefresh] = useState(0)

  const rails = useMemo(() => buildShelf(items, getRecent(), getFavorites()), [items])
  const games = useMemo(() => (system ? systemGames(items, system) : []), [items, system])
  // Searched across EVERY system, not just the open one — from the shelf you haven't
  // picked a console yet, and "which box is Zelda in" is exactly what search is for.
  const results = useMemo(() => searchGames(items, query), [items, query])

  // The game page's offline download — same state machine (and single-writer rule) as
  // the rest of the Library, via the shared hook. Keyed on the open game; harmless when
  // none is open (empty id → idle).
  const dlItem = detailGame
    ? {
        section: 'games',
        id: detailGame.id,
        name: detailGame.name,
        core: detailGame.core,
        urls: gameOfflineUrls(detailGame.id, detailGame.core),
      }
    : { section: 'games', id: '', urls: [] }
  const dl = useDownload(dlItem, async () => {
    await ensureEmulatorEngine()
    if (detailGame) await cacheGameSram(detailGame.id) // seed the in-game save for offline resume
  })

  // The open game's save states, fetched straight (not via useApi) so it only fires when
  // a game is actually open, and re-fetches after a delete.
  const savesGameRef = useRef(null)
  useEffect(() => {
    if (!detailGame) {
      setSaves([])
      savesGameRef.current = null
      return
    }
    // Clear ONLY on a real game switch — never on a post-delete refetch (the optimistic
    // update already narrowed the list) — so one game's snapshots never flash under
    // another game's cover.
    if (savesGameRef.current !== detailGame.id) setSaves([])
    savesGameRef.current = detailGame.id
    let alive = true
    setSavesLoading(true)
    fetch(saveStatesUrl(detailGame.id))
      .then((r) => (r.ok ? r.json() : { states: [] }))
      .then((d) => alive && (setSaves(d.states ?? []), setSavesLoading(false)))
      .catch(() => alive && (setSaves([]), setSavesLoading(false)))
    return () => {
      alive = false
    }
  }, [detailGame, savesRefresh])

  // The open game's IGDB metadata, fetched when a game page opens (guarded like the
  // saves fetch so one game's data never flashes under another's cover). A failure
  // (offline, or the endpoint 404s) just leaves `meta` null → the basic page.
  const metaGameRef = useRef(null)
  useEffect(() => {
    if (!detailGame) {
      setMeta(null)
      metaGameRef.current = null
      return
    }
    if (metaGameRef.current !== detailGame.id) setMeta(null)
    metaGameRef.current = detailGame.id
    let alive = true
    fetch(gameMetaUrl(detailGame.id))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMeta(d))
      .catch(() => alive && setMeta(null))
    return () => {
      alive = false
    }
  }, [detailGame, metaRefresh])

  // The screenshots the game screen shows (only when IGDB matched this game). Drives
  // both the strip's focus range and the fullscreen lightbox.
  const shots = meta?.matched ? meta.screenshot_ids ?? [] : []
  // The vertical focus order on the game page — actions, then the screenshot strip
  // (only if there are shots), then the save list (only if there are saves). up/down
  // cross between whichever zones are present; left/right move within actions/screens.
  // Whether a "Wrong game?" / "Find on IGDB" fix control is offered (there's a
  // candidate shortlist to fix the match against).
  const canRematch = !!meta?.can_rematch
  const detailZones = useMemo(() => {
    const z = []
    if (shots.length) z.push('hero') // the banner sits above the actions
    z.push('actions')
    if (canRematch) z.push('fix') // the "Wrong game?" control, below the facts
    if (saves.length) z.push('saves')
    return z
  }, [shots.length, canRematch, saves.length])

  // Slowly crossfade the hero's background through the screenshots. Paused while the
  // lightbox is open (you're looking at one) and under reduced-motion (leave it still).
  // Local UI churn only — it never refetches, so it can't disturb scroll/data.
  useEffect(() => {
    if (screen !== 'detail' || lightbox !== null || shots.length < 2) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    const t = setInterval(() => setHeroSlide((i) => (i + 1) % shots.length), 5000)
    return () => clearInterval(t)
  }, [screen, lightbox, shots.length])

  useEffect(() => {
    if (screen === 'boot') return
    // Never persist 'search' as the screen: it's a transient overlay with no saved
    // query, so restoring it after a game launch would drop you on an empty keyboard.
    // Persist the screen it was opened over instead.
    // 'search' and 'detail' are transient overlays with no saved contents — persist the
    // screen they were opened over, so a game launch restores you there, not to an empty
    // keyboard or a stale game page. A game page opened FROM search resolves one more hop
    // (detailFrom==='search' → the screen search itself was opened over), or quitting the
    // game would strand you on a blank keyboard.
    const persistScreen =
      screen === 'search'
        ? searchFrom
        : screen === 'detail'
          ? detailFrom === 'search'
            ? searchFrom
            : detailFrom
          : screen
    Object.assign(place, { booted: true, screen: persistScreen, system, focus, row })
  })

  // Typing narrows the list under the cursor: keep the result focus in range, and if
  // the list empties out from under the results zone, hand the cursor back to the keys.
  useEffect(() => {
    setResultRow((i) => Math.min(i, Math.max(0, results.length - 1)))
    if (!results.length) setZone((z) => (z === 'results' ? 'grid' : z))
  }, [results])

  // Reconcile focus with whatever the rails just became.
  //
  // The rails are rebuilt when the library resolves, and they CHANGE SHAPE when they
  // do: "Jump back in" appears, so what was rail 0 (systems) becomes rail 1. Dismiss
  // the boot before the fetch lands, press right a few times, and focus is left
  // pointing at index 5 of a two-item rail — nothing is highlighted, the frog wears
  // no costume, the caption reads "Nothing here yet", and A does nothing at all.
  useEffect(() => {
    setFocus((f) => {
      const rail = Math.min(f.rail, Math.max(0, rails.length - 1))
      const count = rails[rail]?.items?.length ?? 0
      const index = Math.min(f.index, Math.max(0, count - 1))
      return rail === f.rail && index === f.index ? f : { rail, index }
    })
  }, [rails])

  // Same for the game list: a system with 25 games can't hold a cursor at row 300.
  useEffect(() => {
    setRow((i) => Math.min(i, Math.max(0, games.length - 1)))
  }, [games])

  const play = useCallback(
    (game, slot) => {
      if (!game) return
      recordPlayed(game)
      const q = `id=${encodeURIComponent(game.id)}&core=${encodeURIComponent(game.core)}&name=${encodeURIComponent(
        game.name || ''
      )}&label=${encodeURIComponent(game.label || '')}`
      // A `slot` launches into that snapshot; without one it's a plain boot on the
      // game's own in-game (battery) save. Play with no slot is deliberately the default
      // — restoring an older snapshot would roll the battery save back to whenever it
      // was taken, the exact way you lose an afternoon.
      navigate(`/library/play?${q}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`)
    },
    [navigate]
  )

  const openSystem = useCallback((label) => {
    setSystem(label)
    setRow(0)
    setScreen('games')
  }, [])

  const openSearch = useCallback(() => {
    // openSearch only ever fires from a non-search screen (the toggle calls closeSearch
    // otherwise), so the screen we're leaving IS where to return to.
    setSearchFrom(screen)
    setQuery('')
    setKeyIndex(0)
    setResultRow(0)
    setZone('grid')
    // Freeze the keyboard kind for this search session (see `searchNative`).
    setSearchNative(usesNativeKeyboard(mode))
    setScreen('search')
  }, [screen, mode])

  const closeSearch = useCallback(() => setScreen(searchFrom), [searchFrom])

  // The game page. Opens over whatever screen you were on (so B returns there), lands
  // focus on Play, and reads the game's current favourite state.
  const openDetail = (game, from) => {
    if (!game) return
    setDetailGame(game)
    setDetailFrom(from)
    setDetailFocus({ zone: 'actions', index: 0 })
    setConfirm(null)
    setLightbox(null)
    setRematch(null)
    setHeroSlide(0)
    // Clear the previous game's metadata SYNCHRONOUSLY here, not only in the fetch
    // effect (which runs after paint): otherwise the new game's page renders for one
    // frame with the last game's hero/summary/genres before its own meta lands.
    setMeta(null)
    metaGameRef.current = null
    setFavorited(isFavorite(game.id))
    setScreen('detail')
  }
  const closeDetail = () => {
    setConfirm(null)
    setLightbox(null)
    setRematch(null)
    setScreen(detailFrom)
  }
  const toggleFav = () => detailGame && setFavorited(toggleFavorite(detailGame).favorited)
  const startOrRemoveDownload = () => {
    // A press while it's already working (or still checking) is a no-op — otherwise a
    // controller A would kick a SECOND downloadJob for the same game (the touch button's
    // `disabled` guards only the click path, not this one).
    if (dl.state === 'downloading' || dl.state === 'checking') return
    if (dl.state === 'done') setConfirm({ kind: 'download' })
    else dl.start()
  }
  const requestDeleteSave = (slot) => setConfirm({ kind: 'save', slot })
  const deleteSave = async (slot) => {
    // Drop the row at once (optimistic): the focus-clamp effect then moves the cursor off
    // it this render, so a confirm-press in the delete's round-trip window can't launch
    // the player into the snapshot that's on its way out. The refetch reconciles after.
    setSaves((list) => list.filter((snap) => snap.slot !== slot))
    try {
      await fetch(`${saveStatesUrl(detailGame.id)}&slot=${encodeURIComponent(slot)}`, { method: 'DELETE' })
    } finally {
      setSavesRefresh((n) => n + 1)
    }
  }
  const confirmYes = () => {
    if (!confirm) return
    if (confirm.kind === 'download') dl.remove()
    else deleteSave(confirm.slot)
    setConfirm(null)
  }

  // The "Wrong game?" picker. Its option list is the candidate games, then a "Clear"
  // option when the game is currently matched (so a wrong match can return to the
  // basic page). The index navigates over exactly this list.
  const rematchOptions = (r) =>
    r
      ? [
          ...(r.candidates || []).map((c) => ({ type: 'game', ...c })),
          ...(r.matched ? [{ type: 'clear' }] : []),
        ]
      : []
  const openRematch = () => {
    if (!detailGame) return
    const gid = detailGame.id
    const matched = !!meta?.matched
    // Guard against a game switch mid-fetch (like the meta/saves fetches): only open
    // the picker if we're still on the game it was requested for — otherwise a slow
    // response would open game A's candidates over game B and a pick would mis-write.
    const land = (d) => {
      if (metaGameRef.current !== gid) return
      setRematch({ candidates: d.candidates ?? [], current: d.current ?? null, matched, index: 0 })
    }
    fetch(gameCandidatesUrl(gid))
      .then((r) => (r.ok ? r.json() : { candidates: [], current: null }))
      .then(land)
      .catch(() => land({ candidates: [], current: null }))
  }
  // Apply a pick: an igdbId re-matches, null clears. Close + refetch the game's meta
  // on success so the page redraws as the newly-chosen game (or the basic page). On
  // failure (IGDB unreachable → 502) keep the dialog open with an error rather than
  // closing silently and leaving the user thinking the fix took.
  const applyMatch = async (igdbId) => {
    const gid = detailGame?.id
    if (!gid) return
    setRematch((r) => (r ? { ...r, busy: true, error: null } : r))
    try {
      const res = await postGameMatch(gid, igdbId)
      if (!res.ok) throw new Error('re-match failed')
      setRematch(null)
      setHeroSlide(0)
      setMetaRefresh((n) => n + 1)
    } catch {
      setRematch((r) => (r ? { ...r, busy: false, error: 'Couldn’t update — try again.' } : r))
    }
  }

  // Keep the game-page focus valid as its zones change: a save-list delete shrinks
  // the list, and meta arriving (or a game switch) adds/removes the screenshot strip.
  // Clamp the index and, when a zone empties, hand the cursor to the nearest one above.
  useEffect(() => {
    setDetailFocus((f) => {
      if (f.zone === 'actions') return f
      // The hero / fix control are single targets; if they went away, fall to actions.
      if (f.zone === 'hero') return shots.length ? { zone: 'hero', index: 0 } : { zone: 'actions', index: 0 }
      if (f.zone === 'fix') return canRematch ? { zone: 'fix', index: 0 } : { zone: 'actions', index: 0 }
      // saves
      if (saves.length === 0) return { zone: 'actions', index: 0 }
      return f.index < saves.length ? f : { zone: 'saves', index: saves.length - 1 }
    })
  }, [saves, shots.length, canRematch])

  // Append a key, but only if it keeps the list alive — the same dead-key rule the
  // grid dims by, enforced here so you physically cannot type into an empty result
  // set (whether by pad or by a laptop keyboard). Functional update so a fast typist
  // never races a stale `query`.
  const typeKey = useCallback(
    (ch) => {
      setQuery((q) => (items.some((g) => matches(g.name, q + ch)) ? q + ch : q))
      setZone('grid')
    },
    [items]
  )

  // Everything the controller can do, in one place, keyed by which screen is up.
  // Held in a ref so the poll loop is installed once and never re-installed mid-press.
  const act = useRef(() => {})
  act.current = (action) => {
    if (screen === 'boot') return
    // Nothing to point at yet. Without this, presses land against the skeleton's
    // placeholder rails and strand focus the moment the real ones arrive.
    if (booting) return

    // A confirm dialog on the game page traps ALL input until it's resolved (A yes /
    // B no) — ahead of even the global X-search toggle, or X would slip past it and
    // leave the dialog stranded open behind the search screen.
    if (screen === 'detail' && confirm) {
      if (action === 'confirm') confirmYes()
      else if (action === 'back') setConfirm(null)
      return
    }

    // A fullscreen screenshot also traps input: left/right page through the shots,
    // B / A closes. Ahead of the search toggle for the same reason as the confirm.
    if (screen === 'detail' && lightbox !== null) {
      if (action === 'left') setLightbox((i) => Math.max(0, i - 1))
      else if (action === 'right') setLightbox((i) => Math.min(shots.length - 1, i + 1))
      else if (action === 'back' || action === 'confirm') setLightbox(null)
      return
    }

    // The "Wrong game?" picker traps input too: up/down move the highlight, A picks
    // (re-match / clear), B cancels.
    if (screen === 'detail' && rematch) {
      const opts = rematchOptions(rematch)
      if (action === 'up') setRematch((r) => ({ ...r, index: Math.max(0, r.index - 1) }))
      else if (action === 'down') setRematch((r) => ({ ...r, index: Math.min(opts.length - 1, r.index + 1) }))
      else if (action === 'confirm') {
        const o = opts[rematch.index]
        if (o) applyMatch(o.type === 'clear' ? null : o.id)
      } else if (action === 'back') setRematch(null)
      return
    }

    // X is search from anywhere, and X again closes it — a toggle you can find with
    // one thumb without reading the legend.
    if (action === 'search') {
      screen === 'search' ? closeSearch() : openSearch()
      return
    }

    if (screen === 'search') {
      if (zone === 'grid') {
        switch (action) {
          case 'confirm':
            typeKey(KEYS[keyIndex])
            return
          // B peels back one layer at a time: a typed character, then (empty) out of
          // search entirely. Never a dead end.
          case 'back':
            query ? setQuery((q) => q.slice(0, -1)) : closeSearch()
            return
          // The shoulder is the express lane to the results — one press, from any key,
          // instead of walking Down through every row. The spatial Down-exit below
          // still works for the thumb that expects it.
          case 'railNext':
            if (results.length) {
              setZone('results')
              setResultRow(0)
            }
            return
          case 'up':
          case 'down':
          case 'left':
          case 'right': {
            const move = gridMove(keyIndex, action)
            if (move.exit === 'results') {
              // Down off the bottom row drops into the results — but only if there are
              // any; otherwise the keyboard keeps the cursor rather than stranding it.
              if (results.length) {
                setZone('results')
                setResultRow(0)
              }
            } else {
              setKeyIndex(move.index)
            }
            return
          }
          default:
        }
        return
      }

      // The results zone.
      switch (action) {
        case 'confirm':
        case 'alt':
          if (results[resultRow]) openDetail(results[resultRow], 'search')
          return
        // Up off the top row hands the cursor back to the keyboard — the mirror of the
        // down-press that brought you here. Decide the zone OUTSIDE the setState updater
        // so the updater stays pure (StrictMode double-invokes it).
        case 'up':
        case 'left':
          if (resultRow <= 0) setZone('grid')
          else setResultRow((i) => i - 1)
          return
        case 'down':
        case 'right':
          setResultRow((i) => Math.min(results.length - 1, i + 1))
          return
        // The shoulder that took you here takes you back.
        case 'railPrev':
        case 'back':
          setZone('grid')
          return
        default:
      }
      return
    }

    // The game page. (A confirm dialog / open lightbox, if up, was handled at the top.)
    // Zones stack vertically: actions → screens (screenshot strip) → saves, with only
    // the present ones in `detailZones`. up/down step between zones; left/right move
    // within actions or the screenshot strip.
    if (screen === 'detail') {
      const f = detailFocus
      const zi = detailZones.indexOf(f.zone)
      const above = zi > 0 ? detailZones[zi - 1] : null
      const below = zi >= 0 && zi < detailZones.length - 1 ? detailZones[zi + 1] : null
      switch (action) {
        case 'back':
          closeDetail()
          return
        case 'confirm':
          if (f.zone === 'hero') {
            if (shots.length) setLightbox(heroSlide) // open the hero's shots fullscreen
          } else if (f.zone === 'fix') {
            openRematch()
          } else if (f.zone === 'actions') {
            if (f.index === 0) play(detailGame)
            else if (f.index === 1) toggleFav()
            else startOrRemoveDownload()
          } else if (saves[f.index]) {
            play(detailGame, saves[f.index].slot)
          }
          return
        // Y deletes the focused snapshot — behind the confirm, and only in the save zone.
        case 'alt':
          if (f.zone === 'saves' && saves[f.index]) requestDeleteSave(saves[f.index].slot)
          return
        // On the hero, ◀▶ peek through the background screenshots; in the actions row
        // they move between the buttons.
        case 'left':
          if (f.zone === 'hero') setHeroSlide((i) => (i - 1 + shots.length) % shots.length)
          else if (f.zone === 'actions') setDetailFocus((p) => ({ zone: 'actions', index: Math.max(0, p.index - 1) }))
          return
        case 'right':
          if (f.zone === 'hero') setHeroSlide((i) => (i + 1) % shots.length)
          else if (f.zone === 'actions') setDetailFocus((p) => ({ zone: 'actions', index: Math.min(2, p.index + 1) }))
          return
        case 'up':
          // Within the save list, up walks the list first; at its top (and from any
          // other zone) it crosses to the zone above.
          if (f.zone === 'saves' && f.index > 0) setDetailFocus((p) => ({ zone: 'saves', index: p.index - 1 }))
          else if (above) setDetailFocus({ zone: above, index: 0 })
          return
        case 'down':
          if (f.zone === 'saves') setDetailFocus((p) => ({ zone: 'saves', index: Math.min(saves.length - 1, p.index + 1) }))
          else if (below) setDetailFocus({ zone: below, index: 0 })
          return
        default:
      }
      return
    }

    if (screen === 'shelf') {
      switch (action) {
        case 'confirm': {
          const rail = rails[focus.rail]
          const item = rail?.items?.[focus.index]
          if (!item) return
          if (rail.kind === 'system') {
            if (item.count > 0) openSystem(item.label)
          } else if (rail.id === 'jump') {
            // "Jump back in" is the fast-resume lane: straight into the game (battery
            // save), no page in between. Every other game opens its page (Y does too).
            play(item)
          } else openDetail(item, 'shelf')
          return
        }
        case 'back':
          // Frog IS the games screen, so "leave" goes up to the Library hub, not to
          // a games grid (there isn't one any more).
          navigate('/library')
          return
        case 'alt': {
          const rail = rails[focus.rail]
          const item = rail?.items?.[focus.index]
          if (rail?.kind === 'game' && item) openDetail(item, 'shelf')
          return
        }
        default: {
          // Only the directions move the shelf. Falling through to moveInRails with
          // (say) 'search' returns a fresh focus object that's identical but not the
          // same reference — which re-renders and fires a redundant smooth scroll on
          // every press of a button that's supposed to do nothing here.
          if (!MOVES.has(action)) return
          const next = moveInRails(rails, focus, action, memory)
          setMemory(next.memory)
          setFocus(next.focus)
        }
      }
      return
    }

    // The games list.
    const last = games.length - 1
    const clamp = (i) => Math.max(0, Math.min(last, i))
    switch (action) {
      case 'confirm':
      case 'alt':
        if (games[row]) openDetail(games[row], 'games')
        return
      case 'back':
        setScreen('shelf')
        return
      case 'up':
      case 'left':
        setRow((i) => clamp(i - 1))
        return
      case 'down':
      case 'right':
        setRow((i) => clamp(i + 1))
        return
      // The shoulders skip a screenful; the triggers skip a letter. Sixty presses to
      // reach the S's is what makes a big library feel like a punishment.
      case 'railPrev':
        setRow((i) => clamp(i - 10))
        return
      case 'railNext':
        setRow((i) => clamp(i + 10))
        return
      case 'jumpPrev':
      case 'jumpNext':
        setRow((i) => stepLetter(games, i, action === 'jumpNext' ? 1 : -1))
        return
      default:
    }
  }

  useGamepad({
    onAction: (a) => act.current(a),
    // Any button on a sleeping pad is how we learn a controller exists at all — iOS
    // never fires `gamepadconnected` until then. On the boot screen that press is
    // also the "press A" that dismisses it.
    onPadButton: () => {
      setMode((m) => nextFrogMode(m, 'pad'))
      setScreen((s) => (s === 'boot' ? 'shelf' : s))
    },
    onMenuAction: (a) => {
      if (a === 'start') act.current('confirm')
    },
  })

  // Keyboard parity, so a desktop drives it identically. Frog is a controller app,
  // but "I'm at my laptop and I want to check something" must not require a pad.
  // Held in a ref because the listener is installed once — reading `screen`/`typeKey`
  // straight from the closure would freeze them at their first-render values.
  // A physical Backspace should always EDIT the query — delete a character, or close
  // search when there's nothing left — never just hop between zones the way pad-B does.
  const del = () => {
    if (query) {
      setQuery((q) => q.slice(0, -1))
      setZone('grid')
    } else {
      closeSearch()
    }
  }
  const kbd = useRef({})
  kbd.current = { screen, typeKey, del }
  useEffect(() => {
    const onKey = (e) => {
      // The native search field (touch mode, but reachable with a Magic Keyboard)
      // owns its own text keys — typing, Backspace, the arrows-as-caret-movement.
      // Routing those through the grid handler too would double-type or hijack the
      // caret. Escape is the exception: the field has no way to close search, so let
      // it through to toggle search shut.
      if (e.target?.tagName === 'INPUT') {
        if (e.key === 'Escape') {
          e.preventDefault()
          act.current('search') // screen is 'search' → toggles it closed
        }
        return
      }
      // On the search screen a real keyboard should just... type, bypassing the grid.
      if (kbd.current.screen === 'search') {
        if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
          e.preventDefault()
          kbd.current.typeKey(e.key.toUpperCase())
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          kbd.current.del()
          return
        }
      }
      const map = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Enter: 'confirm',
        Escape: 'back',
        Delete: 'alt', // the game page: delete the focused save
        PageUp: 'railPrev',
        PageDown: 'railNext',
        '/': 'search',
      }
      const a = map[e.key]
      if (!a) return
      e.preventDefault()
      act.current(a)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A finger on the glass means touch mode — even on an iPad that a moment ago had a
  // controller driving it. The mirror of the pad-button flip above.
  useEffect(() => {
    const onPointer = (e) => {
      if (e.pointerType === 'touch') setMode((m) => nextFrogMode(m, 'touch'))
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [])

  if (screen === 'boot') return <Boot onDone={() => setScreen('shelf')} />

  // What the pond light is coloured by: the open system, the result you're pointing
  // at while searching (jade until you've pointed at one), or the shelf's focus.
  const focusedSystem =
    screen === 'games'
      ? system
      : screen === 'detail'
        ? detailGame?.label
        : screen === 'search'
          ? zone === 'results' && results[resultRow]
            ? results[resultRow].label
            : null
          : hovered(rails, focus)
  const accent = systemStyle(focusedSystem).accent

  return (
    <div
      data-testid="frog"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: FROG.ground,
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        // The root carries the bottom inset so the last row of games/results always
        // clears the iOS home indicator — the legend used to be the only thing padding
        // the bottom, and it's hidden in touch mode, which is exactly where the inset
        // is nonzero.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* The pond light. It takes the colour of whatever is in focus, which is the
          single cheapest way to make a machine feel *selected* rather than outlined. */}
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-500"
        style={{ background: `radial-gradient(120% 80% at 50% 100%, rgba(${accent}, 0.14), transparent 70%)` }}
      />

      <header className="relative flex items-center justify-between gap-4 px-6 py-3">
        {screen === 'games' && system ? (
          <GameListHeader system={system} count={games.length} />
        ) : (
          <div className="flex items-center gap-2">
            <FrogMark size={22} style={{ color: `rgb(${FROG.jade})` }} />
            <span className="text-sm font-semibold tracking-[0.22em]" style={{ color: FROG.ink }}>
              {screen === 'search' ? 'FROG · SEARCH' : 'FROG'}
            </span>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {/* Offline: the shelf is built from downloaded games only, so say so — an
              otherwise-sparse shelf reads as "broken" without it. Shown only when we
              actually fell back (the server's unreachable AND gave us nothing), never
              while a reachable library is on screen. */}
          {offline && (
            <span
              data-testid="frog-offline"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide"
              style={{ background: 'rgba(251, 191, 36, 0.12)', color: 'rgb(251, 191, 36)' }}
            >
              <Plane className="h-3 w-3" aria-hidden="true" />
              Offline
            </span>
          )}

          {/* Search, reachable by thumb. On a pad it's X (and the legend says so); by
              touch there was no way in at all until this button — the header only had
              the ✕. Hidden on the search screen itself, where the ✕ becomes "close". */}
          {screen !== 'search' && screen !== 'detail' && (
            <button
              onClick={openSearch}
              className="rounded-full p-2"
              style={{ background: FROG.panel, color: FROG.soft }}
              aria-label="Search games"
            >
              <SearchIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          <button
            onClick={() => {
              if (screen === 'search') closeSearch()
              else if (screen === 'detail') closeDetail()
              else if (screen === 'games') setScreen('shelf')
              else navigate('/library') // leave Frog → the Library hub
            }}
            className="rounded-full p-2"
            style={{ background: FROG.panel, color: FROG.soft }}
            aria-label={
              screen === 'search'
                ? 'Close search'
                : screen === 'detail'
                  ? 'Back'
                  : screen === 'games'
                    ? 'Back to the shelf'
                    : 'Leave Frog'
            }
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {booting ? (
        <div className="flex-1 space-y-4 px-6 pt-6">
          <SkeletonLine className="h-4 w-40" />
          <div className="flex gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-32 flex-1 rounded-2xl" style={{ background: FROG.panel }} />
            ))}
          </div>
        </div>
      ) : screen === 'search' ? (
        <Search
          query={query}
          results={results}
          allGames={items}
          zone={zone}
          keyIndex={keyIndex}
          resultRow={resultRow}
          native={searchNative}
          onKey={(i) => {
            setKeyIndex(i)
            setZone('grid')
          }}
          onResult={(i) => {
            setResultRow(i)
            setZone('results')
          }}
          // The native keyboard hands over the whole string at once (type, paste,
          // autocorrect), so it sets the query directly rather than one dead-key-guarded
          // character at a time the way the grid does.
          onType={setQuery}
          onPick={(game, ch) => (ch != null ? typeKey(ch) : openDetail(game, 'search'))}
        />
      ) : screen === 'detail' && detailGame ? (
        <GameScreen
          game={detailGame}
          meta={meta}
          favorited={favorited}
          saves={saves}
          loadingSaves={savesLoading}
          download={dl}
          focus={detailFocus}
          confirm={confirm}
          lightbox={lightbox}
          slide={heroSlide}
          canRematch={canRematch}
          rematch={rematch}
          onOpenRematch={openRematch}
          onRematchHover={(index) => setRematch((r) => (r ? { ...r, index } : r))}
          onRematchPick={(igdbId) => applyMatch(igdbId)}
          onRematchCancel={() => setRematch(null)}
          onFocus={(zone, index) => setDetailFocus({ zone, index })}
          onPlay={() => play(detailGame)}
          onPlaySlot={(slot) => play(detailGame, slot)}
          onToggleFavorite={toggleFav}
          onDownload={startOrRemoveDownload}
          onRequestDeleteSave={requestDeleteSave}
          onOpenShot={(index) => setLightbox(index)}
          onCloseLightbox={() => setLightbox(null)}
          onLightboxNav={(dir) =>
            setLightbox((i) => Math.max(0, Math.min(shots.length - 1, i + dir)))
          }
          onConfirmYes={confirmYes}
          onConfirmNo={() => setConfirm(null)}
        />
      ) : screen === 'games' ? (
        <GameList
          system={system}
          games={games}
          focus={row}
          onFocus={setRow}
          onPick={(g) => openDetail(g, 'games')}
        />
      ) : (
        <Shelf
          rails={rails}
          focus={focus}
          onFocus={(rail, index) => setFocus({ rail, index })}
          onPick={(rail, item) =>
            rail.kind === 'system'
              ? item.count > 0 && openSystem(item.label)
              : rail.id === 'jump'
                ? play(item)
                : openDetail(item, 'shelf')
          }
        />
      )}

      {/* The controller legend. Meaningless without a controller, so it's hidden in
          touch mode — the tappable tiles, the header search/close, and tap-to-play
          are self-evident to a thumb. It returns the instant a pad button is pressed. */}
      {!native && (
      <ButtonLegend
        className="relative py-3"
        style={{
          borderTop: `1px solid ${FROG.line}`,
          // The root now owns the safe-area inset, so the legend only needs its own
          // breathing room above it (no double inset).
          paddingBottom: '0.75rem',
        }}
        hints={
          screen === 'search'
            ? zone === 'grid'
              ? [
                  { button: 'A', label: 'Type' },
                  { button: 'B', label: query ? 'Delete' : 'Close' },
                  { button: 'RB', label: 'Results' },
                  { button: 'X', label: 'Close' },
                ]
              : [
                  { button: 'A', label: 'Open' },
                  { button: 'LB', label: 'Keys' },
                  { button: 'X', label: 'Close' },
                ]
            : screen === 'detail'
              ? confirm
                ? [
                    { button: 'A', label: 'Confirm' },
                    { button: 'B', label: 'Cancel' },
                  ]
                : lightbox !== null
                  ? [
                      { button: 'B', label: 'Close' },
                      { button: 'D-pad', label: 'Browse' },
                    ]
                  : rematch
                    ? [
                        { button: 'A', label: 'Choose' },
                        { button: 'B', label: 'Cancel' },
                        { button: 'D-pad', label: 'Move' },
                      ]
                    : [
                        {
                          button: 'A',
                          label:
                            detailFocus.zone === 'saves'
                              ? 'Load'
                              : detailFocus.zone === 'hero'
                                ? 'Screenshots'
                                : detailFocus.zone === 'fix'
                                  ? 'Fix match'
                                  : 'Select',
                        },
                        { button: 'B', label: 'Back' },
                        ...(detailFocus.zone === 'saves' ? [{ button: 'Y', label: 'Delete save' }] : []),
                        { button: 'D-pad', label: detailFocus.zone === 'hero' ? 'Peek' : 'Move' },
                      ]
              : screen === 'games'
                ? [
                    { button: 'A', label: 'Open' },
                    { button: 'B', label: 'Shelf' },
                    { button: 'X', label: 'Find' },
                    { button: 'LT/RT', label: 'Letter' },
                  ]
                : [
                    { button: 'A', label: 'Open' },
                    { button: 'B', label: 'Home HQ' },
                    { button: 'X', label: 'Find' },
                    { button: 'D-pad', label: 'Move' },
                  ]
        }
      />
      )}
    </div>
  )
}

// The system the shelf's focus implies — a system tile is itself; a game is the
// machine it runs on.
function hovered(rails, focus) {
  return rails?.[focus.rail]?.items?.[focus.index]?.label ?? null
}

