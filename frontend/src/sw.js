// Home HQ service worker (custom — vite-plugin-pwa `injectManifest`).
//
// We own this file deliberately (rather than the auto-generated `generateSW`)
// so the caching is exactly what we say it is — the foundation of the offline
// feature's audit-grade transparency rule:
//
//   1. The app shell is precached (the injected `self.__WB_MANIFEST`) so the
//      PWA boots with no network. This is the ONE thing cached without an
//      explicit download; it's small + fixed and the UI shows it as its own line.
//   2. Downloaded content (OFFLINE_CACHE) is served cache-first, so a book/PDF/
//      comic you downloaded reads offline with zero reader changes (the readers
//      request the same /api URLs; we answer from cache).
//   3. EVERYTHING ELSE goes to the network and is NEVER cached here. There is no
//      runtime/opportunistic/“stale-while-revalidate” caching — the only writer
//      of content bytes is the explicit Download action (in offlineStore.js).
//      That single-writer rule is what lets the storage manager prove nothing is
//      taking up space the user didn't choose.

import { SHELL_CACHE, OFFLINE_CACHE } from './lib/offlineConfig.js'

// Injected at build time by vite-plugin-pwa: the built shell assets to precache.
const SHELL = self.__WB_MANIFEST || []
const shellUrls = () => SHELL.map((e) => (typeof e === 'string' ? e : e.url))

// --- install: precache the app shell, then take over immediately ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(shellUrls())
      await self.skipWaiting()
    })(),
  )
})

// --- activate: prune the shell cache to exactly the current build's assets
// (old hashed files from a previous deploy drop out), then claim clients. The
// OFFLINE_CACHE is never touched here — only the user adds/removes downloads. ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const wanted = new Set(shellUrls().map((u) => new URL(u, self.location.href).href))
      const have = await cache.keys()
      await Promise.all(have.map((req) => (wanted.has(req.url) ? null : cache.delete(req))))
      await self.clients.claim()
    })(),
  )
})

async function shellIndex(cache) {
  return (
    (await cache.match('/index.html')) ||
    (await cache.match('index.html')) ||
    (await cache.match('/')) ||
    Response.error()
  )
}

async function handle(request) {
  // 1) Explicitly-downloaded content → cache-first (works fully offline). The
  //    reader requested the same /api/library/file or /comics/page URL it would
  //    online; if it's in the offline cache, serve the local copy.
  const offline = await caches.open(OFFLINE_CACHE)
  const downloaded = await offline.match(request, { ignoreVary: true })
  if (downloaded) return downloaded

  // 2) Navigations → network-first so the app is always fresh online; fall back
  //    to the precached shell so it still boots offline (the SPA takes over).
  if (request.mode === 'navigate') {
    try {
      return await fetch(request)
    } catch {
      return shellIndex(await caches.open(SHELL_CACHE))
    }
  }

  // 3) A precached shell asset → cache-first.
  const shell = await caches.open(SHELL_CACHE)
  const shellHit = await shell.match(request)
  if (shellHit) return shellHit

  // 4) Everything else (live /api data, etc.) → network, never cached here. If
  //    the network fails (offline), resolve to a network-error Response rather
  //    than letting this promise REJECT — a rejected respondWith() surfaces as an
  //    ugly "FetchEvent.respondWith received an error: TypeError" in the app's
  //    error text and offers nothing better. Response.error() makes the caller's
  //    fetch fail cleanly, exactly as it would with no service worker at all.
  try {
    return await fetch(request)
  } catch {
    return Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Never intercept the isolated emulator page or its engine assets — they load
  // straight from the network as before (offline ROM play is a later phase).
  if (url.pathname.startsWith('/emulator.html') || url.pathname.startsWith('/emulatorjs/')) return
  event.respondWith(handle(request))
})
