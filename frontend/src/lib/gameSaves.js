// The game's own battery save — the thing you get when you pick "Save" inside
// Pokémon. It is the save that costs you hours if it goes missing, and it is not
// the same thing as a save state.
//
// EmulatorJS does NOT persist it. So we do — and, critically, WE do it from the
// PARENT, not from inside the player iframe.
//
// That's the whole point of this module. The old version lived in emulator.html and
// flushed on `pagehide`. The event fires, but the work it starts is asynchronous
// (open a cache, write to it, POST to the server) and the iframe is torn down before
// any of it lands. We were asking a dying document to save your game. Quit shortly
// after saving and it was simply gone — not stale, gone.
//
// The parent survives the teardown. It can read the save out of the engine
// synchronously, and then take its time writing it down.

import { GAME_SAVES_CACHE } from './offlineConfig.js'
import { gameSramUrl } from './library.js'

export const sramKey = (gameId) => `/__game-sram/${encodeURIComponent(gameId)}`

// When the local copy was written. Cache Storage keeps response headers, so the
// timestamp rides along with the bytes instead of needing its own bookkeeping.
const SAVED_AT = 'x-hq-saved-at'

// Games whose save hasn't reached the server yet. Just the ids — the bytes are
// already in the local cache, so the retry re-reads them from there rather than
// keeping a second copy that could drift.
const OUTBOX_KEY = 'homehq.games.sramOutbox'

// --- pure ------------------------------------------------------------------

// Has the save changed? Hash ALL of it.
//
// The old check sampled every 64th byte — 1.6% of a 32KB save. A write that touched
// only unsampled bytes read as "unchanged" and was silently dropped on the floor.
// A save file is 32-128KB; hashing the whole thing costs microseconds, and being
// wrong costs somebody's afternoon.
export function hashSave(bytes) {
  if (!bytes || !bytes.length) return null
  let h = 0x811c9dc5 // FNV-1a
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return `${bytes.length}:${h >>> 0}`
}

// Which copy wins: this device's, or the server's?
//
// NEWEST WINS. Seeding used to prefer the local cache unconditionally, which meant a
// device with a stale copy ignored a newer save on the server — then played on and
// overwrote the server with the old one. Play on the iPad, pick up the phone, and the
// phone silently rewound you AND destroyed the evidence.
//
// This is not a general sync algorithm. Two devices played offline at once and the
// later one wins outright. For one person with a phone and a tablet, that's the right
// trade; anything cleverer would need conflict UI nobody wants mid-game.
export function pickNewest(local, remote) {
  if (!local?.bytes?.length) return remote?.bytes?.length ? 'remote' : null
  if (!remote?.bytes?.length) return 'local'
  return (remote.savedAt || 0) > (local.savedAt || 0) ? 'remote' : 'local'
}

// --- the outbox ------------------------------------------------------------

export function readOutbox(storage) {
  try {
    const raw = storage?.getItem(OUTBOX_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function addToOutbox(storage, gameId) {
  const list = readOutbox(storage)
  if (list.includes(gameId)) return list
  const next = [...list, gameId]
  try {
    storage?.setItem(OUTBOX_KEY, JSON.stringify(next))
  } catch {
    // Full/blocked storage. The local save is still safe; only the retry is lost.
  }
  return next
}

export function removeFromOutbox(storage, gameId) {
  const next = readOutbox(storage).filter((id) => id !== gameId)
  try {
    storage?.setItem(OUTBOX_KEY, JSON.stringify(next))
  } catch {
    /* see above */
  }
  return next
}

// --- storage ---------------------------------------------------------------

function io(d = {}) {
  return {
    fetch: d.fetch || globalThis.fetch?.bind(globalThis),
    caches: 'caches' in d ? d.caches : globalThis.caches,
    storage: 'storage' in d ? d.storage : globalThis.localStorage,
    now: d.now || (() => Date.now()),
  }
}

export async function readLocal(gameId, d) {
  const { caches } = io(d)
  try {
    const cache = await caches.open(GAME_SAVES_CACHE)
    const res = await cache.match(sramKey(gameId))
    if (!res) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { bytes, savedAt: Number(res.headers.get(SAVED_AT)) || 0 }
  } catch {
    return null
  }
}

export async function writeLocal(gameId, bytes, savedAt, d) {
  const { caches } = io(d)
  try {
    const cache = await caches.open(GAME_SAVES_CACHE)
    await cache.put(
      sramKey(gameId),
      new Response(new Blob([bytes]), { headers: { [SAVED_AT]: String(savedAt) } })
    )
    return true
  } catch {
    return false
  }
}

export async function readServer(gameId, d) {
  const { fetch } = io(d)
  try {
    const res = await fetch(gameSramUrl(gameId))
    if (!res.ok) return null // 404 = this game has no save on the server yet
    const bytes = new Uint8Array(await res.arrayBuffer())
    // The backend stamps the file's mtime on the way out, so we can compare.
    const savedAt = Number(res.headers.get('x-saved-at')) || 0
    return { bytes, savedAt }
  } catch {
    return null // offline. The local copy is authoritative until we're back.
  }
}

// Push the save to the server. On failure the game goes in the outbox rather than
// being forgotten — the readers have had this for ages (progressOutbox); games
// simply never got it, so a save made offline never reached the server, the backup,
// or your other device.
export async function uploadSram(gameId, bytes, d) {
  const { fetch, storage } = io(d)
  try {
    const body = new FormData()
    body.append('id', gameId)
    body.append('sram', new Blob([bytes]), 'sram.bin')
    const res = await fetch(gameSramUrl(gameId), { method: 'POST', body, keepalive: bytes.length < 60_000 })
    if (!res.ok) throw new Error(String(res.status))
    removeFromOutbox(storage, gameId)
    return true
  } catch {
    addToOutbox(storage, gameId)
    return false
  }
}

// Retry everything that never made it. Called when we come back online.
export async function flushOutbox(d) {
  const { storage } = io(d)
  const pending = readOutbox(storage)
  let sent = 0
  for (const gameId of pending) {
    const local = await readLocal(gameId, d)
    if (!local?.bytes?.length) {
      removeFromOutbox(storage, gameId) // nothing left to send
      continue
    }
    if (await uploadSram(gameId, local.bytes, d)) sent++
  }
  return sent
}

// --- the engine ------------------------------------------------------------

// Read the battery save straight out of the running core. Synchronous — which is the
// entire reason this can be trusted on the way out.
export function readFromEngine(emu) {
  try {
    const bytes = emu?.gameManager?.getSaveFile?.(true) // flushes the core's RAM first
    return bytes?.length ? bytes : null
  } catch {
    return null
  }
}

function writeToEngine(emu, bytes) {
  try {
    emu.gameManager.FS.writeFile(emu.gameManager.getSaveFilePath(), new Uint8Array(bytes))
    emu.gameManager.loadSaveFiles()
    return true
  } catch {
    return false
  }
}

// Load the right save into a game that's just started: whichever copy is newer.
export async function seedSave(emu, gameId, d) {
  const [local, remote] = await Promise.all([readLocal(gameId, d), readServer(gameId, d)])
  const winner = pickNewest(local, remote)
  if (!winner) return { seeded: false, from: null }

  const chosen = winner === 'remote' ? remote : local
  writeToEngine(emu, chosen.bytes)

  // If the server had the newer copy, adopt it locally too — otherwise this device
  // would keep thinking its stale save is the truth.
  if (winner === 'remote') await writeLocal(gameId, chosen.bytes, chosen.savedAt, d)

  return { seeded: true, from: winner, savedAt: chosen.savedAt }
}

// Capture the save if it has changed. `state` carries the last hash between calls, so
// an unchanged save costs one hash and nothing else.
//
// The local write ALWAYS happens; the upload is throttled, and failure is survivable
// because the outbox will come back for it.
export async function captureSave(emu, gameId, state = {}, d) {
  const { storage, now } = io(d)
  const bytes = readFromEngine(emu)
  if (!bytes) return state

  const hash = hashSave(bytes)
  if (hash === state.hash) return state // genuinely unchanged

  const at = now()
  await writeLocal(gameId, bytes, at, d)

  // Throttle the upload — the capture runs on a timer and the network doesn't need
  // to hear about every frame of a battle. `force` (on the way out) ignores it.
  const due = state.force || !state.uploadedAt || at - state.uploadedAt > 15_000
  if (due) {
    const ok = await uploadSram(gameId, bytes, d)
    return { hash, uploadedAt: ok ? at : state.uploadedAt }
  }

  addToOutbox(storage, gameId) // changed but not sent yet — don't lose track of it
  return { hash, uploadedAt: state.uploadedAt }
}
