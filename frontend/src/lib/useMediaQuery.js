import { useEffect, useState } from 'react'

// Subscribes to a CSS media query and returns whether it currently matches.
// The initial state reads matchMedia synchronously (guarded for non-browser
// environments) so the first paint already reflects the real viewport — no
// flash of the wrong layout — then it tracks changes via the `change` event
// (same pattern the shell uses for its mobile sidebar). Returns a boolean.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange() // re-sync in case the query changed between render and effect
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}
