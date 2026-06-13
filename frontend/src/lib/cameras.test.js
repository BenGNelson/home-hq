import { describe, it, expect } from 'vitest'
import { cameraStreamUrl, cameraSnapshotUrl, gridColsClass } from './cameras.js'

describe('camera urls', () => {
  it('builds the stream url under the api base', () => {
    expect(cameraStreamUrl('camera.backyard')).toBe('/api/ha/camera/camera.backyard/stream')
  })
  it('builds the snapshot url', () => {
    expect(cameraSnapshotUrl('camera.front_doorbell')).toBe('/api/ha/camera/camera.front_doorbell/snapshot')
  })
  it('encodes unusual characters in the entity id', () => {
    expect(cameraStreamUrl('camera.a b')).toBe('/api/ha/camera/camera.a%20b/stream')
  })
})

describe('gridColsClass', () => {
  it('single camera fills the width', () => expect(gridColsClass(1)).toBe('grid-cols-1'))
  it('a few cameras go two-up', () => {
    expect(gridColsClass(2)).toBe('sm:grid-cols-2')
    expect(gridColsClass(4)).toBe('sm:grid-cols-2')
  })
  it('many cameras go three-up on large screens', () => {
    expect(gridColsClass(6)).toContain('lg:grid-cols-3')
  })
})
