import { describe, it, expect } from 'vitest'
import { panelsPeak, panelColor } from './solarPanels.js'

describe('panelsPeak', () => {
  it('is the max current output, floored at 1', () => {
    expect(panelsPeak([{ watts: 120 }, { watts: 300 }, { watts: 0 }])).toBe(300)
    expect(panelsPeak([{ watts: 0 }, { watts: null }])).toBe(1) // all dark → floor
    expect(panelsPeak([])).toBe(1)
  })
})

describe('panelColor', () => {
  it('is slate when idle/none', () => {
    expect(panelColor(0, 300)).toBe('rgba(148,163,184,0.12)')
    expect(panelColor(null, 300)).toBe('rgba(148,163,184,0.12)')
  })
  it('scales amber alpha with output relative to peak', () => {
    expect(panelColor(300, 300)).toBe('rgba(245,158,11,1.00)') // best panel → full
    expect(panelColor(150, 300)).toBe('rgba(245,158,11,0.59)') // 0.18 + 0.5*0.82
  })
  it('caps alpha at 1 when a panel exceeds the reference', () => {
    expect(panelColor(600, 300)).toBe('rgba(245,158,11,1.00)')
  })
})
