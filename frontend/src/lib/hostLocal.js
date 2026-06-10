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
