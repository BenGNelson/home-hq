import { useEffect, useState, useCallback } from 'react'

// Base path for API calls. Same-origin "/api" in both dev (Vite proxies it)
// and prod (Nginx proxies it), so widgets never hardcode a host.
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

// Fetches `${API_BASE}${path}` on mount and re-polls every `intervalMs`.
// Returns { data, error, loading } so a widget can render all three states.
// Keeps the last good data while refetching, and clears errors on recovery.
export function useApi(path, intervalMs = 5000) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}${path}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    load()
    const id = setInterval(load, intervalMs)
    return () => clearInterval(id)
  }, [load, intervalMs])

  return { data, error, loading }
}
