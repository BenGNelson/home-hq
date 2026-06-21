import { useEffect, useRef } from 'react'
import { saveProgress } from './progressOutbox.js'

// Flush the current reading position when you LEAVE a reader (it unmounts) or
// background the app (visibility → hidden). Each reader's normal save is
// debounced and that timer is canceled on unmount — so without this, turning a
// page and immediately leaving (or locking the phone) loses that spot, which is
// how a downloaded item could reopen at page 1 offline. The audiobook player
// already saves on exit; this gives the page-based readers the same guarantee.
//
// `getEntry()` returns the `{key, path, body}` to save, or null if there's
// nothing to save yet. It's stored in a ref and re-read at flush time, so the
// flush always uses the LATEST position (not a stale closure).
export function useSaveOnExit(getEntry) {
  const ref = useRef(getEntry)
  ref.current = getEntry
  useEffect(() => {
    const flush = () => {
      const entry = ref.current?.()
      if (entry) saveProgress(entry)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [])
}
