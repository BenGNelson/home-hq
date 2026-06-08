import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '../lib/useApi.js'
import { formatAgo } from '../lib/format.js'

// Shows "Last synced … · N items" with a Refresh button that rebuilds the local
// media cache from Plex. While a sync runs it polls status so the button reflects
// progress. Used on the Plex page and inside the library browser.
export default function SyncControl() {
  const [status, setStatus] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/plex/sync/status`)
      setStatus(await r.json())
    } catch {
      /* leave previous status */
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Poll while a sync is running so the UI updates when it finishes.
  useEffect(() => {
    if (!status?.running) return
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [status?.running, refresh])

  async function startSync() {
    await fetch(`${API_BASE}/plex/sync`, { method: 'POST' })
    refresh()
  }

  const running = status?.running
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <span>
        {running ? (
          <span className="text-amber-400">syncing…</span>
        ) : (
          <>
            Synced {formatAgo(status?.last_synced)}
            {status?.item_count ? ` · ${status.item_count.toLocaleString()} items` : ''}
          </>
        )}
      </span>
      <button
        onClick={startSync}
        disabled={running}
        className="rounded-lg border border-slate-700 px-2.5 py-1 font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? 'Syncing…' : 'Refresh'}
      </button>
    </div>
  )
}
