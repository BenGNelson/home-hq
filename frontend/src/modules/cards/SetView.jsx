import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import { SkeletonLine } from '../../components/ui.jsx'
import { CARDS_RGB, completionPct } from '../../lib/cards.js'
import CardImage from './CardImage.jsx'
import CardModal from './CardModal.jsx'
import WantlistModal from './WantlistModal.jsx'

// One set: its completion header + a grid of EVERY card, with the ones you own in
// full colour and the ones you don't dimmed — so the gaps in your collection read
// at a glance. An "owned only" toggle (kept in the URL) filters to what you have.
export default function SetView() {
  const { setid } = useParams()
  const { data, loading, error } = useApi(`/cards/sets/${encodeURIComponent(setid)}`, 0)
  const [params, setParams] = useSearchParams()
  const ownedOnly = params.get('owned') === '1'
  const [modalId, setModalId] = useState(null)
  const [showWantlist, setShowWantlist] = useState(false)
  // Optimistic ownership edits ({cardId: {owned, qty}}) overlaid on the fetched
  // cards, so marking a card owned is instant with no grid re-fetch/flash.
  const [edits, setEdits] = useState({})

  const setOwnedOnly = (on) => {
    const next = new URLSearchParams(params)
    if (on) next.set('owned', '1')
    else next.delete('owned')
    setParams(next, { replace: true })
  }

  const meta = data?.set
  // Overlay optimistic edits, then derive the (live) owned count + filtered grid.
  const allCards = useMemo(
    () =>
      (data?.cards ?? []).map((c) =>
        edits[c.id] ? { ...c, owned: edits[c.id].owned, owned_qty: edits[c.id].qty } : c,
      ),
    [data, edits],
  )
  const ownedCount = allCards.filter((c) => c.owned).length
  const cards = ownedOnly ? allCards.filter((c) => c.owned) : allCards

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
        <Link to="/cards" className="hover:text-slate-200">
          Cards
        </Link>
        <span className="px-1 text-slate-600">/</span>
        <span className="text-slate-200">{meta?.name || setid}</span>
      </nav>

      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {loading && !data && <HeaderSkeleton />}

      {meta && (
        <>
          <header className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold">{meta.name}</h2>
              <span className="shrink-0 text-sm tabular-nums text-slate-400">
                {ownedCount.toLocaleString()} / {meta.card_count.toLocaleString()} ·{' '}
                {completionPct(ownedCount, meta.card_count)}%
              </span>
            </div>
            <span className="block h-1.5 overflow-hidden rounded bg-slate-800">
              <span
                className="block h-full"
                style={{
                  width: `${completionPct(ownedCount, meta.card_count)}%`,
                  background: `rgb(${CARDS_RGB})`,
                }}
              />
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={ownedOnly}
                  onChange={(e) => setOwnedOnly(e.target.checked)}
                  className="accent-fuchsia-500"
                />
                Owned only
              </label>
              {meta.card_count - ownedCount > 0 && (
                <button
                  onClick={() => setShowWantlist(true)}
                  className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-sm font-medium text-fuchsia-200 active:scale-95"
                >
                  Buy missing ({(meta.card_count - ownedCount).toLocaleString()})
                </button>
              )}
            </div>
          </header>

          {cards.length === 0 ? (
            <p className="text-sm text-slate-400">
              {ownedOnly ? 'You don’t own any cards from this set yet.' : 'No cards in this set.'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setModalId(c.id)}
                  className="block text-left active:scale-95"
                  title={c.name}
                >
                  <CardImage card={c} dim={!c.owned} />
                  <span className="mt-1 block truncate text-xs text-slate-400">#{c.number}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {modalId && (
        <CardModal
          cardId={modalId}
          onClose={() => setModalId(null)}
          onMutated={(id, patch) => setEdits((e) => ({ ...e, [id]: patch }))}
        />
      )}
      {showWantlist && meta && (
        <WantlistModal
          url={`/cards/sets/${encodeURIComponent(setid)}/wantlist`}
          title={`${meta.name} — cards you don’t own yet`}
          onClose={() => setShowWantlist(false)}
        />
      )}
    </div>
  )
}

function HeaderSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <SkeletonLine className="h-6 w-40" />
      <SkeletonLine className="h-2 w-full" />
    </div>
  )
}
