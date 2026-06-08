import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatRate,
  formatDuration,
  formatResolution,
  formatSize,
  formatDate,
  formatDateTime,
  formatUptime,
  formatAgo,
} from './format.js'

const GiB = 1024 ** 3

describe('formatBytes', () => {
  it('handles null and scales to GiB/TiB', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(GiB)).toBe('1.0 GiB')
    expect(formatBytes(1.5 * GiB)).toBe('1.5 GiB')
    expect(formatBytes(2 * 1024 * GiB)).toBe('2.0 TiB')
  })
})

describe('formatRate', () => {
  it('scales bytes/sec and rounds sensibly', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(1024)).toBe('1.0 KB/s')
    expect(formatRate(1536)).toBe('1.5 KB/s')
    expect(formatRate(10 * 1024)).toBe('10 KB/s') // >=10 drops the decimal
    expect(formatRate(1024 * 1024)).toBe('1.0 MB/s')
  })
})

describe('formatSize', () => {
  it('scales file sizes B→KB→MB', () => {
    expect(formatSize(null)).toBe('—')
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
  })
})

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(45 * 60000)).toBe('45m')
    expect(formatDuration(90 * 60000)).toBe('1h 30m')
  })
})

describe('formatResolution', () => {
  it('maps known values, passes through unknown', () => {
    expect(formatResolution('4k')).toBe('4K')
    expect(formatResolution('1080')).toBe('1080p')
    expect(formatResolution(null)).toBe('—')
    expect(formatResolution('weird')).toBe('weird')
  })
})

describe('formatUptime', () => {
  it('formats m / h m / d h', () => {
    expect(formatUptime(null)).toBe('—')
    expect(formatUptime(90)).toBe('1m')
    expect(formatUptime(3661)).toBe('1h 1m')
    expect(formatUptime(90000)).toBe('1d 1h')
  })
})

describe('formatAgo', () => {
  it('gives relative phrases', () => {
    expect(formatAgo(null)).toBe('never')
    const now = Math.floor(Date.now() / 1000)
    expect(formatAgo(now - 10)).toBe('just now')
    expect(formatAgo(now - 120)).toBe('2m ago')
    expect(formatAgo(now - 7200)).toBe('2h ago')
  })
})

describe('formatDate / formatDateTime', () => {
  it('return — for null and a real string otherwise', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDate(1700000000)).not.toBe('—')
    expect(typeof formatDateTime(1700000000)).toBe('string')
  })
})
