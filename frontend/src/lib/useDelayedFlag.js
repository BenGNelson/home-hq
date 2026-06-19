import { useEffect, useState } from 'react'

// Returns true only once `active` has stayed true continuously for `delayMs`.
// Used to gate a loading skeleton: if the data arrives before the delay, the
// skeleton is never revealed, so fast loads don't flash a placeholder for a
// frame. A slow load (e.g. /system blocks ~300ms on cpu_percent) crosses the
// threshold and the skeleton fades in, reading as intentional rather than a pop.
export function useDelayedFlag(active, delayMs = 80) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!active) {
      setOn(false)
      return
    }
    const id = setTimeout(() => setOn(true), delayMs)
    return () => clearTimeout(id)
  }, [active, delayMs])
  return on
}
