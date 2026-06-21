// Nav grouping for the sidebar. The module registry (App.jsx) is a flat,
// ordered list where each entry carries a `group`. groupModules folds it into
// ordered sections — one per group, in the order each group first appears —
// so the sidebar can render labeled headers without the registry needing to
// know anything about layout. Adding a module is still one registry entry; its
// `group` decides where it lands.

// The group rendered apart at the bottom of the sidebar: reference docs, not
// functional modules. Everything else is a top-of-sidebar nav section.
export const FOOTER_GROUP = 'Docs'

export function groupModules(modules) {
  const order = []
  const byGroup = new Map()
  for (const m of modules) {
    const group = m.group || ''
    if (!byGroup.has(group)) {
      byGroup.set(group, [])
      order.push(group)
    }
    byGroup.get(group).push(m)
  }
  return order.map((group) => ({ group, items: byGroup.get(group) }))
}

// "Close" / exit navigation for an overlay (a reader): return to where you came
// from. If there's in-app history to go back to (React Router tracks a numeric
// `idx` on history.state), go back one — that restores the prior screen AND its
// scroll position, and offline it lands you back on whatever opened the reader
// (the Downloads/hub view), not a dead section list. Otherwise (deep link, fresh
// PWA open) fall through to an explicit fallback route.
export function goBackTarget(historyIdx, fallback) {
  return historyIdx > 0 ? -1 : fallback
}

export function goBack(navigate, fallback) {
  const idx = (typeof window !== 'undefined' && window.history.state?.idx) || 0
  navigate(goBackTarget(idx, fallback))
}

// The module a given route belongs to, by longest matching path prefix — so a
// deep route (e.g. /plex/movie/123) resolves to its section ("Plex"), and a
// more specific entry (/plex/insights) wins over its parent (/plex). Returns
// null when nothing matches. The shell uses the result's `label` as the page
// title in the top bar. External links (no client route) never match.
export function activeModule(modules, pathname) {
  let best = null
  for (const m of modules) {
    if (m.external || !m.path) continue
    const isMatch = pathname === m.path || pathname.startsWith(m.path + '/')
    if (isMatch && (!best || m.path.length > best.path.length)) best = m
  }
  return best
}
