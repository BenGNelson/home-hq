import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plane } from 'lucide-react'
import { allEntries } from '../../lib/offlineStore.js'
import { downloadHref, sectionIcon } from '../../lib/library.js'
import { formatSize } from '../../lib/format.js'

// What a Library section shows when the server is unreachable: just the items
// you've downloaded from it (straight from the on-device manifest, no server
// call) — so the section degrades to a local-first view instead of erroring.
// A section list page renders this in place of its normal content when offline.
export default function OfflineSection({ section, label }) {
  const [items, setItems] = useState(null)
  const SecIcon = sectionIcon(section)

  useEffect(() => {
    let alive = true
    allEntries()
      .then((es) => alive && setItems(es.filter((e) => e.section === section)))
      .catch(() => alive && setItems([]))
    return () => {
      alive = false
    }
  }, [section])

  const sorted = (items ?? []).slice().sort((a, b) => (b.date || 0) - (a.date || 0))

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{label}</h2>
      <div className="flex items-center gap-2 rounded-xl border border-amber-900/40 bg-amber-900/10 px-4 py-2 text-xs text-amber-200">
        <Plane className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Offline — showing the items you’ve downloaded from here.</span>
      </div>

      {items && sorted.length === 0 && (
        <p className="text-sm text-slate-400">Nothing downloaded from here yet.</p>
      )}

      {sorted.length > 0 && (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
          {sorted.map((e) => (
            <li key={e.key}>
              <Link
                to={downloadHref(e)}
                className="flex items-center gap-3 px-4 py-3 active:bg-slate-800"
              >
                <SecIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-100">{e.name}</span>
                  <span className="block text-xs text-slate-500">{formatSize(e.bytes)} · offline</span>
                </span>
                <span className="shrink-0 text-slate-600">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
