import { X } from 'lucide-react'

// The ✕ circle that drops an item from a shelf ("Jump back in" / "Recently
// played"). It clears only the marker (last-played / bookmark) — never the saved
// files. On desktop hover the circle darkens and pops slightly while the ✕ tints
// rose: a gentle "remove" cue, not a danger shout (matches the app's rose =
// destructive accent). Touch just taps. Pass `className` for position + size.
export default function RemoveButton({ onClick, label, className = '' }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation() // don't also trigger the card's resume/open
        onClick()
      }}
      aria-label={label}
      className={`flex items-center justify-center rounded-full bg-black/70 text-slate-100 shadow transition hover:scale-110 hover:bg-black/80 hover:text-rose-300 active:scale-95 active:bg-black/90 ${className}`}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}
