// A small "saved offline" indicator for a browse-list row — so you can see what
// you've downloaded without opening it (Kindle-style). Renders nothing unless
// the item is downloaded, so it's a no-op cost on rows that aren't.
export default function SavedBadge({ saved }) {
  if (!saved) return null
  return (
    <span
      title="Saved offline"
      aria-label="Saved offline"
      className="shrink-0 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300"
    >
      ✓ offline
    </span>
  )
}
