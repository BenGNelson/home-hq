import { useEffect, useState } from 'react'
import { allEntries } from './offlineStore.js'

// The full downloaded manifest entries (not just keys), loaded once on mount —
// for views that need more than membership, e.g. the audiobook player reading
// its chapter list from the manifest when offline. null until loaded.
export function useDownloadedEntries() {
  const [entries, setEntries] = useState(null)
  useEffect(() => {
    let alive = true
    allEntries()
      .then((es) => alive && setEntries(es))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [])
  return entries
}

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
