// Optional, gitignored host-specific notes merged into the UI at runtime.
// Loaded via import.meta.glob so the build works whether or not host.local.jsx
// exists — committed code stays generic; your instance drops in private detail.
const mods = import.meta.glob('../modules/guide/host.local.jsx', { eager: true })
const host = Object.values(mods)[0] ?? {}

// Per-container notes keyed by container name: { displayName, displayImage,
// hideImage, purpose, url }. See host.local.jsx for the shape.
export const containerNotes = host.containerNotes ?? {}

// Build a container's web-UI link from an opt-in `url` spec. Pure (no globals)
// so it's unit-testable. `spec` may be:
//   • a string — used verbatim (an absolute URL)
//   • { port, scheme?, path? } — assembled against `hostname`, so the same
//     config resolves correctly whether you reach the box by LAN IP or by its
//     Tailscale name. Returns null when there's nothing meaningful to link to.
export function buildUrl(spec, hostname) {
  if (!spec) return null
  if (typeof spec === 'string') return spec
  if (spec.port == null && spec.path == null) return null
  const scheme = spec.scheme ?? 'http'
  const port = spec.port != null ? `:${spec.port}` : ''
  return `${scheme}://${hostname}${port}${spec.path ?? ''}`
}

// Resolve a container's web-UI link for the CURRENT origin. Opt-in per
// container (not every published port is a web UI, and only what a reverse
// proxy fronts is reachable over the tailnet). Returns null when unconfigured.
export function containerUrl(name) {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return buildUrl(containerNotes[name]?.url, hostname)
}

// Optional host-specific external nav links — e.g. a deep-link to Home
// Assistant so HQ (the infra cockpit) can hand off to HA (the smart-home brain)
// for control, without rebuilding a smart-home UI here. Declared in the
// gitignored host.local.jsx as `navLinks`, since the target host/port is
// instance-specific. Pure (no globals) so it's unit-testable: takes the raw
// list + hostname, resolves each `url` spec against that hostname (so the same
// entry works on the LAN or over Tailscale), marks them `external`, and drops
// any that don't resolve to a link. Returns [] when none are configured, so the
// sidebar simply shows nothing.
export function buildNavLinks(links, hostname) {
  return (links ?? [])
    .map((l) => ({ ...l, external: true, path: buildUrl(l.url, hostname) }))
    .filter((l) => l.path)
}

// Resolve the host-local nav links for the CURRENT origin.
export function hostNavLinks() {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return buildNavLinks(host.navLinks, hostname)
}

// Resolve ONE host-local nav link's external URL by id, for handing an in-app
// route off to a sibling standalone app (e.g. the Frog games app that Games
// became). Returns null when that link isn't configured — so a generic clone
// without host.local.jsx falls back gracefully rather than dead-ending. Pure core
// (raw list + hostname) so it's unit-testable.
export function appLinkFromLinks(links, id, hostname) {
  const link = (links ?? []).find((l) => l.id === id)
  return link ? buildUrl(link.url, hostname) : null
}
export function appLinkUrl(id) {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return appLinkFromLinks(host.navLinks, id, hostname)
}

// Deep-link into Home Assistant for a given path (e.g. an entity's history),
// reusing the SAME `home-assistant` navLink url spec the sidebar uses — so the
// host/port stays only in the gitignored host.local.jsx and resolves correctly
// over LAN or Tailscale. Returns null when no HA link is configured, so the
// caller can render plain text instead of a dead link. Pure aside from reading
// the current hostname; the spec/path assembly is handled by the tested buildUrl.
// Pure core (takes the raw navLinks + hostname) so it's unit-testable; returns
// null when there's no usable home-assistant link.
export function haDeepLink(navLinks, hostname, pathSuffix = '') {
  const ha = (navLinks ?? []).find((l) => l.id === 'home-assistant')
  if (!ha || !ha.url) return null
  if (typeof ha.url === 'string') return ha.url + pathSuffix
  return buildUrl({ ...ha.url, path: (ha.url.path ?? '') + pathSuffix }, hostname)
}

export function homeAssistantUrl(pathSuffix = '') {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return haDeepLink(host.navLinks, hostname, pathSuffix)
}
