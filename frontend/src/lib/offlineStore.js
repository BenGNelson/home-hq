// The device-side offline store: the downloads manifest (IndexedDB) + helpers
// to read/write the content cache, plus the PURE accounting logic that powers
// the audit-grade storage manager.
//
// Split on purpose:
//   - Pure functions (downloadKey, auditCache, summarizeStorage) touch no
//     browser globals, so they're unit-tested like the rest of lib/.
//   - I/O functions (IndexedDB + Cache Storage + storage.estimate/persist) only
//     reach for globals inside their bodies, so importing this module is safe in
//     any environment.
//
// Invariant the whole feature rests on: the OFFLINE_CACHE is written ONLY by
// `downloadJob` here. Nothing else caches content. `auditCache` exists to PROVE
// that — it cross-checks the real cache against the manifest and flags strays.

import { OFFLINE_CACHE, SHELL_CACHE } from './offlineConfig.js'

const DB_NAME = 'home-hq-offline'
const DB_VERSION = 1
const STORE = 'downloads'

// --- pure helpers (unit-tested) -------------------------------------------

// A manifest entry's stable key: one download per (section, item).
export function downloadKey(section, id) {
  return `${section}:${id}`
}

// Cross-check the real content cache against the manifest. Given the manifest
// entries (each `{ urls: [...] }`) and the URLs actually present in the cache,
// return what doesn't line up:
//   orphans — cached URLs not referenced by ANY manifest entry (bytes we can't
//             explain → the thing the audit is here to catch; should be []).
//   missing — manifest URLs not in the cache (a download that was partly evicted
//             → that item won't fully read offline).
export function auditCache(entries, cachedUrls) {
  const referenced = new Set()
  for (const e of entries ?? []) for (const u of e.urls ?? []) referenced.add(u)
  const cached = new Set(cachedUrls ?? [])
  const orphans = [...cached].filter((u) => !referenced.has(u))
  const missing = [...referenced].filter((u) => !cached.has(u))
  return { orphans, missing, clean: orphans.length === 0 && missing.length === 0 }
}

// Shape the storage manager's view: the per-item breakdown (newest first), the
// shell line, the downloads total, and — when the browser reports a usage
// figure — how much of it our accounting explains vs. is unaccounted-for.
export function summarizeStorage(entries, estimate = {}, shellBytes = 0) {
  const items = [...(entries ?? [])].sort((a, b) => (b.date || 0) - (a.date || 0))
  const downloadsBytes = items.reduce((n, e) => n + (e.bytes || 0), 0)
  const accounted = downloadsBytes + (shellBytes || 0)
  const usage = typeof estimate.usage === 'number' ? estimate.usage : null
  const quota = typeof estimate.quota === 'number' ? estimate.quota : null
  return {
    items,
    shellBytes: shellBytes || 0,
    downloadsBytes,
    accounted,
    usage,
    quota,
    // Bytes the browser counts that we can't attribute (rounded so float dust in
    // estimate() doesn't read as a leak). >0 would mean something escaped the
    // manifest — by construction it shouldn't.
    unaccounted: usage == null ? null : Math.max(0, usage - accounted),
  }
}

// --- IndexedDB manifest (I/O) ---------------------------------------------

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

export async function allEntries() {
  const db = await openDb()
  try {
    return await tx(db, 'readonly', (s) => reqProm(s.getAll())).then((r) => r || [])
  } finally {
    db.close()
  }
}

export async function getEntry(key) {
  const db = await openDb()
  try {
    return await tx(db, 'readonly', (s) => reqProm(s.get(key)))
  } finally {
    db.close()
  }
}

async function putEntry(entry) {
  const db = await openDb()
  try {
    await tx(db, 'readwrite', (s) => s.put(entry))
  } finally {
    db.close()
  }
}

async function delEntry(key) {
  const db = await openDb()
  try {
    await tx(db, 'readwrite', (s) => s.delete(key))
  } finally {
    db.close()
  }
}

// --- content cache (I/O) ---------------------------------------------------

// The URLs currently sitting in the content cache (absolute hrefs), for the
// audit. Returns [] if the Cache API isn't available.
export async function cachedUrls() {
  if (!('caches' in self)) return []
  const cache = await caches.open(OFFLINE_CACHE)
  const reqs = await cache.keys()
  return reqs.map((r) => r.url)
}

// Download one item for offline use: fetch + store every URL in the content
// cache, tally the real byte size, and record one manifest entry. This is the
// ONLY function that writes to OFFLINE_CACHE. `meta` = {section, id, name,
// reader, urls} (`reader` = the engine to reopen it with — 'pdf'|'epub').
// `onProgress({loaded, total})` is called as bytes stream in (total is
// the summed Content-Length of files started so far, or null if any was
// missing) so the UI can show a real percentage — magazines can be 100+ MB.
// Returns the stored entry.
export async function downloadJob(meta, onProgress) {
  const cache = await caches.open(OFFLINE_CACHE)
  let loaded = 0
  let total = 0
  let totalKnown = true
  for (const url of meta.urls) {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`)
    const len = Number(res.headers.get('content-length'))
    if (len > 0) total += len
    else totalKnown = false
    // Stream the body so progress updates mid-file (a big PDF is one URL).
    const reader = res.body?.getReader?.()
    const chunks = []
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        onProgress?.({ loaded, total: totalKnown ? total : null })
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer())
      chunks.push(buf)
      loaded += buf.length
      onProgress?.({ loaded, total: totalKnown ? total : null })
    }
    await cache.put(url, new Response(new Blob(chunks), { headers: res.headers }))
  }
  const entry = {
    key: downloadKey(meta.section, meta.id),
    section: meta.section,
    id: meta.id,
    name: meta.name,
    reader: meta.reader,
    urls: meta.urls,
    bytes: loaded,
    date: Date.now(),
  }
  await putEntry(entry)
  return entry
}

// Remove a download: delete its cached URLs AND its manifest row, so nothing is
// left behind. Returns true if an entry existed.
export async function removeDownload(key) {
  const entry = await getEntry(key)
  if (!entry) return false
  if ('caches' in self) {
    const cache = await caches.open(OFFLINE_CACHE)
    await Promise.all((entry.urls || []).map((u) => cache.delete(u)))
  }
  await delEntry(key)
  return true
}

// Full audit: manifest vs. the real cache (catches orphan/missing bytes). The
// manifest stores URLs as passed (often relative, e.g. "/api/library/file?…")
// while Cache Storage keys by the absolute URL, so normalize BOTH to absolute
// hrefs before comparing — otherwise every item looks both orphaned and missing.
export async function auditStorage() {
  const [entries, urls] = await Promise.all([allEntries(), cachedUrls()])
  const abs = (u) => {
    try {
      return new URL(u, self.location.href).href
    } catch {
      return u
    }
  }
  const normEntries = entries.map((e) => ({ ...e, urls: (e.urls || []).map(abs) }))
  return auditCache(normEntries, urls.map(abs))
}

// On-device size of the precached app shell (the one thing cached without an
// explicit download) — summed from the real cached responses, so the storage
// manager can show it as its own honest line. 0 if the Cache API is absent.
export async function shellBytes() {
  if (!('caches' in self)) return 0
  try {
    const cache = await caches.open(SHELL_CACHE)
    const reqs = await cache.keys()
    let total = 0
    for (const req of reqs) {
      const res = await cache.match(req)
      if (res) total += (await res.blob()).size
    }
    return total
  } catch {
    return 0
  }
}

// --- quota / eviction (I/O) ------------------------------------------------

// Ask the browser to keep our offline data from being evicted under storage
// pressure. Best-effort + silent (most engines grant it for installed PWAs
// without a prompt). Returns the granted boolean, or null if unsupported.
export async function requestPersist() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* ignore */
  }
  return null
}

// The browser's own usage/quota for this origin — the independent total the
// storage manager reconciles its per-item accounting against.
export async function getEstimate() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate()
  } catch {
    /* ignore */
  }
  return {}
}
