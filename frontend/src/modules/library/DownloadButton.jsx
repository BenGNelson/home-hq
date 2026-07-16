import { Download, Check, TriangleAlert } from 'lucide-react'
import { useDownload } from '../../lib/useDownload.js'
import { formatSize } from '../../lib/format.js'

// Compact "save this for offline" control for a reader's top bar. States:
//   checking    — looking up the manifest (renders a fixed-width gap, no flash)
//   idle        — download icon, tap to download
//   downloading — live percentage (streamed; big magazines take a moment)
//   done        — check, green; tap to remove (confirmed)
//   error       — warning, tap to retry
// `item` = { section, id, name, type, urls } — the download job. The state machine
// lives in useDownload (shared with Frog's own control); the single-writer rule
// (downloadJob is the only path bytes land) holds there.
export default function DownloadButton({ item, onBefore }) {
  const { state, pct, bytes, start, remove } = useDownload(item, onBefore)
  const confirmRemove = () => {
    if (window.confirm('Remove this offline download from your device?')) remove()
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
        onClick={confirmRemove}
        aria-label={`Saved offline (${formatSize(bytes)}) — tap to remove`}
        title={`Saved offline (${formatSize(bytes)}) — tap to remove`}
        className={`${base} bg-emerald-900/40 text-emerald-300 active:bg-emerald-900/70`}
      >
        <Check className="h-[18px] w-[18px]" aria-hidden="true" />
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
        <TriangleAlert className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    )

  return (
    <button
      onClick={start}
      aria-label="Save for offline reading"
      title="Save for offline reading"
      className={`${base} bg-slate-800 text-slate-100 active:bg-slate-700`}
    >
      <Download className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  )
}
