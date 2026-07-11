import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useApi } from '../../lib/useApi.js'
import CardImage from './CardImage.jsx'
import CardModal from './CardModal.jsx'

// Search across every card by name, with an "owned only" toggle. Both the query
// and the toggle live in the URL (?q=&owned=1) so a search is refresh/share-safe
// and survives opening a card. Results dim the cards you don't own.
export default function Search() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const ownedOnly = params.get('owned') === '1'
  const [modalId, setModalId] = useState(null)
  // Optimistic ownership edits overlaid on results (instant dim/un-dim, no re-fetch).
  const [edits, setEdits] = useState({})

  const patch = (mut) => {
    const next = new URLSearchParams(params)
    mut(next)
    setParams(next, { replace: true })
  }
  const setQuery = (val) => patch((n) => (val ? n.set('q', val) : n.delete('q')))
  const setOwnedOnly = (on) => patch((n) => (on ? n.set('owned', '1') : n.delete('owned')))

  // Debounce isn't needed — the query is a substring LIKE over an indexed name
  // column; the endpoint caps results. Poll off (0): re-runs on URL change only.
  const q = encodeURIComponent(query.trim())
  const { data, loading } = useApi(`/cards/search?q=${q}&owned=${ownedOnly ? 1 : 0}`, 0)
  const items = (data?.items ?? []).map((c) =>
    edits[c.id] ? { ...c, owned: edits[c.id].owned } : c,
  )

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-400">
        <Link to="/cards" className="hover:text-slate-200">
          Cards
        </Link>
        <span className="px-1 text-slate-600">/</span>
        <span className="text-slate-200">Search</span>
      </nav>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={data ? `Search ${data.total.toLocaleString()} cards…` : 'Search cards…'}
        aria-label="Search cards"
        autoFocus
        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus:border-fuchsia-500/50"
      />
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={ownedOnly}
          onChange={(e) => setOwnedOnly(e.target.checked)}
          className="accent-fuchsia-500"
        />
        Owned only
      </label>

      {loading && !data ? (
        <p className="text-sm text-slate-500">searching…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">
          {query.trim() || ownedOnly ? 'No matching cards.' : 'Type to search, or browse a set.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((c) => (
            <button
              key={c.id}
              onClick={() => setModalId(c.id)}
              className="block text-left active:scale-95"
              title={c.name}
            >
              <CardImage card={c} dim={!c.owned} />
              <span className="mt-1 block truncate text-xs text-slate-300">{c.name}</span>
            </button>
          ))}
        </div>
      )}

      {modalId && (
        <CardModal
          cardId={modalId}
          onClose={() => setModalId(null)}
          onMutated={(id, patch) => setEdits((e) => ({ ...e, [id]: patch }))}
        />
      )}
    </div>
  )
}
