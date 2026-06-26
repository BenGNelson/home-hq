import { describe, it, expect } from 'vitest'
import { stepRates, NETWORK_FIELDS, DISK_FIELDS } from './useRates.js'

const emptyHist = () => ({ rates: {}, times: [] })

describe('stepRates', () => {
  it('returns null with no previous sample', () => {
    const next = { time: 2, items: [{ name: 'eth0', rx_bytes: 100, tx_bytes: 50 }] }
    expect(stepRates({ prev: null, next, hist: emptyHist(), fields: NETWORK_FIELDS, nowMs: 1 })).toBe(null)
  })

  it('computes per-item rates over the time delta', () => {
    const prev = { time: 0, map: { eth0: { rx_bytes: 0, tx_bytes: 0 } } }
    const next = { time: 2, items: [{ name: 'eth0', rx_bytes: 200, tx_bytes: 100 }] }
    const step = stepRates({ prev, next, hist: emptyHist(), fields: NETWORK_FIELDS, nowMs: 1000 })
    expect(step.rates.eth0.rxRate).toBe(100) // 200 bytes / 2s
    expect(step.rates.eth0.txRate).toBe(50)
    expect(step.rates.eth0.rxHistory).toEqual([100])
    expect(step.rates.eth0.txHistory).toEqual([50])
    expect(step.times).toEqual([1000])
  })

  it('ignores a non-positive time delta (dt <= 0)', () => {
    const prev = { time: 5, map: { eth0: { rx_bytes: 0, tx_bytes: 0 } } }
    const same = { time: 5, items: [{ name: 'eth0', rx_bytes: 100, tx_bytes: 100 }] }
    expect(stepRates({ prev, next: same, hist: emptyHist(), fields: NETWORK_FIELDS, nowMs: 1 })).toBe(null)
    const back = { time: 4, items: [{ name: 'eth0', rx_bytes: 100, tx_bytes: 100 }] }
    expect(stepRates({ prev, next: back, hist: emptyHist(), fields: NETWORK_FIELDS, nowMs: 1 })).toBe(null)
  })

  it('clamps a counter reset to 0 instead of going negative', () => {
    const prev = { time: 0, map: { eth0: { rx_bytes: 500, tx_bytes: 500 } } }
    const next = { time: 1, items: [{ name: 'eth0', rx_bytes: 100, tx_bytes: 100 }] }
    const step = stepRates({ prev, next, hist: emptyHist(), fields: NETWORK_FIELDS, nowMs: 1 })
    expect(step.rates.eth0.rxRate).toBe(0)
    expect(step.rates.eth0.txRate).toBe(0)
  })

  it('caps each history series and the times array at maxPoints', () => {
    const prev = { time: 0, map: { eth0: { rx_bytes: 0, tx_bytes: 0 } } }
    const hist = {
      rates: { eth0: { rxHistory: [1, 2, 3], txHistory: [1, 2, 3] } },
      times: [10, 20, 30],
    }
    const next = { time: 1, items: [{ name: 'eth0', rx_bytes: 10, tx_bytes: 10 }] }
    const step = stepRates({ prev, next, hist, fields: NETWORK_FIELDS, maxPoints: 3, nowMs: 40 })
    expect(step.rates.eth0.rxHistory).toEqual([2, 3, 10]) // oldest dropped, newest appended
    expect(step.times).toEqual([20, 30, 40])
  })

  it('skips an item with no matching previous sample', () => {
    const prev = { time: 0, map: { eth0: { rx_bytes: 0, tx_bytes: 0 } } }
    const next = {
      time: 1,
      items: [
        { name: 'eth0', rx_bytes: 5, tx_bytes: 5 },
        { name: 'eth1', rx_bytes: 9, tx_bytes: 9 }, // brand-new iface, no baseline yet
      ],
    }
    const step = stepRates({ prev, next, hist: emptyHist(), fields: NETWORK_FIELDS, nowMs: 1 })
    expect(step.rates.eth0).toBeDefined()
    expect(step.rates.eth1).toBeUndefined()
  })

  it('retains history for an item absent from the new sample', () => {
    const prev = { time: 0, map: { eth0: { rx_bytes: 0, tx_bytes: 0 } } }
    const hist = { rates: { gone: { rxRate: 7, rxHistory: [7], txHistory: [7] } }, times: [10] }
    const next = { time: 1, items: [{ name: 'eth0', rx_bytes: 1, tx_bytes: 1 }] }
    const step = stepRates({ prev, next, hist, fields: NETWORK_FIELDS, maxPoints: 60, nowMs: 20 })
    expect(step.rates.gone).toEqual({ rxRate: 7, rxHistory: [7], txHistory: [7] })
  })

  it('works with the disk field spec (read/write)', () => {
    const prev = { time: 0, map: { sda: { read_bytes: 0, write_bytes: 0 } } }
    const next = { time: 4, items: [{ name: 'sda', read_bytes: 400, write_bytes: 200 }] }
    const step = stepRates({ prev, next, hist: emptyHist(), fields: DISK_FIELDS, nowMs: 1 })
    expect(step.rates.sda.readRate).toBe(100)
    expect(step.rates.sda.writeRate).toBe(50)
    expect(step.rates.sda.readHistory).toEqual([100])
  })
})
