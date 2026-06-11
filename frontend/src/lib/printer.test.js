import { describe, it, expect } from 'vitest'
import { printerStatus, printerUnavailableMessage, colorName } from './printer.js'

describe('printerStatus', () => {
  it('maps known states to label + tone', () => {
    expect(printerStatus('RUNNING')).toEqual({ label: 'Printing', tone: 'sky' })
    expect(printerStatus('PAUSE')).toEqual({ label: 'Paused', tone: 'amber' })
    expect(printerStatus('FINISH')).toEqual({ label: 'Finished', tone: 'emerald' })
    expect(printerStatus('FAILED')).toEqual({ label: 'Failed', tone: 'rose' })
    expect(printerStatus('IDLE')).toEqual({ label: 'Idle', tone: 'slate' })
  })

  it('falls back to the raw state with a neutral tone', () => {
    expect(printerStatus('WEIRD')).toEqual({ label: 'WEIRD', tone: 'slate' })
  })

  it('handles null/undefined', () => {
    expect(printerStatus(null)).toEqual({ label: 'Unknown', tone: 'slate' })
  })
})

describe('printerUnavailableMessage', () => {
  it('maps known reasons', () => {
    expect(printerUnavailableMessage('not_configured')).toBe('No printer configured')
    expect(printerUnavailableMessage('offline')).toBe('Printer offline or asleep')
    expect(printerUnavailableMessage('no_data')).toBe('Connecting to printer…')
  })

  it('falls back for an unknown reason', () => {
    expect(printerUnavailableMessage('???')).toBe('Printer unavailable')
  })
})

describe('colorName', () => {
  it('names the actual loaded filament colors', () => {
    expect(colorName('FFFFFF')).toBe('White') // PLA-S
    expect(colorName('FFF144')).toBe('Yellow') // PLA
    expect(colorName('00AE42')).toBe('Green') // PLA
    expect(colorName('F98C36')).toBe('Orange') // PLA
  })

  it('tolerates a leading # and is case-insensitive', () => {
    expect(colorName('#000000')).toBe('Black')
    expect(colorName('ff0000')).toBe('Red')
  })

  it('returns Unknown for missing/garbage input', () => {
    expect(colorName(null)).toBe('Unknown')
    expect(colorName('')).toBe('Unknown')
    expect(colorName('xyz')).toBe('Unknown')
  })
})
