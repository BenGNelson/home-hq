import { useMemo, useState } from 'react'
import { Spinner } from './ui.jsx'

// Compare two values for sorting, pushing empty/null to the end either way.
function compare(a, b, order) {
  const an = a == null || a === ''
  const bn = b == null || b === ''
  if (an || bn) return an === bn ? 0 : an ? 1 : -1
  let c
  if (typeof a === 'string' && typeof b === 'string') c = a.localeCompare(b)
  else c = a < b ? -1 : a > b ? 1 : 0
  return order === 'asc' ? c : -c
}

// A searchable, client-sorted table for a list of media items. The data is
// small enough to load whole, so search/sort happen in the browser (instant).
// Columns: { key (sort key, null = not sortable), label, get(item) (sort value),
// cell(item) (rendered value), cls (alignment + responsive hiding) }.
// Lives in a flex-1 scroll box with a sticky header so it fills to the bottom.
export default function MediaTable({
  columns,
  items,
  loading,
  error,
  defaultSort,
  emptyMessage = 'Nothing here yet.',
  searchPlaceholder = 'Search titles…',
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState(defaultSort?.key ?? columns[0].key)
  const [order, setOrder] = useState(defaultSort?.order ?? 'asc')

  const visible = useMemo(() => {
    const col = columns.find((c) => c.key === sort) ?? columns[0]
    const q = search.trim().toLowerCase()
    const filtered = q
      ? items.filter((i) => i.title.toLowerCase().includes(q))
      : items
    return [...filtered].sort((a, b) => compare(col.get(a), col.get(b), order))
  }, [items, search, sort, order, columns])

  function toggleSort(col) {
    if (!col) return
    if (sort === col) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSort(col)
      setOrder(col === 'title' ? 'asc' : 'desc') // text asc, metrics desc
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-slate-500 focus:outline-none"
        />
        <span className="text-xs text-slate-500">
          {visible.length.toLocaleString()}
          {search ? ` of ${items.length.toLocaleString()}` : ''}{' '}
          {visible.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : loading ? (
        <Spinner label="loading…" />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500">No titles match your search.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900 shadow-sm shadow-slate-950">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                {columns.map((c) => (
                  <th
                    key={c.label}
                    onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 font-medium ${c.cls} ${
                      c.key ? 'cursor-pointer select-none hover:text-slate-300' : ''
                    }`}
                  >
                    {c.label}
                    {sort === c.key && (
                      <span className="ml-1">{order === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {visible.map((item) => (
                <tr key={item.rating_key} className="hover:bg-slate-900/40">
                  {columns.map((c) => (
                    <td key={c.label} className={`px-3 py-2 text-slate-300 ${c.cls}`}>
                      {c.cell(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
