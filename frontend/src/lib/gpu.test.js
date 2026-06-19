import { describe, it, expect } from 'vitest'
import { primaryGpu, gpuCaption } from './gpu.js'

const GPU = {
  name: 'NVIDIA GeForce GTX 1080',
  utilization_percent: 23,
  memory_used_mb: 2048,
  memory_total_mb: 8192,
  memory_percent: 25,
  temperature_c: 41,
  encoder_sessions: 2,
}

describe('primaryGpu', () => {
  it('returns null when data is missing or unavailable', () => {
    expect(primaryGpu(null)).toBeNull()
    expect(primaryGpu({ available: false, gpus: [GPU] })).toBeNull()
  })

  it('returns null when available but no gpus', () => {
    expect(primaryGpu({ available: true, gpus: [] })).toBeNull()
    expect(primaryGpu({ available: true })).toBeNull()
  })

  it('returns the first gpu when available', () => {
    expect(primaryGpu({ available: true, gpus: [GPU] })).toBe(GPU)
  })
})

describe('gpuCaption', () => {
  it('is empty for no gpu', () => {
    expect(gpuCaption(null)).toBe('')
  })

  it('shows load, temp, and encode sessions when transcoding', () => {
    expect(gpuCaption(GPU)).toBe('23% · 41°C · 2 enc')
  })

  it('omits the encode count when idle (0 sessions)', () => {
    expect(gpuCaption({ ...GPU, encoder_sessions: 0 })).toBe('23% · 41°C')
  })

  it('omits temperature when unavailable', () => {
    expect(gpuCaption({ utilization_percent: 5, temperature_c: null, encoder_sessions: 0 })).toBe(
      '5%',
    )
  })
})
