import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { API_BASE } from './useApi.js'

// Is the server's backend actually reachable? This is NOT `navigator.onLine` —
// over the tailnet the phone's radio can be "online" while the server is
// unreachable (out of the house, server down, tailnet hiccup). So we probe
// `/api/health` with a short timeout and treat a failure as offline. The whole
// app reads this so it can fall back to downloaded content when the server
// can't be reached.
//
// Foundation phase: the provider is wired and probing; the offline-aware UI
// (banner + downloaded-only hub) consumes it in a later phase.

const OnlineContext = createContext({ online: true, recheck: async () => {} })

export const useOnline = () => useContext(OnlineContext)

// One reachability probe. Resolves true only on a real OK response within the
// timeout; any error / timeout / non-OK → false. `no-store` so we never read a
// cached health response (and the SW never caches /api anyway).
export async function probeHealth(timeoutMs = 4000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal, cache: 'no-store' })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function OnlineProvider({ children, intervalMs = 30000 }) {
  const [online, setOnline] = useState(true)

  const recheck = useCallback(async () => {
    const ok = await probeHealth()
    setOnline(ok)
    return ok
  }, [])

  useEffect(() => {
    let alive = true
    const run = () => {
      if (alive) recheck()
    }
    run() // probe on mount

    // Re-probe on an interval (only while the tab is visible, to avoid pointless
    // background traffic), and immediately on the browser's own connectivity
    // events / when the app regains focus.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    // The radio dropping (airplane mode) is a definitive offline signal — flip
    // immediately rather than waiting for the next probe. The radio coming back
    // is NOT definitive (the tailnet/server may still be unreachable), so that
    // just triggers a re-probe.
    const goOffline = () => alive && setOnline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', run)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      clearInterval(id)
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', run)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [recheck, intervalMs])

  return <OnlineContext.Provider value={{ online, recheck }}>{children}</OnlineContext.Provider>
}
