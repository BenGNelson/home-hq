import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import PdfReader from './PdfReader.jsx'

// Reader dispatcher for /library/read. Picks the engine from the `reader` query
// param the lists / Continue Reading shelf pass: 'epub' → the foliate-js ebook
// reader (lazily code-split so it stays out of the app shell), anything else
// (incl. the default) → the PDF.js reader. Both readers self-resume from
// server-side progress, so the dispatcher just routes.
const EpubReader = lazy(() => import('./EpubReader.jsx'))

export default function Reader() {
  const [params] = useSearchParams()
  if (params.get('reader') === 'epub') {
    return (
      <Suspense fallback={<p className="p-6 text-sm text-slate-500">loading…</p>}>
        <EpubReader />
      </Suspense>
    )
  }
  return <PdfReader />
}
