import { useEffect, useState } from 'react'

// Base path for API calls. Same-origin "/api" in both dev (Vite proxies it)
// and prod (Nginx proxies it), so widgets never hardcode a host.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

// Fetches `${API_BASE}${path}` on mount and re-polls every `intervalMs`.
// Returns { data, error, loading }.
//
// Two behaviors that matter for the UI:
//  - On a PATH CHANGE (e.g. selecting a different container) it resets to a
//    loading state and clears the old data, so the consumer can show a spinner
//    instead of the previous item's stale details.
//  - During steady polling of the SAME path it keeps the last good data and
//    only swaps it in on success, so the view doesn't flicker; a failed poll
//    keeps the last good data and surfaces an error.
//  - Polling only runs while the tab is VISIBLE — a backgrounded PWA stops
//    hitting the backend, and regaining visibility kicks an immediate refresh
//    (so the view isn't stale) before resuming the interval.
export function useApi(path, intervalMs = 5000) {
  const [state, setState] = useState({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ data: null, error: null, loading: true }) // reset on path change

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}${path}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) setState({ data: json, error: null, loading: false })
      } catch (err) {
        if (!cancelled)
          setState((s) => ({ data: s.data, error: err.message, loading: false }))
      }
    }

    // intervalMs of 0 (or falsy) = fetch once, no polling.
    let id = null
    const startPolling = () => {
      if (id == null && intervalMs) id = setInterval(load, intervalMs)
    }
    const stopPolling = () => {
      if (id != null) {
        clearInterval(id)
        id = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (intervalMs) load() // polling consumers refresh on return; one-shot stays one-shot
        startPolling()
      } else {
        stopPolling()
      }
    }

    load()
    if (document.visibilityState !== 'hidden') startPolling()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [path, intervalMs])

  return state
}
