import { describe, it, expect } from 'vitest'
import {
  printerStatus,
  printerBadge,
  finishedAgo,
  printerUnavailableMessage,
  colorName,
} from './printer.js'

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

describe('finishedAgo', () => {
  it('formats seconds into a short relative string', () => {
    expect(finishedAgo(0)).toBe('just now')
    expect(finishedAgo(59)).toBe('just now')
    expect(finishedAgo(60)).toBe('1m ago')
    expect(finishedAgo(5 * 60)).toBe('5m ago')
    expect(finishedAgo(2 * 3600)).toBe('2h ago')
    expect(finishedAgo(25 * 3600)).toBe('1d ago')
  })

  it('returns null for missing/garbage input', () => {
    expect(finishedAgo(null)).toBeNull()
    expect(finishedAgo(undefined)).toBeNull()
    expect(finishedAgo(NaN)).toBeNull()
  })
})

describe('printerBadge', () => {
  it('passes non-finished states straight through with no sub', () => {
    expect(printerBadge({ state: 'RUNNING' })).toEqual({ label: 'Printing', tone: 'sky' })
  })

  it('adds a "finished N ago" sub but keeps green while recent', () => {
    const b = printerBadge({ state: 'FINISH', finished_ago_seconds: 5 * 60 })
    expect(b.label).toBe('Finished')
    expect(b.tone).toBe('emerald')
    expect(b.sub).toBe('5m ago')
  })

  it('softens to a neutral tone once the finish is stale', () => {
    const b = printerBadge({ state: 'FINISH', finished_ago_seconds: 3 * 3600 })
    expect(b.tone).toBe('slate')
    expect(b.sub).toBe('3h ago')
  })

  it('shows a plain Finished badge when elapsed is unknown', () => {
    expect(printerBadge({ state: 'FINISH' })).toEqual({ label: 'Finished', tone: 'emerald' })
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
