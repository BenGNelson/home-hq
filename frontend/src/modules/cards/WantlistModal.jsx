import { useState } from 'react'
import { useApi } from '../../lib/useApi.js'
import { MASSENTRY_URL } from '../../lib/cards.js'

// The buy-helper: shows the cards you're missing (in a set, or across your whole
// collection) as a TCGplayer Mass Entry want-list. Copy it, open Mass Entry,
// paste, then optimize the cart to the fewest sellers to minimize shipping —
// TCGplayer does the seller-matching; we just generate the list. Fetches its own
// data from `url` (a /cards/…/wantlist endpoint).
export default function WantlistModal({ url, title, onClose }) {
  const { data, error, loading } = useApi(url, 0)
  const [copied, setCopied] = useState(false)
  const text = (data?.lines ?? []).join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false) // clipboard blocked (rare) — the textarea is selectable as a fallback
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-fuchsia-500/25 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300 active:scale-95"
        >
          ✕
        </button>

        <h2 className="text-lg font-semibold text-slate-100">Buy missing cards</h2>
        <p className="mt-0.5 text-sm text-slate-400">{title}</p>

        {loading && !data ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-500">building list…</div>
        ) : error && !data ? (
          // Guard against the error state falling through to the "you've got them
          // all" message — a failed fetch is not a complete collection.
          <p className="mt-4 text-sm text-rose-400">Couldn’t build the list — {error}.</p>
        ) : data && data.missing > 0 ? (
          <>
            <p className="mt-3 text-sm text-slate-300">
              <span className="font-semibold text-fuchsia-300">{data.missing.toLocaleString()}</span> cards to
              go. Copy this list, open TCGplayer Mass Entry, paste it, then in the cart choose{' '}
              <span className="text-slate-200">Optimize → fewest sellers</span> to cut shipping.
            </p>
            <textarea
              readOnly
              value={text}
              onFocus={(e) => e.target.select()}
              className="mt-3 h-48 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={copy}
                className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-4 py-2 text-sm font-medium text-fuchsia-200 active:scale-95"
              >
                {copied ? 'Copied ✓' : 'Copy list'}
              </button>
              <a
                href={MASSENTRY_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 active:scale-95"
              >
                Open TCGplayer Mass Entry ↗
              </a>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            Nothing missing here — you’ve got them all. 🎉
          </p>
        )}
      </div>
    </div>
  )
}
