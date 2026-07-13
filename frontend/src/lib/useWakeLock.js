import { useEffect } from 'react'

// Keep the screen on while a game is running.
//
// The catch that makes this more than three lines: iOS RELEASES the wake lock
// whenever the page is hidden, and does not give it back when you return. So a
// single request on mount works exactly once — switch apps and come back, and the
// screen starts sleeping mid-game again. It has to be re-acquired every time the
// page becomes visible.
//
// (The libretro core asks for a wake lock of its own through Emscripten, but it
// has the same problem and doesn't re-request either.)
export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return

    let sentinel = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // Denied (low battery, no permission, headless). Not worth surfacing —
        // the game plays fine, the screen just dims on its own schedule.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      sentinel?.release?.().catch(() => {})
    }
  }, [active])
}
