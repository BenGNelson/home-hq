import { useEffect } from 'react'
import { useApi } from '../../lib/useApi.js'
import { formatUsd, CARDS_RGB } from '../../lib/cards.js'
import { glowFilter } from '../../lib/glow.js'
import { formatAgo } from '../../lib/format.js'
import CardImage from './CardImage.jsx'

// A card detail overlay, opened over a grid. Fetches the full card (metadata +
// market price + your ownership) on open. Closes on backdrop click or Escape.
export default function CardModal({ cardId, onClose }) {
  const { data, loading } = useApi(cardId ? `/cards/card/${encodeURIComponent(cardId)}` : null, 0)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!cardId) return null
  const usd = data ? formatUsd(data.tcgplayer_usd) : null
  const owned = data?.ownership?.filter((o) => o.qty > 0) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-fuchsia-500/25 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-slate-300 active:scale-95"
        >
          ✕
        </button>

        {loading && !data ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-500">loading…</div>
        ) : data ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="mx-auto w-40 shrink-0 sm:mx-0" style={{ filter: glowFilter(CARDS_RGB, 0.45) }}>
              <CardImage card={data} size="large" className="w-full" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">{data.name}</h2>
                <p className="text-sm text-slate-400">
                  {data.set_name} · #{data.number}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {data.rarity && <Field label="Rarity" value={data.rarity} />}
                {data.supertype && <Field label="Type" value={data.supertype} />}
                {data.types?.length > 0 && <Field label="Energy" value={data.types.join(', ')} />}
                {data.hp && <Field label="HP" value={data.hp} />}
                {data.artist && <Field label="Artist" value={data.artist} />}
              </dl>

              {usd && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Market value</div>
                  <div className="text-xl font-semibold text-slate-100">{usd}</div>
                  {data.price_updated && (
                    <div className="text-[11px] text-slate-500">
                      as of {formatAgo(data.price_updated)}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                {owned.length > 0 ? (
                  <>
                    <div className="text-xs uppercase tracking-wide text-fuchsia-400">In your collection</div>
                    <ul className="mt-1 space-y-0.5 text-slate-300">
                      {owned.map((o) => (
                        <li key={o.variant}>
                          {o.qty}× {o.variant}
                          {o.condition ? ` · ${o.condition}` : ''}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <span className="text-slate-500">Not in your collection yet.</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-rose-400">Couldn’t load this card.</p>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate text-slate-200">{value}</dd>
    </>
  )
}
