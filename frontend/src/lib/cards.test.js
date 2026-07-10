import { describe, it, expect } from 'vitest'
import { cardImageUrl, setHref, cardsSearchHref, completionPct, formatUsd } from './cards.js'

describe('cards helpers', () => {
  it('builds a same-origin card image url with size + encoded id', () => {
    expect(cardImageUrl('base1-4')).toBe('/api/cards/image?id=base1-4&size=small')
    expect(cardImageUrl('base1-4', 'large')).toBe('/api/cards/image?id=base1-4&size=large')
    // A promo id with characters that need encoding stays safe.
    expect(cardImageUrl('swshp-SWSH001')).toContain('id=swshp-SWSH001')
  })

  it('builds set + search hrefs', () => {
    expect(setHref('swsh1')).toBe('/cards/sets/swsh1')
    expect(cardsSearchHref('')).toBe('/cards/search')
    expect(cardsSearchHref('pikachu')).toBe('/cards/search?q=pikachu')
    expect(cardsSearchHref('a b')).toBe('/cards/search?q=a%20b')
  })

  it('computes completion percentage, guarding a zero denominator', () => {
    expect(completionPct(0, 0)).toBe(0)
    expect(completionPct(1, 4)).toBe(25)
    expect(completionPct(3, 3)).toBe(100)
  })

  it('formats USD, returning null when there is nothing to show', () => {
    expect(formatUsd(null)).toBe(null)
    expect(formatUsd(undefined)).toBe(null)
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })
})
