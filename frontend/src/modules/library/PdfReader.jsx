import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fileUrl } from '../../lib/library.js'
import { API_BASE } from '../../lib/useApi.js'
// The worker is referenced by URL (emitted as its own asset, fetched only when
// the reader runs). The heavy pdf.js library itself is dynamically imported in
// the effect below so it stays out of the main bundle — the PWA shell stays
// lean and pdf.js only loads when you open a document. We use the *legacy*
// build, which is transpiled for broad browser support (incl. older iOS Safari).
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

// In-app PDF reader (Magazines & Papers, plus any PDF in the Books section).
// Streams the file from the range-capable /library/file endpoint, renders one
// page at a time to a canvas (fit-to-width), and resumes/saves your position
// server-side (so it roams across devices + powers the Continue Reading shelf).
// Real route + fixed overlay, so the phone back gesture / Close exits.
export default function PdfReader() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const section = params.get('section')
  const id = params.get('id')
  const back = `/library/${section || 'papers'}`

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const docRef = useRef(null)
  const renderTaskRef = useRef(null)
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [resizeTick, setResizeTick] = useState(0)

  // Load the document once, then resume to the saved page.
  useEffect(() => {
    if (!section || !id) {
      setStatus('error')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        const task = pdfjs.getDocument(fileUrl(section, id))
        const pdf = await task.promise
        if (cancelled) {
          pdf.destroy?.()
          return
        }
        docRef.current = pdf
        setNumPages(pdf.numPages)
        // Resume where we left off (server-side, roams across devices).
        let resume = 1
        try {
          const r = await fetch(
            `${API_BASE}/library/reading-progress/item?section=${encodeURIComponent(
              section
            )}&id=${encodeURIComponent(id)}`
          )
          if (r.ok) {
            const saved = await r.json()
            if (saved && saved.page) resume = saved.page
          }
        } catch {
          /* no saved position / offline — start at the beginning */
        }
        if (cancelled) return
        setPage(Math.min(Math.max(1, resume), pdf.numPages))
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel?.()
      docRef.current?.destroy?.()
      docRef.current = null
    }
  }, [section, id])

  // Render the current page (and re-render on resize / orientation change).
  useEffect(() => {
    if (status !== 'ready' || !docRef.current) return
    let cancelled = false
    ;(async () => {
      const pg = await docRef.current.getPage(page)
      if (cancelled) return
      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return
      const cssWidth = container.clientWidth || 1
      const scale = cssWidth / pg.getViewport({ scale: 1 }).width
      const dpr = window.devicePixelRatio || 1
      const viewport = pg.getViewport({ scale: scale * dpr })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
      renderTaskRef.current?.cancel?.()
      const task = pg.render({ canvasContext: canvas.getContext('2d'), viewport })
      renderTaskRef.current = task
      try {
        await task.promise
      } catch {
        /* superseded by a newer render — ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page, status, resizeTick])

  // Save the position server-side as you read (debounced, so fast paging doesn't
  // spam). This is the bookmark + Continue Reading source of truth.
  useEffect(() => {
    if (status !== 'ready' || !section || !id || !numPages) return
    const t = setTimeout(() => {
      fetch(`${API_BASE}/library/reading-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, id, page, total: numPages }),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [page, status, numPages, section, id])

  // Re-render the page when the viewport changes size.
  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const go = (delta) => setPage((p) => Math.min(Math.max(1, p + delta), numPages || 1))

  // Swipe left/right to page.
  const touchX = useRef(null)
  const onTouchStart = (e) => {
    touchX.current = e.changedTouches[0].clientX
  }
  const onTouchEnd = (e) => {
    if (touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
    touchX.current = null
  }

  if (!section || !id) {
    return (
      <div className="p-6 text-rose-400">
        Missing document.{' '}
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
          {numPages ? `${page} / ${numPages}` : '…'}
        </span>
      </div>

      <div
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {status === 'loading' && <p className="p-4 text-sm text-slate-500">loading…</p>}
        {status === 'error' && (
          <p className="p-4 text-sm text-rose-400">Couldn’t open this document.</p>
        )}
        <canvas ref={canvasRef} className="mx-auto block" />
      </div>

      <div
        className="flex items-center justify-between gap-3 bg-slate-900 px-3 py-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={() => go(-1)}
          disabled={page <= 1}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-slate-100 active:bg-slate-700 disabled:opacity-40"
        >
          ‹ Prev
        </button>
        <span className="text-xs text-slate-500">swipe or use the buttons</span>
        <button
          onClick={() => go(1)}
          disabled={numPages > 0 && page >= numPages}
          className="rounded bg-slate-800 px-4 py-1.5 text-sm text-slate-100 active:bg-slate-700 disabled:opacity-40"
        >
          Next ›
        </button>
      </div>
    </div>
  )
}
