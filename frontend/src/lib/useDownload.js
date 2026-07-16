import { useEffect, useRef, useState } from 'react'
import { downloadKey, getEntry, downloadJob, removeDownload } from './offlineStore.js'

// The offline-download state machine for one item, extracted from DownloadButton so
// the HQ control and Frog's own (differently themed) control share ONE implementation
// — the single-writer-of-bytes rule holds because both go through the same
// `downloadJob`. `item` = { section, id, name, core?, urls }; `onBefore` runs once
// before the job (games ensure the shared emulator engine first).
//
//   checking → idle | done          (looked up the manifest on mount)
//   idle → downloading → done | error
//   done → (remove) → idle
//
// `remove` does NOT prompt — the confirm is the caller's, so each theme asks in its
// own voice (HQ uses window.confirm, Frog its in-screen dialog).
export function useDownload(item, onBefore) {
  const key = downloadKey(item.section, item.id)
  const [state, setState] = useState('checking')
  const [pct, setPct] = useState(0)
  const [bytes, setBytes] = useState(0)

  // The KEY can change without the hook unmounting: Frog keeps one persistent
  // useDownload and re-points it at whichever game's page is open. So the guard is
  // "is this still the game I'm looking at?" (`activeKey`), not "am I mounted?" —
  // otherwise an in-flight download for game A would paint its progress/completion
  // onto game B's button after you've moved on.
  const activeKey = useRef(key)

  useEffect(() => {
    activeKey.current = key
    // Re-checking a NEW key means the old state is wrong — blank it to 'checking'
    // rather than briefly showing the previous game's 'Offline'/done.
    setState('checking')
    setPct(0)
    setBytes(0)
    getEntry(key)
      .then((e) => {
        if (activeKey.current !== key) return
        if (e) {
          setBytes(e.bytes || 0)
          setState('done')
        } else setState('idle')
      })
      .catch(() => activeKey.current === key && setState('idle'))
  }, [key])

  const start = async () => {
    const jobKey = key
    setState('downloading')
    setPct(0)
    try {
      if (onBefore) await onBefore()
      const entry = await downloadJob(item, ({ fraction, loaded }) => {
        if (activeKey.current !== jobKey) return
        setPct(Math.min(100, Math.round((fraction || 0) * 100)))
        setBytes(loaded)
      })
      if (activeKey.current !== jobKey) return
      setBytes(entry.bytes)
      setState('done')
    } catch {
      if (activeKey.current === jobKey) setState('error')
    }
  }

  const remove = async () => {
    const jobKey = key
    try {
      await removeDownload(jobKey)
    } finally {
      if (activeKey.current === jobKey) {
        setBytes(0)
        setState('idle')
      }
    }
  }

  return { state, pct, bytes, start, remove }
}
