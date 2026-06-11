import { describe, it, expect } from 'vitest'
import { printerStatus, printerUnavailableMessage } from './printer.js'

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
