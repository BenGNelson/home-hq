// Cache names shared between the service worker (src/sw.js) and the app's
// offline store (offlineStore.js). Kept in their own tiny, dependency-free
// module so both bundles agree on the names without pulling React into the SW.
//
// Two caches, and ONLY two, by design (the audit-grade transparency rule):
//   SHELL_CACHE   — the built app shell (html/js/css/icons). The one thing
//                   cached without an explicit download; small + fixed; the UI
//                   surfaces it as a distinct "App offline shell" line.
//   OFFLINE_CACHE — content bytes, written ONLY by an explicit "Download"
//                   action. Nothing is ever cached here implicitly.
export const SHELL_CACHE = 'hq-shell'
export const OFFLINE_CACHE = 'hq-offline'
