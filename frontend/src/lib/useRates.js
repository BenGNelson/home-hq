import { useEffect, useRef, useState } from 'react'
import { API_BASE } from './useApi.js'

// Turn cumulative byte counters into live rates + rolling history, client-side,
// so the backend can stay stateless (no time-series storage in Phase 1).

// Field specs map a sample's cumulative counter names → the rate + history keys
// the consumers (graphs) read. Network: rx/tx; disk: read/write.
export const NETWORK_FIELDS = [
  { in: 'rx_bytes', rate: 'rxRate', history: 'rxHistory' },
  { in: 'tx_bytes', rate: 'txRate', history: 'txHistory' },
]
export const DISK_FIELDS = [
  { in: 'read_bytes', rate: 'readRate', history: 'readHistory' },
  { in: 'write_bytes', rate: 'writeRate', history: 'writeHistory' },
]

// Pure per-sample reducer (no React, no clock): given the previous sample
// (`{time, map}`), the next sample (`{time, items:[{name, ...counters}]}`), the
// accumulated `hist` (`{rates, times}`), the field spec, the window cap, and the
// wall-clock ms for this point, return the next `{rates, times}` window. Returns
// null when there's no usable delta (no prior sample, or dt<=0) so the caller
// leaves its state untouched. Counter resets clamp to 0 (Math.max), each series
// is capped at maxPoints, and entries for items missing this sample are retained.
export function stepRates({ prev, next, hist, fields, maxPoints = 60, nowMs }) {
  if (!prev) return null
  const dt = next.time - prev.time
  if (!(dt > 0)) return null
  const times = [...hist.times, nowMs].slice(-maxPoints)
  const rates = { ...hist.rates }
  for (const item of next.items) {
    const p = prev.map[item.name]
    if (!p) continue
    const cur = hist.rates[item.name] || {}
    const entry = {}
    for (const f of fields) {
      const rate = Math.max(0, (item[f.in] - p[f.in]) / dt)
      entry[f.rate] = rate
      entry[f.history] = [...(cur[f.history] || []), rate].slice(-maxPoints)
    }
    rates[item.name] = entry
  }
  return { rates, times }
}

// Generic counter-polling hook shared by the network + disk variants: polls
// `${API_BASE}${path}`, keys samples by `keyField`, and folds each through
// stepRates with the given field spec.
function useCounterRates(path, keyField, fields, intervalMs, maxPoints) {
  const [state, setState] = useState({ rates: {}, times: [] })
  const [error, setError] = useState(null)
  const prev = useRef(null)
  const hist = useRef({ rates: {}, times: [] })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}${path}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!data.available) throw new Error(data.error || 'unavailable')

        const items = data[keyField]
        const step = stepRates({
          prev: prev.current,
          next: { time: data.time, items },
          hist: hist.current,
          fields,
          maxPoints,
          nowMs: Date.now(),
        })
        if (step) {
          hist.current = step
          if (!cancelled) setState(step)
        }
        prev.current = {
          time: data.time,
          map: Object.fromEntries(items.map((i) => [i.name, i])),
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
  }, [path, keyField, fields, intervalMs, maxPoints])

  return { rates: state.rates, times: state.times, error }
}

// Polls /api/network and computes per-interface rx/tx rates between samples.
// Returns { rates, times, error } where rates[name] = { rxRate, txRate,
// rxHistory[], txHistory[] } and `times` are the wall-clock timestamps aligned
// with each history point (for the graph's x-axis). All arrays are capped at
// `maxPoints` for a fixed-width window.
export function useNetworkRates(intervalMs = 2000, maxPoints = 60) {
  return useCounterRates('/network', 'interfaces', NETWORK_FIELDS, intervalMs, maxPoints)
}

// Polls /api/diskio and computes per-disk read/write rates between samples —
// same approach as useNetworkRates (cumulative counters → client-side rates), so
// the backend stays stateless. Returns { rates, times, error } where
// rates[name] = { readRate, writeRate, readHistory[], writeHistory[] }.
export function useDiskRates(intervalMs = 2000, maxPoints = 60) {
  return useCounterRates('/diskio', 'disks', DISK_FIELDS, intervalMs, maxPoints)
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
