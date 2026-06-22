import { describe, it, expect } from 'vitest'
import { HardDriveDownload, Printer, Bell } from 'lucide-react'
import { alertIcon } from './alerts.js'

describe('alertIcon', () => {
  it('maps known tags to their Lucide icon', () => {
    expect(alertIcon('floppy_disk')).toBe(HardDriveDownload)
    expect(alertIcon('printer')).toBe(Printer)
  })
  it('falls back to a bell for unknown tags', () => {
    expect(alertIcon('nope')).toBe(Bell)
  })
})
