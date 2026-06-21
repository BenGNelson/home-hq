import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { comicInfoUrl, comicPageUrl, comicCoverUrl } from '../../lib/library.js'
import { API_BASE } from '../../lib/useApi.js'
import { useOnline } from '../../lib/online.jsx'
import { goBack } from '../../lib/nav.js'
import { saveProgress, resolveResume, readingKey } from '../../lib/progressOutbox.js'
import { useSaveOnExit } from '../../lib/useSaveOnExit.js'
import DownloadButton from './DownloadButton.jsx'

// In-app comic reader (CBZ/CBR/CB7). The backend extracts + downscales one page
// at a time, so this is just an <img> pager: fetch the page count on open,
// resume the saved page (server-side, roams across devices + powers Continue
// Reading), and page with buttons / swipe. The next page is prefetched so a
// forward tap shows instantly. Real route + fixed overlay → the back gesture /
// Close exits. Pages are 1-based in the UI, 0-based (n) on the wire.
export default function ComicReader() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const section = 'comics'
  const id = params.get('id')
  const { online } = useOnline()
  const back = '/library/comics'
  // Close returns to where you came from (history-back); offline it falls back to
  // the Library hub (Downloads), not the comics browser which can't load.
  const exit = () => goBack(navigate, online ? back : '/library')

  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [imgLoading, setImgLoading] = useState(true)

  // Load the page count, then resume to the saved page.
  useEffect(() => {
    if (!id) {
      setStatus('error')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(comicInfoUrl(id))
        if (!r.ok) throw new Error()
        const { pages } = await r.json()
        if (cancelled) return
        if (!pages) {
          setStatus('error')
          return
        }
        setNumPages(pages)
        // Resume: offline progress wins, else the server when online (roams
        // across devices), else the local copy when offline.
        let resume = 1
        const saved = await resolveResume({
          key: readingKey(section, id),
          online,
          serverFetch: async () => {
            const pr = await fetch(
              `${API_BASE}/library/reading-progress/item?section=${encodeURIComponent(
                section
              )}&id=${encodeURIComponent(id)}`
            )
            return pr.ok ? await pr.json() : null
          },
        })
        if (saved && saved.page) resume = saved.page
        if (cancelled) return
        setPage(Math.min(Math.max(1, resume), pages))
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Prefetch the next page so a forward tap renders instantly.
  useEffect(() => {
    if (status !== 'ready' || page >= numPages) return
    const img = new Image()
    img.src = comicPageUrl(id, page) // page (1-based) === next page's 0-based n
  }, [page, status, numPages, id])

  // Save position server-side as you read (debounced) — the bookmark + Continue
  // Reading source of truth (comics bookmark by page, like PDFs).
  useEffect(() => {
    if (status !== 'ready' || !id || !numPages) return
    const t = setTimeout(() => {
      saveProgress({
        key: readingKey(section, id),
        path: '/library/reading-progress',
        body: { section, id, page, total: numPages },
      })
    }, 600)
    return () => clearTimeout(t)
  }, [page, status, numPages, id])

  // Also flush on leaving/backgrounding (the debounce above is canceled on
  // unmount, so a page-turn right before exiting would otherwise be lost).
  useSaveOnExit(() =>
    status === 'ready' && section && id && numPages
      ? {
          key: readingKey(section, id),
          path: '/library/reading-progress',
          body: { section, id, page, total: numPages },
        }
      : null
  )

  const go = (delta) => {
    setPage((p) => {
      const next = Math.min(Math.max(1, p + delta), numPages || 1)
      if (next !== p) setImgLoading(true)
      return next
    })
  }

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

  if (!id) {
    return (
      <div className="p-6 text-rose-400">
        Missing comic.{' '}
        <button onClick={() => navigate(back)} className="underline">
          Back
        </button>
      </div>
    )
  }

  const title = decodeURIComponent((id.split('/').pop() || '').replace(/\.[^.]+$/, ''))

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      <div
        className="flex items-center gap-3 bg-slate-900 px-3 py-2"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <button
          onClick={exit}
          className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 active:bg-slate-700"
        >
          ✕ Close
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-sm text-slate-300">{title}</span>
        {/* A comic download = its info + cover + EVERY rendered page (the browser
            can't unpack the archive, so the reader fetches server-rendered pages;
            offline they must already be in the cache). */}
        {numPages > 0 && (
          <DownloadButton
            item={{
              section: 'comics',
              id,
              name: title,
              reader: 'comic',
              urls: [
                comicInfoUrl(id),
                comicCoverUrl(id),
                ...Array.from({ length: numPages }, (_, n) => comicPageUrl(id, n)),
              ],
            }}
          />
        )}
        <span className="shrink-0 text-sm tabular-nums text-slate-400">
          {numPages ? `${page} / ${numPages}` : '…'}
        </span>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {status === 'loading' && <p className="p-4 text-sm text-slate-500">loading…</p>}
        {status === 'error' && (
          <p className="p-4 text-sm text-rose-400">Couldn’t open this comic.</p>
        )}
        {status === 'ready' && (
          <>
            {imgLoading && (
              <p className="absolute inset-x-0 top-2 text-center text-xs text-slate-500">loading…</p>
            )}
            <img
              key={page}
              src={comicPageUrl(id, page - 1)}
              alt={`Page ${page}`}
              onLoad={() => setImgLoading(false)}
              onError={() => setImgLoading(false)}
              className="mx-auto block max-w-full"
            />
          </>
        )}
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
