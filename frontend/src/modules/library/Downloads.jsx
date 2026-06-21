import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  allEntries,
  getEstimate,
  shellBytes,
  removeDownload,
  auditStorage,
  summarizeStorage,
} from '../../lib/offlineStore.js'
import { downloadHref } from '../../lib/library.js'
import { formatSize } from '../../lib/format.js'
import BackLink from '../../components/BackLink.jsx'

// The Downloads page: a first-class destination for everything saved on this
// device, and the audit-grade storage manager. It reads ONLY local sources
// (the IndexedDB manifest + Cache Storage + storage.estimate()), so it works
// fully offline and is the trustworthy answer to "what's taking up space?":
// every byte is shown as either the app shell or a download you can open/delete,
// and "Verify storage" scans the real cache to prove nothing is unaccounted-for.
const ICONS = { pdf: '📄', epub: '📖', comic: '🦸', listen: '🎧' }

// Audiobooks/games have no `reader`; key their icon off the section instead.
const itemIcon = (e) =>
  e.section === 'audiobooks' ? '🎧' : e.section === 'games' ? '🎮' : ICONS[e.reader] || '📄'

export default function Downloads() {
  const [entries, setEntries] = useState(null)
  const [estimate, setEstimate] = useState({})
  const [shell, setShell] = useState(0)
  const [audit, setAudit] = useState(null)
  const [verifying, setVerifying] = useState(false)

  const load = useCallback(async () => {
    const [es, est, sh] = await Promise.all([allEntries(), getEstimate(), shellBytes()])
    setEntries(es)
    setEstimate(est)
    setShell(sh)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (key) => {
    if (!window.confirm('Remove this download from your device?')) return
    await removeDownload(key)
    setAudit(null)
    load()
  }

  const clearAll = async () => {
    if (!entries?.length) return
    if (!window.confirm(`Remove all ${entries.length} downloads from your device?`)) return
    await Promise.all(entries.map((e) => removeDownload(e.key)))
    setAudit(null)
    load()
  }

  const verify = async () => {
    setVerifying(true)
    try {
      setAudit(await auditStorage())
    } finally {
      setVerifying(false)
    }
  }

  if (!entries) return <p className="text-sm text-slate-500">loading…</p>

  const s = summarizeStorage(entries, estimate, shell)
  const pct = s.usage != null && s.quota ? Math.min(100, Math.round((s.usage / s.quota) * 100)) : null

  return (
    <div className="space-y-5">
      <BackLink to="/library">Library</BackLink>
      <h2 className="text-xl font-semibold">Downloads</h2>

      {/* Storage summary. We LEAD with our own exact accounting (summed from the
          real cached bytes) — that's the trustworthy number. The device-quota
          figure from storage.estimate() is shown only as a secondary, explicitly-
          approximate caption (browsers pad it for privacy). "Verify storage" is
          the authoritative proof that nothing is taking space outside this list. */}
      <section className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-slate-300">On this device</span>
          <span className="tabular-nums text-lg font-semibold text-slate-100">
            {formatSize(s.accounted)}
          </span>
        </div>

        <dl className="space-y-1 text-sm">
          <Line label="App offline shell" bytes={s.shellBytes} muted />
          {s.engineBytes > 0 && <Line label="Emulator engine" bytes={s.engineBytes} muted />}
          <Line label={`Downloads (${s.items.length})`} bytes={s.downloadsBytes} />
        </dl>

        {pct != null && (
          <div className="space-y-1 pt-1">
            <div className="h-2 overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[11px] text-slate-500">
              ~{formatSize(s.usage)} of {formatSize(s.quota)} device storage used (approx)
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={verify}
            disabled={verifying}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-100 active:bg-slate-700 disabled:opacity-50"
          >
            {verifying ? 'Verifying…' : 'Verify storage'}
          </button>
          {audit && (
            <span className={`text-sm ${audit.clean ? 'text-emerald-400' : 'text-amber-400'}`}>
              {audit.clean
                ? '✓ No unaccounted data — every byte is listed here'
                : `⚠ ${audit.orphans.length} stray, ${audit.missing.length} missing (tap a download to re-save)`}
            </span>
          )}
        </div>
      </section>

      {/* The downloads themselves (the shared emulator engine is summarized
          above, not listed as a content download). */}
      {s.items.length === 0 ? (
        <p className="text-sm text-slate-400">
          No downloads yet. Open a book or paper and tap <span className="text-slate-200">⬇</span> in the
          reader to save it for offline.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
            {s.items.map((e) => (
              <li key={e.key} className="flex items-center">
                <Link
                  to={downloadHref(e)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 active:bg-slate-800"
                >
                  <span className="text-xl">{itemIcon(e)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-100">{e.name}</span>
                    <span className="block text-xs text-slate-500">{formatSize(e.bytes)}</span>
                  </span>
                </Link>
                <button
                  onClick={() => remove(e.key)}
                  aria-label={`Remove ${e.name}`}
                  className="px-4 py-3 text-slate-500 active:text-rose-300"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={clearAll}
            className="text-sm text-rose-400/80 underline active:text-rose-300"
          >
            Remove all downloads
          </button>
        </>
      )}
    </div>
  )
}

function Line({ label, bytes, muted, warn }) {
  return (
    <div className="flex justify-between">
      <dt className={warn ? 'text-amber-400' : muted ? 'text-slate-500' : 'text-slate-400'}>{label}</dt>
      <dd className={`tabular-nums ${warn ? 'text-amber-400' : 'text-slate-300'}`}>{formatSize(bytes)}</dd>
    </div>
  )
}
