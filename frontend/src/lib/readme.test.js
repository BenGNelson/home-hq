import { describe, it, expect } from 'vitest'
import { rewriteAssetSrc } from './readme.js'

describe('rewriteAssetSrc', () => {
  it('rewrites a repo-relative screenshot path to the asset endpoint', () => {
    expect(rewriteAssetSrc('docs/img/dashboard.png')).toBe(
      '/api/readme/asset/dashboard.png',
    )
  })

  it('handles a leading ./ as well', () => {
    expect(rewriteAssetSrc('./docs/img/themes.png')).toBe(
      '/api/readme/asset/themes.png',
    )
  })

  it('leaves absolute URLs untouched', () => {
    expect(rewriteAssetSrc('https://example.test/x.png')).toBe(
      'https://example.test/x.png',
    )
    expect(rewriteAssetSrc('//cdn.test/x.png')).toBe('//cdn.test/x.png')
  })

  it('leaves unrelated relative paths untouched', () => {
    expect(rewriteAssetSrc('other/pic.png')).toBe('other/pic.png')
  })

  it('passes empty/undefined through', () => {
    expect(rewriteAssetSrc('')).toBe('')
    expect(rewriteAssetSrc(undefined)).toBeUndefined()
  })
})
