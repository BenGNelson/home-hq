import { describe, it, expect } from 'vitest'
import { nextFill, phaseLabel, frogLoaderSvg, frogLoaderCss, finishPlan, TIMING, FROG_ART } from './loader.js'

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
  const dress = { rgb: '155,188,75', skin: '#B8D96B', shade: '#7E9F3C', belly: '#DCEFA8' }

  it('is built from the shared drawing, so it can never drift from the real frog', () => {
    const svg = frogLoaderSvg(dress)
    expect(svg).toContain(`rx="${FROG_ART.body.rx}"`)
    expect(svg).toContain(`cx="${FROG_ART.eyes[1].cx}"`)
  })

  it('wears the machine it is loading', () => {
    expect(frogLoaderSvg(dress)).toContain('rgba(155,188,75,0.92)')
  })

  it('clips the water to the frog — otherwise it is just a rising rectangle', () => {
    const svg = frogLoaderSvg(dress)
    expect(svg).toContain('clip-path="url(#hq-frog-clip)"')
    expect(svg).toContain('<clipPath id="hq-frog-clip">')
  })

  it('carries BOTH frogs — the vessel that fills, and the animal it becomes', () => {
    // The payoff. The filling was for something: at the top, the outline turns into
    // the actual frog, in colour, and hops.
    const svg = frogLoaderSvg(dress)
    expect(svg).toContain('hq-loader-vessel')
    expect(svg).toContain('hq-loader-char')
    expect(svg).toContain(dress.belly) // the character's belly — only the real frog has one
  })
})

describe('the loader cannot move', () => {
  it('does not borrow the start card\'s entrance, which would shove it off-centre', () => {
    // `hq-rise` carries translate(-50%,-50%) — the way you centre something ABSOLUTELY
    // positioned, and the way you knock a flex-CENTRED thing half its own width to the
    // left. The loader is flex-centred, so it needs its own entrance.
    const css = frogLoaderCss({ rgb: '52,211,153' })
    expect(css).not.toMatch(/\.hq-loader-stack\s*\{[^}]*animation:\s*hq-rise/)
    expect(css).toMatch(/\.hq-loader-stack\s*\{[^}]*animation:\s*hq-loader-in/)
  })

  it('brings the frog\'s own keyframes with it — the iframe never loads frog.css', () => {
    // Without these the eyelids render at full size and the frog arrives with its eyes
    // shut, which is not the look we were going for.
    const css = frogLoaderCss({ rgb: '52,211,153' })
    expect(css).toContain('hq-loader-blink')
    expect(css).toContain('hq-loader-breathe')
  })

  it('is pinned to the viewport, not laid out in the engine DOM', () => {
    // The bug: the loader centred itself in a flex column, and removing the progress
    // text made the column shorter — so the frog JUMPED 14px right before it left.
    // A centred thing moves when it changes size. Fixed positioning + an absolutely
    // positioned caption means nothing about the contents can shift the frog.
    const css = frogLoaderCss({ rgb: '52,211,153' })
    expect(css).toMatch(/\.hq-loader\s*\{[^}]*position:\s*fixed/)
    expect(css).toMatch(/\.hq-loader-text\s*\{[^}]*position:\s*absolute/)
  })
})

describe('finishPlan', () => {
  it('lets the frog finish even when the core loads instantly', () => {
    // A cached core is ready in ~300ms — faster than any fill worth watching. The game
    // starting does not dismiss the frog; it tells it to hurry up.
    const at = finishPlan(200)
    expect(at.fillAt).toBe(TIMING.minFill - 200)
    expect(at.goneAt).toBeGreaterThan(TIMING.minFill)
  })

  it('does not dawdle when the load was already slow', () => {
    // The frog has had its moment — top up and go.
    const at = finishPlan(30_000)
    expect(at.fillAt).toBe(0)
    expect(at.goneAt).toBe(TIMING.fill + TIMING.hop + TIMING.fade)
  })

  it('runs in order: fill, then hop, then out, then gone', () => {
    const at = finishPlan(0)
    expect(at.fillAt).toBeLessThan(at.hopAt)
    expect(at.hopAt).toBeLessThan(at.outAt)
    expect(at.outAt).toBeLessThan(at.goneAt)
  })
})
