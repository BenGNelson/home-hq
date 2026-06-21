import { useEffect, useRef, useState } from 'react'
import { downloadKey, getEntry, downloadJob, removeDownload } from '../../lib/offlineStore.js'
import { formatSize } from '../../lib/format.js'

// Compact "save this for offline" control for a reader's top bar. States:
//   checking    — looking up the manifest (renders a fixed-width gap, no flash)
//   idle        — ⬇ tap to download
//   downloading — live percentage (streamed; big magazines take a moment)
//   done        — ✓ green; tap to remove (confirmed)
//   error       — ⚠ tap to retry
// `item` = { section, id, name, type, urls } — the download job. The only writer
// of offline content is downloadJob(), so a tap here is the sole way bytes land
// on the device (the audit-grade single-writer rule).
export default function DownloadButton({ item }) {
  const key = downloadKey(item.section, item.id)
  const [state, setState] = useState('checking')
  const [pct, setPct] = useState(0)
  const [bytes, setBytes] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    getEntry(key)
      .then((e) => {
        if (!mounted.current) return
        if (e) {
          setBytes(e.bytes || 0)
          setState('done')
        } else setState('idle')
      })
      .catch(() => mounted.current && setState('idle'))
    return () => {
      mounted.current = false
    }
  }, [key])

  const start = async () => {
    setState('downloading')
    setPct(0)
    try {
      const entry = await downloadJob(item, ({ loaded, total }) => {
        if (!mounted.current) return
        setPct(total ? Math.min(100, Math.round((loaded / total) * 100)) : 0)
        setBytes(loaded)
      })
      if (!mounted.current) return
      setBytes(entry.bytes)
      setState('done')
    } catch {
      if (mounted.current) setState('error')
    }
  }

  const remove = async () => {
    if (!window.confirm('Remove this offline download from your device?')) return
    try {
      await removeDownload(key)
    } finally {
      if (mounted.current) {
        setBytes(0)
        setState('idle')
      }
    }
  }

  const base = 'shrink-0 rounded px-2.5 py-1.5 text-sm active:scale-95'

  if (state === 'checking') return <span className="w-9 shrink-0" aria-hidden="true" />

  if (state === 'downloading')
    return (
      <span className={`${base} bg-slate-800 tabular-nums text-slate-300`} aria-label="Downloading for offline">
        {pct ? `${pct}%` : '…'}
      </span>
    )

  if (state === 'done')
    return (
      <button
        onClick={remove}
        aria-label={`Saved offline (${formatSize(bytes)}) — tap to remove`}
        title={`Saved offline (${formatSize(bytes)}) — tap to remove`}
        className={`${base} bg-emerald-900/40 text-emerald-300 active:bg-emerald-900/70`}
      >
        ✓
      </button>
    )

  if (state === 'error')
    return (
      <button
        onClick={start}
        aria-label="Download failed — tap to retry"
        title="Download failed — tap to retry"
        className={`${base} bg-rose-900/40 text-rose-300`}
      >
        ⚠
      </button>
    )

  return (
    <button
      onClick={start}
      aria-label="Save for offline reading"
      title="Save for offline reading"
      className={`${base} bg-slate-800 text-slate-100 active:bg-slate-700`}
    >
      ⬇
    </button>
  )
}
