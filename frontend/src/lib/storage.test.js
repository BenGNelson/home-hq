import { describe, it, expect } from 'vitest'
import {
  smartBadge,
  roleTag,
  raidRedundancy,
  seriesPoints,
  summarizeProjection,
} from './storage.js'

describe('smartBadge', () => {
  it('greys out a drive whose SMART could not be read', () => {
    expect(smartBadge({ supported: false }).label).toBe('n/a')
  })
  it('flags a failed self-assessment red', () => {
    const b = smartBadge({ supported: true, passed: false, warnings: [] })
    expect(b.label).toBe('FAILED')
    expect(b.cls).toContain('rose')
  })
  it('warns (amber) on warnings even when still passing', () => {
    const b = smartBadge({ supported: true, passed: true, warnings: ['2 reallocated sectors'] })
    expect(b.label).toBe('warn')
    expect(b.cls).toContain('amber')
  })
  it('is OK (green) when supported, passing, no warnings', () => {
    const b = smartBadge({ supported: true, passed: true, warnings: [] })
    expect(b.label).toBe('OK')
    expect(b.cls).toContain('emerald')
  })
})

describe('roleTag', () => {
  it('tags array members and the OS disk, nothing else', () => {
    expect(roleTag('raid').label).toBe('RAID')
    expect(roleTag('system').label).toBe('OS')
    expect(roleTag('other')).toBeNull()
  })
})

describe('raidRedundancy', () => {
  it('explains common levels in plain language', () => {
    expect(raidRedundancy('raid5')).toMatch(/1 drive/)
    expect(raidRedundancy('raid6')).toMatch(/2 drives/)
    expect(raidRedundancy('raid0')).toMatch(/No redundancy/)
  })
  it('returns null for an unknown level', () => {
    expect(raidRedundancy('weird')).toBeNull()
    expect(raidRedundancy(null)).toBeNull()
  })
})

describe('seriesPoints', () => {
  it('extracts numeric values, mapping nulls to 0', () => {
    expect(seriesPoints([{ value: 38 }, { value: null }, { value: 40 }])).toEqual([38, 0, 40])
  })
  it('tolerates non-arrays', () => {
    expect(seriesPoints(undefined)).toEqual([])
  })
})

describe('summarizeProjection', () => {
  it('reports unknown when there is no projection yet', () => {
    expect(summarizeProjection(null)).toEqual({ state: 'unknown' })
  })
  it('reports flat when usage is stable or shrinking', () => {
    expect(summarizeProjection({ bytes_per_day: 0 }).state).toBe('flat')
    expect(summarizeProjection({ bytes_per_day: -10 }).state).toBe('flat')
  })
  it('computes per-week growth and weeks-until-full when growing', () => {
    const s = summarizeProjection({ bytes_per_day: 100, days_until_full: 70 })
    expect(s.state).toBe('growing')
    expect(s.perWeekBytes).toBe(700)
    expect(s.weeksUntilFull).toBe(10)
  })
  it('growing with no full date (e.g. unknown total) leaves it null', () => {
    const s = summarizeProjection({ bytes_per_day: 100, days_until_full: null })
    expect(s.state).toBe('growing')
    expect(s.weeksUntilFull).toBeNull()
  })
})
