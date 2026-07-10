import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { radiantBackdrop, glowFilter } from '../../lib/glow.js'
import { SkeletonLine } from '../../components/ui.jsx'
import { CARDS_RGB, setHref, cardsSearchHref, completionPct, formatUsd } from '../../lib/cards.js'
import CardImage from './CardImage.jsx'
import CardModal from './CardModal.jsx'
import WantlistModal from './WantlistModal.jsx'

// The Cards hub: your Pokémon TCG collection. A back-lit stats hero (the one
// radiance moment), a show-off wall of the cards you own, and a grid of every
// set with a completion bar. Ownership is seeded by importing a Pokéllector
// export and then managed in HQ. Mobile-first, like the Library hub.
export default function Cards() {
  // The indexer status polls a little faster so the first-run "building the
  // catalog…" state clears promptly once the ~20k-card ingest finishes.
  const { data: sync } = useApi('/cards/sync-status', 10000)
  const { data: stats } = useApi('/cards/stats', 60000)
  const { data: setsData, loading, error } = useApi('/cards/sets', 60000)
  const { data: showcase } = useApi('/cards/search?owned=1&limit=24', 60000)
  const [modalId, setModalId] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [showWantlist, setShowWantlist] = useState(false)
  const navigate = useNavigate()

  // The catalog clone isn't mounted — nothing to browse yet.
  if (sync && !sync.configured) return <NotConfigured />

  const sets = setsData?.sets ?? []
  const owned = showcase?.items ?? []
  // "Building…" only makes sense while the indexer is actually enabled — with it
  // disabled and nothing indexed, fall through to the (empty) hub instead of a
  // spinner that never resolves.
  const catalogEmpty = sync && sync.indexed === 0 && sync.enabled

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">Pokémon Cards</h2>
        <div className="ml-auto flex items-center gap-2">
          {(stats?.owned_unique ?? 0) > 0 && (
            <button
              onClick={() => setShowWantlist(true)}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 active:scale-95"
            >
              Shopping list
            </button>
          )}
          <ImportButton onResult={setImportResult} />
        </div>
      </div>

      {importResult && (
        <ImportBanner result={importResult} onDismiss={() => setImportResult(null)} />
      )}

      {catalogEmpty ? (
        <BuildingCatalog sync={sync} />
      ) : (
        <>
          <Hero stats={stats} />

          <form
            onSubmit={(e) => {
              e.preventDefault()
              navigate(cardsSearchHref(new FormData(e.target).get('q')?.trim() || ''))
            }}
          >
            <input
              name="q"
              type="search"
              placeholder="Search every card by name…"
              aria-label="Search cards"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-fuchsia-500/50"
            />
          </form>

          <ShowcaseWall cards={owned} stats={stats} onOpen={setModalId} />
          <SetsGrid sets={sets} loading={loading && !setsData} error={error} />
        </>
      )}

      {modalId && <CardModal cardId={modalId} onClose={() => setModalId(null)} />}
      {showWantlist && (
        <WantlistModal
          url="/cards/wantlist"
          title="Every card you’re missing from the sets you’re collecting"
          onClose={() => setShowWantlist(false)}
        />
      )}
    </div>
  )
}

// The back-lit hero: headline collection figures on a fuchsia radiance. The one
// glowing surface (the sets grid below stays calm) — per the back-lit motif.
function Hero({ stats }) {
  const s = stats ?? {}
  const value = formatUsd(s.total_value_usd)
  const tiles = [
    { label: 'Cards owned', value: fmt(s.owned_unique) },
    { label: 'Total copies', value: fmt(s.owned_total_qty) },
    { label: 'Sets completed', value: `${fmt(s.sets_completed)}${s.sets ? ` / ${fmt(s.sets)}` : ''}` },
    { label: 'Catalog complete', value: s.completion_pct != null ? `${s.completion_pct}%` : '—' },
  ]
  if (value) tiles.push({ label: 'Market value', value })

  return (
    <div
      className="rounded-2xl border p-4 sm:p-5"
      style={{ borderColor: `rgba(${CARDS_RGB},0.35)`, background: radiantBackdrop(CARDS_RGB, 0.18) }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0">
            <div
              className="text-2xl font-semibold tabular-nums text-slate-100"
              style={{ filter: glowFilter(CARDS_RGB, 0.35) }}
            >
              {t.value}
            </div>
            <div className="truncate text-xs uppercase tracking-wide text-slate-400">{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// The show-off wall: the cards you own, big. Empty until you import a collection.
function ShowcaseWall({ cards, stats, onOpen }) {
  if (!cards.length) {
    return (
      <section className="space-y-2">
        <ShelfHeading>Your collection</ShelfHeading>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          Nothing here yet. Use <span className="text-slate-200">Import</span> above to bring your
          Pokéllector collection in, then it’ll show off here.
        </div>
      </section>
    )
  }
  const total = stats?.owned_unique ?? cards.length
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <ShelfHeading>Your collection</ShelfHeading>
        <Link to={cardsSearchHref('') + '?owned=1'} className="text-xs text-slate-400 active:text-slate-200">
          {total > cards.length ? `See all ${fmt(total)} ›` : 'Search yours ›'}
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {cards.map((c) => (
          <button key={c.id} onClick={() => onOpen(c.id)} className="block text-left active:scale-95">
            <CardImage card={c} />
          </button>
        ))}
      </div>
    </section>
  )
}

// Every set as a calm typographic tile with a completion bar (no external logos —
// the CSP is img-src 'self', so set art would be blocked; the card faces inside a
// set carry the visuals). Newest release first.
function SetsGrid({ sets, loading, error }) {
  return (
    <section className="space-y-2">
      <ShelfHeading>Sets</ShelfHeading>
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
              <SkeletonLine className="h-4 w-28" />
              <SkeletonLine className="mt-3 h-2 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sets.map((s) => (
            <SetCard key={s.setid} s={s} />
          ))}
        </div>
      )}
    </section>
  )
}

function SetCard({ s }) {
  const pct = completionPct(s.owned, s.card_count)
  const year = s.release_date ? s.release_date.slice(0, 4) : null
  return (
    <Link
      to={setHref(s.setid)}
      className="block rounded-2xl border border-slate-800 bg-slate-900/60 p-4 transition-colors active:bg-slate-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-slate-100">{s.name}</span>
        {year && <span className="shrink-0 text-xs text-slate-500">{year}</span>}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
        <span className="truncate">{s.series || ' '}</span>
        <span className="shrink-0 tabular-nums">
          {fmt(s.owned)} / {fmt(s.card_count)}
        </span>
      </div>
      <span className="mt-2 block h-1.5 overflow-hidden rounded bg-slate-800">
        <span
          className="block h-full"
          style={{ width: `${pct}%`, background: `rgb(${CARDS_RGB})` }}
        />
      </span>
    </Link>
  )
}

// Upload a Pokéllector export (CSV/JSON). Seeds/refreshes the collection.
function ImportButton({ onResult }) {
  const [busy, setBusy] = useState(false)
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`${API_BASE}/cards/ownership/import`, { method: 'POST', body })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onResult(await res.json())
    } catch (err) {
      onResult({ error: err.message })
    } finally {
      setBusy(false)
      e.target.value = '' // allow re-importing the same file
    }
  }
  return (
    <label className="cursor-pointer rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-sm font-medium text-fuchsia-200 active:scale-95">
      {busy ? 'Importing…' : 'Import'}
      <input type="file" accept=".csv,.json,text/csv,application/json" onChange={onFile} className="hidden" />
    </label>
  )
}

function ImportBanner({ result, onDismiss }) {
  const ok = !result.error
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
        ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'
      }`}
    >
      <div className="min-w-0">
        {ok ? (
          <>
            <span className="text-slate-200">
              Imported <span className="font-semibold">{fmt(result.imported)}</span> cards
              {result.skipped > 0 && ` · ${fmt(result.skipped)} kept from your edits`}
              {result.unmatched?.length > 0 && ` · ${fmt(result.unmatched.length)} unmatched`}.
            </span>
            {result.unmatched?.length > 0 && (
              <p className="mt-1 truncate text-xs text-slate-500">
                No catalog match: {result.unmatched.slice(0, 8).join(', ')}
                {result.unmatched.length > 8 ? '…' : ''}
              </p>
            )}
          </>
        ) : (
          <span className="text-rose-300">Import failed — {result.error}</span>
        )}
      </div>
      <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-slate-500 active:text-slate-300">
        ✕
      </button>
    </div>
  )
}

function BuildingCatalog({ sync }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-slate-200">Building the card catalog…</p>
      <p className="mt-2 text-sm text-slate-400">
        Indexing every Pokémon set — this runs once and takes a moment
        {sync?.total ? ` (${fmt(sync.processed)} / ${fmt(sync.total)} cards)` : ''}. It’ll fill in
        automatically.
      </p>
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Pokémon Cards</h2>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <p className="text-amber-400">Card catalog not set up yet.</p>
        <p className="mt-2 text-sm text-slate-400">
          Clone the public{' '}
          <code className="rounded bg-slate-800 px-1">pokemon-tcg-data</code> dataset to a folder and
          point <code className="rounded bg-slate-800 px-1">CARD_DATA_SRC</code> at it in{' '}
          <code className="rounded bg-slate-800 px-1">.env</code>. The catalog (every set + card)
          then indexes automatically; card images are fetched on demand. See the Server Guide.
        </p>
      </div>
    </div>
  )
}

function ShelfHeading({ children }) {
  return <h3 className="text-sm font-medium uppercase tracking-wide text-slate-500">{children}</h3>
}

function fmt(n) {
  return (n ?? 0).toLocaleString()
}
