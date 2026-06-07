import { useEffect, useRef, useState } from 'react'
import { API_BASE } from './useApi.js'

// Turn cumulative byte counters into live rates + rolling history, client-side,
// so the backend can stay stateless (no time-series storage in Phase 1).

// Polls /api/network and computes per-interface rx/tx rates between samples.
// Returns { rates, times, error } where rates[name] = { rxRate, txRate,
// rxHistory[], txHistory[] } and `times` are the wall-clock timestamps aligned
// with each history point (for the graph's x-axis). All arrays are capped at
// `maxPoints` for a fixed-width window.
export function useNetworkRates(intervalMs = 2000, maxPoints = 60) {
  const [state, setState] = useState({ rates: {}, times: [] })
  const [error, setError] = useState(null)
  const prev = useRef(null)
  const hist = useRef({ rates: {}, times: [] })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/network`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!data.available) throw new Error(data.error || 'unavailable')

        if (prev.current) {
          const dt = data.time - prev.current.time
          if (dt > 0) {
            const h = hist.current
            const times = [...h.times, Date.now()].slice(-maxPoints)
            const rates = { ...h.rates }
            for (const iface of data.interfaces) {
              const p = prev.current.map[iface.name]
              if (!p) continue
              const rxRate = Math.max(0, (iface.rx_bytes - p.rx_bytes) / dt)
              const txRate = Math.max(0, (iface.tx_bytes - p.tx_bytes) / dt)
              const cur = h.rates[iface.name] || { rxHistory: [], txHistory: [] }
              rates[iface.name] = {
                rxRate,
                txRate,
                rxHistory: [...cur.rxHistory, rxRate].slice(-maxPoints),
                txHistory: [...cur.txHistory, txRate].slice(-maxPoints),
              }
            }
            hist.current = { rates, times }
            if (!cancelled) setState({ rates, times })
          }
        }
        prev.current = {
          time: data.time,
          map: Object.fromEntries(data.interfaces.map((i) => [i.name, i])),
        }
        if (!cancelled) setError(null)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }

    load()
    const id = setInterval(load, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs, maxPoints])

  return { rates: state.rates, times: state.times, error }
}

// Derives rate + rolling history from a single pair of cumulative counters that
// the caller refreshes (e.g. a polled container's net_rx/net_tx + its time).
// Resets cleanly when the counters reset (e.g. a different container selected,
// handled by remounting the consumer with a React key).
export function useCounterRate(rxBytes, txBytes, time, maxPoints = 60) {
  const prev = useRef(null)
  const [hist, setHist] = useState({ rx: [], tx: [], rxRate: 0, txRate: 0 })

  useEffect(() => {
    if (time == null || rxBytes == null) return
    if (prev.current) {
      const dt = time - prev.current.time
      if (dt > 0) {
        const rxRate = Math.max(0, (rxBytes - prev.current.rx) / dt)
        const txRate = Math.max(0, (txBytes - prev.current.tx) / dt)
        setHist((h) => ({
          rx: [...h.rx, rxRate].slice(-maxPoints),
          tx: [...h.tx, txRate].slice(-maxPoints),
          rxRate,
          txRate,
        }))
      }
    }
    prev.current = { time, rx: rxBytes, tx: txBytes }
  }, [time, rxBytes, txBytes, maxPoints])

  return hist
}
