import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { Row } from '../../components/ui.jsx'
import SyncControl from '../../components/SyncControl.jsx'
import RecentlyAdded from './RecentlyAdded.jsx'

// Pretty label for a library type.
const TYPE_LABEL = { movie: 'Movies', show: 'TV', artist: 'Music', photo: 'Photos' }

export default function Plex() {
  const status = useApi('/plex', 5000)
  const libs = useApi('/plex/libraries', 30000)
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState(null)

  // Fetch the full content manifest and save it as a JSON file in the browser.
  // This is the on-demand "backup what I own" action.
  async function downloadBackup() {
    setBusy(true)
    setExportError(null)
    try {
      const res = await fetch(`${API_BASE}/plex/export`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.reachable) throw new Error(data.error || 'Plex unreachable')
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `plex-content-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const s = status.data
  // Sort alphabetically so related libraries (e.g. the "Anime …" ones) group.
  const libraries = [...(libs.data?.libraries ?? [])].sort((a, b) =>
    a.title.localeCompare(b.title),
  )
  const reachable = s && s.configured && s.reachable

  return (
    <div>

      {/* Server status card */}
      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        {!s ? (
          <p className="text-sm text-slate-500">loading…</p>
        ) : !s.configured ? (
          <p className="text-sm text-slate-500">not configured</p>
        ) : !s.reachable ? (
          <p className="text-sm text-amber-400">unreachable</p>
        ) : (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <Row label="Server" value={s.server_name} />
            <Row label="Version" value={s.version} />
            <Row
              label="Streams"
              value={
                <span className={s.streams > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                  {s.streams}
                </span>
              }
            />
          </dl>
        )}
      </section>

      {reachable && <RecentlyAdded />}

      {/* Libraries */}
      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-slate-300">Libraries</h3>
          <SyncControl />
        </div>
        {libs.error ? (
          <p className="text-sm text-rose-400">unavailable — {libs.error}</p>
        ) : libraries.length === 0 ? (
          <p className="text-sm text-slate-500">loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 font-medium">Library</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Items</th>
                <th className="pb-2 text-right font-medium">Episodes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {libraries.map((l) => {
                // Only movie/show libraries are cached/browsable for now.
                const browsable = l.type === 'movie' || l.type === 'show'
                return (
                  <tr key={l.title} className="hover:bg-slate-900/40">
                    <td className="py-2">
                      {browsable ? (
                        <Link
                          to={`/plex/library/${l.key}`}
                          className="font-medium text-emerald-400 hover:underline"
                        >
                          {l.title} →
                        </Link>
                      ) : (
                        <span className="text-slate-200">{l.title}</span>
                      )}
                    </td>
                    <td className="py-2 text-slate-400">{TYPE_LABEL[l.type] ?? l.type}</td>
                    <td className="py-2 text-right tabular-nums text-slate-200">{l.count}</td>
                    <td className="py-2 text-right tabular-nums text-slate-400">
                      {l.episodes ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Content backup */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-1 text-sm font-medium text-slate-300">Content backup</h3>
        <p className="mb-3 text-xs text-slate-400">
          Download a JSON manifest of every title in every library — a record of
          what you own, in case the library is ever lost. Titles only; no files
          or paths.
        </p>
        <button
          onClick={downloadBackup}
          disabled={busy || !reachable}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Generating…' : 'Download content backup'}
        </button>
        {exportError && <p className="mt-2 text-sm text-rose-400">{exportError}</p>}
      </section>

      {/* Insights — a one-line bar linking to the activity-trends page (moved
          here out of the sidebar so it lives with the rest of Plex). */}
      <section className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-slate-300">Insights</h3>
            <p className="text-xs text-slate-400">
              Streams, transcodes &amp; bandwidth trends over time.
            </p>
          </div>
          <Link
            to="/plex/insights"
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            View insights →
          </Link>
        </div>
      </section>
    </div>
  )
}
