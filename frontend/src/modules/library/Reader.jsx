import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import PdfReader from './PdfReader.jsx'

// Reader dispatcher for /library/read. Picks the engine from the `reader` query
// param the lists / Continue Reading shelf pass: 'epub' → the foliate-js ebook
// reader, 'comic' → the CBZ/CBR page reader (both lazily code-split so they stay
// out of the app shell), anything else (incl. the default) → the PDF.js reader.
// Every reader self-resumes from server-side progress, so the dispatcher just routes.
const EpubReader = lazy(() => import('./EpubReader.jsx'))
const ComicReader = lazy(() => import('./ComicReader.jsx'))

export default function Reader() {
  const [params] = useSearchParams()
  const reader = params.get('reader')
  const lazyReader = reader === 'epub' ? EpubReader : reader === 'comic' ? ComicReader : null
  if (lazyReader) {
    const Lazy = lazyReader
    return (
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">loading…</p>}>
        <Lazy />
      </Suspense>
    )
  }
  return <PdfReader />
}
