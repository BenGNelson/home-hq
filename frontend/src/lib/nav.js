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
