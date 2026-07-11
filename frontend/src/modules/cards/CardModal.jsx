import { useEffect, useState } from 'react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { formatUsd, CARDS_RGB } from '../../lib/cards.js'
import { glowFilter } from '../../lib/glow.js'
import { formatAgo } from '../../lib/format.js'
import CardImage from './CardImage.jsx'

// A card detail overlay, opened over a grid. Fetches the full card (metadata +
// market price + your ownership) and lets you edit your ownership — mark it
// owned, set a quantity, or add it to your wishlist. Those edits are `manual`
// (they survive a later Pokéllector re-import). Closes on backdrop click / Escape.
// `onMutated` lets the parent refresh its grid/stats after a change.
export default function CardModal({ cardId, onClose, onMutated }) {
  const { data, loading } = useApi(cardId ? `/cards/card/${encodeURIComponent(cardId)}` : null, 0)
  const [busy, setBusy] = useState(false)
  // Optimistic override of the `normal`-variant ownership ({qty, wishlist}), so
  // toggling is instant with no re-fetch/flash. Null = show the server's state.
  // Reset when the modal switches cards (the component stays mounted).
  const [local, setLocal] = useState(null)
  useEffect(() => setLocal(null), [cardId])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!cardId) return null
  const usd = data ? formatUsd(data.tcgplayer_usd) : null
  // Editing operates on the `normal` variant (what the Pokéllector import uses);
  // any other owned variants (e.g. an imported holofoil) show read-only below.
  const baseNormal = data?.ownership?.find((o) => o.variant === 'normal')
  const eff = local ?? {
    qty: baseNormal?.qty ?? 0,
    wishlist: !!(baseNormal && baseNormal.qty === 0 && baseNormal.wishlist),
  }
  const isOwned = eff.qty > 0
  const isWishlist = eff.qty === 0 && eff.wishlist
  const qty = eff.qty
  const others = data?.ownership?.filter((o) => o.variant !== 'normal' && o.qty > 0) ?? []

  // Optimistically apply `next` ({qty, wishlist}) to the UI + parent grid, then
  // persist. On failure, roll the optimistic state back.
  const apply = async (next, method, body) => {
    if (busy) return
    const prev = local
    setLocal(next)
    setBusy(true)
    onMutated?.(cardId, { owned: next.qty > 0, qty: next.qty })
    try {
      let url = `${API_BASE}/cards/ownership`
      const opts = { method }
      if (method === 'PUT') {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(body)
      } else {
        url += `?card_id=${encodeURIComponent(body.card_id)}&variant=${encodeURIComponent(body.variant)}`
      }
      const res = await fetch(url, opts)
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`)
    } catch {
      setLocal(prev) // revert on failure
      const back = prev ?? { qty: baseNormal?.qty ?? 0 }
      onMutated?.(cardId, { owned: (back.qty ?? 0) > 0, qty: back.qty ?? 0 })
    } finally {
      setBusy(false)
    }
  }

  const markOwned = () =>
    apply({ qty: 1, wishlist: false }, 'PUT', { card_id: cardId, variant: 'normal', qty: 1, wishlist: false })
  const unown = () =>
    apply({ qty: 0, wishlist: false }, 'DELETE', { card_id: cardId, variant: 'normal' })
  const setQty = (n) =>
    n <= 0
      ? unown()
      : apply({ qty: n, wishlist: false }, 'PUT', { card_id: cardId, variant: 'normal', qty: n, wishlist: false })
  const toggleWishlist = () =>
    isWishlist
      ? unown()
      : apply({ qty: 0, wishlist: true }, 'PUT', { card_id: cardId, variant: 'normal', qty: 0, wishlist: true })

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
                    <div className="text-[11px] text-slate-500">as of {formatAgo(data.price_updated)}</div>
                  )}
                </div>
              )}

              {/* Editable ownership. */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-xs uppercase tracking-wide text-fuchsia-400">Your collection</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {isOwned ? (
                    <>
                      <span className="rounded-lg bg-fuchsia-500/15 px-2.5 py-1 text-sm font-medium text-fuchsia-200">
                        Owned
                      </span>
                      <div className="flex items-center gap-1">
                        <StepBtn onClick={() => setQty(qty - 1)} disabled={busy} label="−" aria="Decrease quantity" />
                        <span className="w-6 text-center text-sm tabular-nums text-slate-200">{qty}</span>
                        <StepBtn onClick={() => setQty(qty + 1)} disabled={busy} label="+" aria="Increase quantity" />
                      </div>
                      <button
                        onClick={unown}
                        disabled={busy}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-sm text-slate-300 active:scale-95 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={markOwned}
                        disabled={busy}
                        className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-sm font-medium text-fuchsia-200 active:scale-95 disabled:opacity-50"
                      >
                        Mark owned
                      </button>
                      <button
                        onClick={toggleWishlist}
                        disabled={busy}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium active:scale-95 disabled:opacity-50 ${
                          isWishlist
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                            : 'border-slate-700 text-slate-300'
                        }`}
                      >
                        {isWishlist ? 'On wishlist ✓' : 'Wishlist'}
                      </button>
                    </>
                  )}
                </div>
                {others.length > 0 && (
                  <ul className="mt-2 text-xs text-slate-500">
                    {others.map((o) => (
                      <li key={o.variant}>
                        also owned: {o.qty}× {o.variant}
                        {o.condition ? ` · ${o.condition}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  Your edits here survive a Pokéllector re-import.
                </p>
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

function StepBtn({ onClick, disabled, label, aria }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-200 active:scale-95 disabled:opacity-50"
    >
      {label}
    </button>
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
