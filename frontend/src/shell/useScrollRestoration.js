import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Browser-like scroll restoration for the shell's <main> scroll container.
//
// The app scrolls an inner `overflow-auto` <main> (not the window), and we use a
// plain BrowserRouter — so react-router's data-router <ScrollRestoration> isn't
// available. This hook does the same job manually: it remembers each history
// entry's scroll position and, on a Back/Forward (POP) navigation, drops you
// back where you were; a fresh navigation (PUSH/REPLACE) starts at the top.
//
// Pass a ref to the scroll container. Positions are keyed by `location.key`
// (unique per history entry) and live at module scope so they survive the
// per-route remount of the content inside <main>.
const positions = new Map()
const MAX_ENTRIES = 50 // cap so a long-lived PWA session can't grow this forever

export function useScrollRestoration(ref) {
  const location = useLocation()
  const navType = useNavigationType() // 'POP' | 'PUSH' | 'REPLACE'
  const key = location.key
  // True only during a programmatic restore. The previous entry's scroll
  // listener is still attached for one frame (its passive cleanup runs after
  // paint), so suppressing saves here stops our own scrollTop write — or that
  // stale listener — from clobbering a saved position under the wrong key.
  const restoring = useRef(false)

  // Continuously record this entry's scroll position so it's already saved by
  // the time the user navigates away (rAF-throttled to stay cheap).
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let frame = 0
    const onScroll = () => {
      if (restoring.current || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        positions.set(key, el.scrollTop)
        if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, key])

  // On navigation, restore (Back/Forward) or reset to the top (new push). A
  // layout effect so it runs before paint — no visible jump.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    restoring.current = true
    const clearFrame = requestAnimationFrame(() => {
      restoring.current = false
    })

    // PUSH/REPLACE: a fresh page starts at the top. Set once and don't chase —
    // we must NOT fight a user who scrolls while the new page is still loading.
    if (navType !== 'POP') {
      el.scrollTop = 0
      return () => cancelAnimationFrame(clearFrame)
    }

    // POP (Back/Forward): restore the saved offset. The target may not exist yet
    // at first paint (the dashboard grows taller once its async data lands), so
    // re-apply while the content resizes, for a short settle window, then stop.
    const target = positions.get(key) ?? 0
    el.scrollTop = target
    const content = el.firstElementChild ?? el
    const observer = new ResizeObserver(() => {
      if (el.scrollTop !== target) el.scrollTop = target
    })
    observer.observe(content)
    const timer = setTimeout(() => observer.disconnect(), 1000)
    return () => {
      cancelAnimationFrame(clearFrame)
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [ref, key, navType])
}
