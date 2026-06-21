// Reading/listening position: local cache + write-sync outbox.
//
// Every reader and the audiobook player saves your spot with a debounced PUT to
// the server. This module gives that two jobs at once:
//
//   1. SYNC (outbox): if the PUT fails (offline — on a plane, server unreachable
//      over the tailnet) the position is kept locally and replayed on reconnect,
//      so a position set offline isn't lost.
//   2. RESUME CACHE: the position is kept locally even AFTER it syncs, so a
//      downloaded item opened while offline can resume where you left off — the
//      server holds the position too, but it's unreachable offline.
//
// One IndexedDB store does both: a per-item entry `{key, path, body, updatedAt,
// synced}`. A save writes it `synced:false`; a successful PUT marks it `synced`
// (it is NOT deleted — that was the bug: an online-saved position vanished
// locally, so offline reopen fell through to the unreachable server → page 1).
//
// Last-write-wins (single user) is enforced by compare-and-set: an entry is only
// marked synced if its `updatedAt` still matches the value just sent, and the
// flush sends the FRESHEST value per key — so a newer save is never clobbered by
// an in-flight stale one. Sync is app-driven (flush on reconnect), NOT SW
// Background Sync, which iOS Safari lacks.

import { API_BASE } from './useApi.js'

const DB_NAME = 'home-hq-progress'
const DB_VERSION = 1
const STORE = 'pending'
const PUT_TIMEOUT_MS = 4000
const RESUME_SERVER_TIMEOUT_MS = 3000

// --- Pure helpers (unit-tested) --------------------------------------------

// One stable key per item so repeated saves coalesce (last-write-wins) and a
// reader can look its own position back up. Namespaced so a reading item and a
// listening item can never collide.
export function readingKey(section, id) {
  return `read:${section}:${id}`
}

export function listenKey(bookId) {
  return `listen:${bookId}`
}

// Which position should a reader resume from? (pure decision):
//   - an UNSYNCED local entry is progress made offline → freshest, always wins;
//   - else when online, the server is authoritative (roams across devices);
//   - else (offline / server gave nothing) fall back to any local copy.
// `local` is the stored entry (or null); `server` is the server's position
// object (or null). Returns a position object the reader reads its fields from.
export function chooseResume(local, online, server) {
  if (local && local.synced === false) return local.body
  if (online && server) return server
  return local ? local.body : null
}

// --- IndexedDB plumbing (mirrors offlineStore.js) --------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const result = fn(store)
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

function reqProm(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function pendingEntries() {
  const db = await openDb()
  return tx(db, 'readonly', (store) => reqProm(store.getAll())).then((r) => r ?? [])
}

export async function getPending(key) {
  const db = await openDb()
  return tx(db, 'readonly', (store) => reqProm(store.get(key))).then((r) => r ?? null)
}

// Write (overwrite) the entry for a key as unsynced; return its timestamp so a
// later mark-synced can confirm it's the exact value it sent.
async function queueWrite(key, path, body) {
  const updatedAt = Date.now()
  const db = await openDb()
  await tx(db, 'readwrite', (store) => store.put({ key, path, body, updatedAt, synced: false }))
  return updatedAt
}

// Compare-and-set: mark the entry synced only if it's still the one we sent
// (same `updatedAt`). If a newer write landed during the PUT, leave it unsynced
// so the next save/flush delivers it. Keeps the entry for offline resume.
async function markSyncedIfUnchanged(key, updatedAt) {
  const db = await openDb()
  return tx(db, 'readwrite', (store) => {
    const g = store.get(key)
    g.onsuccess = () => {
      const e = g.result
      if (e && e.updatedAt === updatedAt && !e.synced) store.put({ ...e, synced: true })
    }
  })
}

function putWithTimeout(path, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PUT_TIMEOUT_MS)
  return fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer))
}

// --- Operations readers / the app use --------------------------------------

// Record the position locally (durable, stamped, unsynced), then try to PUT it.
// On success mark it synced ONLY if it's still the value we sent. Queuing first
// means the position is never lost and is always available to resume from while
// offline.
export async function saveProgress({ key, path, body }) {
  let updatedAt
  try {
    updatedAt = await queueWrite(key, path, body)
  } catch {
    return false // IndexedDB unavailable (e.g. private mode) — best effort, never throw
  }
  try {
    const res = await putWithTimeout(path, body)
    if (res.ok) {
      await markSyncedIfUnchanged(key, updatedAt)
      return true
    }
  } catch {
    /* offline / timeout / unreachable — stays unsynced for the next flush */
  }
  return false
}

// Replay unsynced entries to the server. For each key send the FRESHEST value
// (not a stale snapshot), mark synced on success only if unchanged, give up
// (mark synced) on a 4xx the server will never accept, and leave it unsynced on
// a network error or 5xx (transient — retry next reconnect). Entries are kept
// (as the resume cache) either way. Returns the count flushed.
export async function flushOutbox() {
  const snapshot = await pendingEntries()
  const unsynced = snapshot.filter((e) => e.synced === false)
  if (!unsynced.length) return 0
  let flushed = 0
  for (const snap of unsynced) {
    const cur = await getPending(snap.key) // freshest value for this key
    if (!cur || cur.synced) continue // already synced by a concurrent save
    let status = 0
    try {
      const res = await putWithTimeout(cur.path, cur.body)
      status = res.status
    } catch {
      continue // still unreachable — leave unsynced
    }
    if (status >= 200 && status < 300) {
      await markSyncedIfUnchanged(cur.key, cur.updatedAt)
      flushed++
    } else if (status >= 400 && status < 500) {
      await markSyncedIfUnchanged(cur.key, cur.updatedAt) // permanently rejected — stop retrying
    }
    // 5xx → leave unsynced for the next reconnect
  }
  return flushed
}

// Resolve where a reader should resume. `serverFetch` returns the server's saved
// position object (or null). Offline progress wins; else the server when online
// (bounded so an optimistic online flag can't hang the reader); else local.
export async function resolveResume({ key, online, serverFetch }) {
  const local = await getPending(key)
  if (local && local.synced === false) return local.body // offline progress is freshest; skip server
  let server = null
  if (online && serverFetch) {
    try {
      server = await Promise.race([
        // .catch here (not just the outer try) so a fetch that rejects AFTER the
        // timeout already won the race doesn't become an unhandled rejection.
        serverFetch().catch(() => null),
        new Promise((res) => setTimeout(() => res(null), RESUME_SERVER_TIMEOUT_MS)),
      ])
    } catch {
      server = null
    }
  }
  return chooseResume(local, online, server)
}
