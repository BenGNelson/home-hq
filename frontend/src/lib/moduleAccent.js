// Per-module accent colors for the dashboard's clickable-widget hover. Each
// dashboard card links to its module page and, on desktop hover, lifts and takes
// on its module's signature color. Kept as raw hex so it can drive an inline CSS
// custom property (`--accent`) that static Tailwind arbitrary-value hover
// utilities consume; Tailwind can't see runtime class strings, so the color
// rides a CSS variable instead.
//
// Each value is the Tailwind 400-level (`text-*-400`) of the module's nav `tint`
// in App.jsx (`builtinModules`) — bright enough to read as an accent, soft
// enough that the hover glow never shouts. The nav `tint` is a class string
// (e.g. `text-yellow-400`), not a usable color, which is why the hex is mirrored
// here rather than derived. KEEP IN SYNC: if a module's nav tint is recolored,
// update its hex here too.
export const MODULE_ACCENT = {
  '/weather': '#38bdf8', // sky-400
  '/solar': '#facc15', // yellow-400
  '/plex': '#fb7185', // rose-400
  '/storage': '#818cf8', // indigo-400
  '/containers': '#38bdf8', // sky-400
  '/printer': '#fb923c', // orange-400
  '/adguard': '#f87171', // red-400
  '/tailscale': '#2dd4bf', // teal-400
  '/speedtest': '#e879f9', // fuchsia-400
  '/catalog': '#c084fc', // purple-400 (the Home widget links here)
}

// The shared desktop-hover treatment for a clickable card: a subtle lift plus a
// soft glow + faint border in the card's `--accent` color. Consumed by both the
// shared Widget frame and the Weather hero so the interaction language lives in
// ONE place and the two can't drift. (Tailwind v4 gates `hover:` behind
// `@media (hover: hover)`, so this never engages on touch — taps just navigate.)
export const ACCENT_HOVER =
  'group transition duration-200 will-change-transform hover:-translate-y-px ' +
  'hover:[border-color:color-mix(in_srgb,var(--accent)_50%,theme(colors.slate.700))] ' +
  'hover:[box-shadow:0_10px_28px_-20px_var(--accent)]'

// The neutral fallback (slate-500) so an unmapped-but-linkable card still gets a
// calm hover rather than `var(--accent)` resolving to nothing.
export const FALLBACK_ACCENT = '#64748b'

// Accent for a route, or the neutral fallback when the route has no mapping.
export function moduleAccent(path) {
  return MODULE_ACCENT[path] ?? FALLBACK_ACCENT
}
