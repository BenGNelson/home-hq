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

    load()
    const id = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [path, intervalMs])

  return state
}
