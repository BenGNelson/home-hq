// Write-sync outbox for reading/listening position.
//
// Every reader and the audiobook player saves your spot with a debounced PUT to
// the server. Offline (on a plane, server unreachable over the tailnet) that
// write would just be dropped — so progress made offline never reaches the
// server, and "Jump back in" / other devices / the backup show a stale spot.
//
// This module catches those writes in a small IndexedDB queue instead:
//   - saveProgress() attempts the PUT; on ANY failure (offline / timeout /
//     non-OK) it queues the write locally. A *successful* PUT clears any stale
//     pending entry for that item, so the queue never holds a value the server
//     already has.
//   - flushOutbox() replays the queue when the app reconnects, deleting each
//     entry on a successful PUT.
//   - getPending() lets a reader resume from the freshest local value when it
//     reopens while still offline (a pending entry is by definition newer than
//     the server — it hasn't synced yet).
//
// Single user → last-write-wins: the queue is keyed per item, so a newer save
// overwrites the older pending one and we never replay a stale position. This
// is app-driven (flush on reconnect), NOT the Service Worker Background Sync
// API, which iOS Safari doesn't support.

import { API_BASE } from './useApi.js'

const DB_NAME = 'home-hq-progress'
const DB_VERSION = 1
const STORE = 'pending'
const PUT_TIMEOUT_MS = 4000

// --- Pure key helpers (unit-tested) ----------------------------------------

// One stable key per item so repeated saves coalesce (last-write-wins) and a
// reader can look its own pending position back up. Kept namespaced so a
// reading item and a listening item can never collide.
export function readingKey(section, id) {
  return `read:${section}:${id}`
}

export function listenKey(bookId) {
  return `listen:${bookId}`
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

// Write (overwrite) the pending entry for a key and return its timestamp. Each
// write stamps `updatedAt` so a later delete can confirm it's removing the exact
// value it sent — never a newer write that landed in between (last-write-wins).
async function queueWrite(key, path, body) {
  const updatedAt = Date.now()
  const db = await openDb()
  await tx(db, 'readwrite', (store) => store.put({ key, path, body, updatedAt }))
  return updatedAt
}

// Compare-and-delete: only drop the entry if it's still the one we just sent
// (same `updatedAt`). If a newer write landed during the PUT, leave it queued so
// the next save/flush delivers it. This is the guard that makes last-write-wins
// hold under connectivity flapping mid-flush.
async function removeIfUnchanged(key, updatedAt) {
  const db = await openDb()
  return tx(db, 'readwrite', (store) => {
    const g = store.get(key)
    g.onsuccess = () => {
      const e = g.result
      if (e && e.updatedAt === updatedAt) store.delete(key)
    }
  })
}

async function removePending(key) {
  const db = await openDb()
  return tx(db, 'readwrite', (store) => store.delete(key))
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

// --- The two operations readers / the app use ------------------------------

// Record the position locally (durable, stamped), then try to PUT it. On a
// successful PUT we clear the entry ONLY if it's still the one we sent — so a
// newer save that landed during the request survives to be delivered next.
// Queuing first means the value is never lost (app killed mid-PUT → flushed
// later) and is always available to resume from while offline.
export async function saveProgress({ key, path, body }) {
  const updatedAt = await queueWrite(key, path, body)
  try {
    const res = await putWithTimeout(path, body)
    if (res.ok) {
      await removeIfUnchanged(key, updatedAt)
      return true
    }
  } catch {
    /* offline / timeout / unreachable — stays queued for the next flush */
  }
  return false
}

// Replay the queue to the server. For each key we send the FRESHEST value (not a
// stale snapshot), delete on success only if unchanged, drop on a 4xx (the
// server will never accept it — e.g. the item was removed), and leave it queued
// on a network error or 5xx (transient — retry next reconnect). Returns the
// count flushed.
export async function flushOutbox() {
  const snapshot = await pendingEntries()
  if (!snapshot.length) return 0
  let flushed = 0
  for (const snap of snapshot) {
    const cur = await getPending(snap.key) // freshest value for this key
    if (!cur) continue // already cleared by a concurrent successful save
    let status = 0
    try {
      const res = await putWithTimeout(cur.path, cur.body)
      status = res.status
    } catch {
      continue // still unreachable — leave queued
    }
    if (status >= 200 && status < 300) {
      await removeIfUnchanged(cur.key, cur.updatedAt)
      flushed++
    } else if (status >= 400 && status < 500) {
      await removePending(cur.key) // permanently rejected — stop re-sending
    }
    // 5xx → leave queued for the next reconnect
  }
  return flushed
}
