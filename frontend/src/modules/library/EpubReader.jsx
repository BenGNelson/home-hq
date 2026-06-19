import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fileUrl } from '../../lib/library.js'
import { API_BASE } from '../../lib/useApi.js'

// In-app reader for EPUB / MOBI / AZW3 (the Books section). foliate-js renders
// every one of these client-side — its makeBook() sniffs the format by magic
// bytes and routes MOBI/AZW3 through its built-in parser, so there's NO
// server-side conversion. The library is dynamically imported in the effect so
// it (and the per-format parsers) stay out of the app shell — same lazy pattern
// as the PDF reader. Position is a foliate location string (CFI) + a 0..1
// fraction, saved server-side so it roams across devices and powers Continue
// Reading. Real route + fixed overlay, so the phone back gesture / Close exits.
export default function EpubReader() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const section = params.get('section')
  const id = params.get('id')
  const back = `/library/${section || 'books'}`

  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const posRef = useRef({ locator: null, fraction: null })
  const readyRef = useRef(false) // gate saving until after the resume jump
  const saveTimer = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [percent, setPercent] = useState(null)

  useEffect(() => {
    if (!section || !id) {
      setStatus('error')
      return
    }
    let cancelled = false
    let view = null

    const save = () => {
      if (!readyRef.current) return
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const { locator, fraction } = posRef.current
        if (!locator) return
        fetch(`${API_BASE}/library/reading-progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section, id, locator, fraction }),
        }).catch(() => {})
      }, 800)
    }

    const onRelocate = (e) => {
      const d = e.detail || {}
      // Keep the last known values if an event omits one (so a fraction-less
      // relocate doesn't blank the shelf percent / drop it off Jump back in).
      posRef.current = {
        locator: d.cfi ?? posRef.current.locator,
        fraction: typeof d.fraction === 'number' ? d.fraction : posRef.current.fraction,
      }
      if (typeof d.fraction === 'number') setPercent(Math.round(d.fraction * 100))
      save()
    }

    ;(async () => {
      try {
        await import('foliate-js/view.js') // defines the <foliate-view> element
        if (cancelled || !hostRef.current) return

        // Fetch the bytes and hand foliate a File with the real filename, so its
        // extension-based format fallbacks line up with the magic-byte sniff.
        const resp = await fetch(fileUrl(section, id))
        if (!resp.ok) throw new Error('fetch failed')
        const blob = await resp.blob()
        if (cancelled) return
        const filename = decodeURIComponent(id.split('/').pop() || 'book')
        const file = new File([blob], filename)

        view = document.createElement('foliate-view')
        view.style.width = '100%'
        view.style.height = '100%'
        hostRef.current.appendChild(view)
        view.addEventListener('relocate', onRelocate)
        await view.open(file)
        if (cancelled) return
        viewRef.current = view
        view.renderer?.setAttribute('flow', 'paginated')

        // Resume where we left off (server-side, roams across devices).
        let saved = null
        try {
          const r = await fetch(
            `${API_BASE}/library/reading-progress/item?section=${encodeURIComponent(
              section
            )}&id=${encodeURIComponent(id)}`
          )
          if (r.ok) saved = await r.json()
        } catch {
          /* none / offline — start at the beginning */
        }
        if (cancelled) return
        try {
          if (saved && saved.locator) await view.goTo(saved.locator)
          else if (saved && saved.fraction != null) await view.goToFraction(saved.fraction)
        } catch {
          /* stale locator (e.g. file changed) — just start at the top */
        }
        readyRef.current = true
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(saveTimer.current)
      if (view) {
        view.removeEventListener('relocate', onRelocate)
        view.close?.()
        view.remove()
      }
      viewRef.current = null
      readyRef.current = false
    }
  }, [section, id])

  const go = (dir) => {
    const v = viewRef.current
    if (!v) return
    dir < 0 ? v.prev() : v.next()
  }

  if (!section || !id) {
    return (
      <div className="p-6 text-rose-400">
        Missing book.{' '}
        <button onClick={() => navigate(back)} className="underline">
          Back
        </button>
      </div>
    )
  }

  const filename = decodeURIComponent(id.split('/').pop() || '')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      <div
        className="flex items-center gap-3 bg-slate-900 px-3 py-2"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={() => navigate(back)}
          className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 active:bg-slate-700"
        >
          ✕ Close
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm text-slate-300">{filename}</span>
        <span className="shrink-0 text-sm tabular-nums text-slate-400">
          {percent != null ? `${percent}%` : '…'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {status === 'loading' && <p className="p-4 text-sm text-slate-500">loading…</p>}
        {status === 'error' && (
          <p className="p-4 text-sm text-rose-400">
            Couldn’t open this book. DRM-protected files can’t be read in the browser.
          </p>
        )}
        <div ref={hostRef} className="h-full w-full" />
      </div>

      <div
        className="flex items-center justify-between gap-3 bg-slate-900 px-3 py-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={() => go(-1)}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-slate-100 active:bg-slate-700"
        >
          ‹ Prev
        </button>
        <span className="text-xs text-slate-500">swipe or use the buttons</span>
        <button
          onClick={() => go(1)}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-slate-100 active:bg-slate-700"
        >
          Next ›
        </button>
      </div>
    </div>
  )
}
