import { describe, it, expect } from 'vitest'
import { nextFill, phaseLabel, frogLoaderSvg, SILHOUETTE } from './loader.js'

describe('nextFill', () => {
  it('NEVER goes backwards', () => {
    // The whole reason this isn't a real percentage. The engine's progress runs
    // through several phases (download core, decompress core, download game…), each
    // counting 0→100% of its own step — so piping that through would fill the frog,
    // empty it, and fill it again. A progress bar that runs backwards is worse than
    // one that admits it doesn't know.
    let fill = 0
    let last = 0
    for (const t of [100, 50, 900, 20, 2000, 0, 4000]) {
      fill = nextFill(fill, t)
      expect(fill).toBeGreaterThanOrEqual(last)
      last = fill
    }
  })

  it('moves immediately, so the frog never looks frozen', () => {
    expect(nextFill(0, 200)).toBeGreaterThan(0.05)
  })

  it('never reaches full on its own — the game starting is what fills it', () => {
    // If time alone could fill the frog, a slow load would show a full frog with
    // nothing happening, which is the exact lie a fake progress bar tells.
    expect(nextFill(0, 60_000)).toBeLessThan(1)
    expect(nextFill(0, 60_000)).toBeGreaterThan(0.85)
  })

  it('shrugs off a nonsense clock', () => {
    expect(nextFill(0.4, -1000)).toBe(0.4)
  })
})

describe('phaseLabel', () => {
  it('keeps what the engine is DOING and drops the number the frog already shows', () => {
    expect(phaseLabel('Decompress Game Core 97%')).toBe('Decompress Game Core')
    expect(phaseLabel('Download Game Data')).toBe('Download Game Data')
  })

  it('has nothing to say when the engine does not', () => {
    expect(phaseLabel('')).toBe('')
    expect(phaseLabel(null)).toBe('')
    expect(phaseLabel(undefined)).toBe('')
  })
})

describe('frogLoaderSvg', () => {
  it('is built from the shared silhouette, so it can never drift from the real frog', () => {
    const svg = frogLoaderSvg({ rgb: '52,211,153' })
    expect(svg).toContain(`rx="${SILHOUETTE.body.rx}"`)
    expect(svg).toContain(`cx="${SILHOUETTE.eyes[1].cx}"`)
  })

  it('wears the machine it is loading', () => {
    expect(frogLoaderSvg({ rgb: '155,188,75' })).toContain('rgba(155,188,75,0.92)')
  })

  it('clips the water to the frog — otherwise it is just a rising rectangle', () => {
    const svg = frogLoaderSvg({ rgb: '52,211,153' })
    expect(svg).toContain('clip-path="url(#hq-frog-clip)"')
    expect(svg).toContain('<clipPath id="hq-frog-clip">')
  })
})
