import { ExternalLink } from 'lucide-react'

// The backend's interactive OpenAPI docs (Swagger UI), served same-origin at
// /api/docs. We embed it in an iframe *inside the app shell* rather than linking
// straight out — a bare external nav (target=_blank) strands you in a standalone
// PWA, which has no browser chrome and so no way back to Home HQ. Keeping the
// docs under the shell means the persistent top bar (and the mobile hamburger
// nav) is always there to get back. The toolbar still offers a full-screen
// "open in new tab" for desktop browsers that want the raw page.
export default function ApiDocs() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          The backend’s interactive API reference (OpenAPI / Swagger UI).
        </p>
        <a
          href="/api/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
        >
          Open in new tab
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <iframe
        src="/api/docs"
        title="API reference"
        className="min-h-[400px] w-full flex-1 rounded-lg border border-slate-800 bg-white"
      />
    </div>
  )
}
