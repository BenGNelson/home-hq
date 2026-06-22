import { describe, it, expect } from 'vitest'
import { watchPeriodView, cap, fmtHours } from './watchStats.js'

// PRIVACY: all viewer names / titles below are fabricated test data.
const fullPeriod = {
  total_plays: 12,
  total_hours: 9.5,
  by_user: [
    { user: 'Alpha', plays: 8, hours: 6 },
    { user: 'Bravo', plays: 4, hours: 3.5 },
  ],
  by_type: { movie: 5, episode: 7 },
  top: [{ title: 'Fake Title', type: 'movie', plays: 3 }],
}

describe('watchPeriodView', () => {
  it('returns null for a missing, empty, or zero-play period (→ empty state)', () => {
    expect(watchPeriodView(null, 'plays')).toBeNull()
    expect(watchPeriodView(undefined, 'plays')).toBeNull()
    expect(watchPeriodView({ total_plays: 0 }, 'plays')).toBeNull()
  })

  it('shapes a full period into segments + leaderboard + center total', () => {
    const v = watchPeriodView(fullPeriod, 'plays')
    expect(v.totalPlays).toBe(12)
    expect(v.users).toHaveLength(2)
    expect(v.users[0]).toMatchObject({ user: 'Alpha', plays: 8, hours: 6 })
    expect(v.users[0].color).toBeTruthy()
    expect(v.userSegments[0].value).toBe(8) // plays metric
    expect(v.typeSegments.map((s) => s.label)).toEqual(['Movie', 'Episode'])
    expect(v.centerTotal).toEqual({ big: 12, small: 'plays' })
    expect(v.top).toHaveLength(1)
  })

  it('switches the viewer metric to hours', () => {
    const v = watchPeriodView(fullPeriod, 'hours')
    expect(v.userSegments[0].value).toBe(6)
    expect(v.centerTotal).toEqual({ big: '10', small: 'hours' }) // 9.5 → "10"
  })

  it('degrades gracefully when by_user / by_type / total_hours / top are missing', () => {
    // The bug this guards: a partial payload with total_plays > 0 used to throw
    // (p.by_user.map / Object.entries(p.by_type) / p.total_hours.toFixed) and
    // white-screen the whole route.
    const partial = { total_plays: 3 }
    const v = watchPeriodView(partial, 'hours')
    expect(v.users).toEqual([])
    expect(v.userSegments).toEqual([])
    expect(v.typeSegments).toEqual([])
    expect(v.top).toEqual([])
    expect(v.centerTotal).toEqual({ big: '0', small: 'hours' })
  })
})

describe('cap / fmtHours', () => {
  it('capitalizes a label, tolerating empty input', () => {
    expect(cap('movie')).toBe('Movie')
    expect(cap('')).toBe('')
  })

  it('formats hours with an em dash for null', () => {
    expect(fmtHours(6)).toBe('6.0 h')
    expect(fmtHours(null)).toBe('—')
  })
})
