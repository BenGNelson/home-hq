import { useEffect, useState } from 'react'
import { allEntries } from './offlineStore.js'

// The set of downloaded item keys ("section:id"), loaded once from the on-device
// manifest, so a browse list can show a "saved offline" badge per row. Reloads
// on mount, so navigating back to a list after downloading reflects it. Returns
// null until loaded (callers treat that as "none yet"). Pair with downloadKey()
// from offlineStore to test membership.
export function useDownloaded() {
  const [keys, setKeys] = useState(null)
  useEffect(() => {
    let alive = true
    allEntries()
      .then((es) => alive && setKeys(new Set(es.map((e) => e.key))))
      .catch(() => alive && setKeys(new Set()))
    return () => {
      alive = false
    }
  }, [])
  return keys
}
