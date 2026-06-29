import { OpenLink } from '../../components/ui.jsx'
import { useOnline } from '../../lib/online.jsx'

// The backend's interactive OpenAPI reference (Swagger UI), served same-origin.
const DOCS_URL = '/api/docs'

// We embed the Swagger UI in an iframe *inside the app shell* rather than linking
// straight out — a bare external nav (target=_blank) strands you in a standalone
// PWA, which has no browser chrome and so no way back to Home HQ. Keeping the
// docs under the shell means the persistent top bar (and the mobile hamburger
// nav) is always there to get back. The toolbar still offers a full-screen
// "open in new tab" for desktop browsers that want the raw page.
export default function ApiDocs() {
  const { online } = useOnline()
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          The backend’s interactive API reference (OpenAPI / Swagger UI).
        </p>
        <OpenLink href={DOCS_URL} label="Open in new tab" />
      </div>
      {/* Only mount the iframe when the backend is reachable. Offline, a request
          for /api/docs is a *navigation* the service worker answers with the
          precached app shell — so the iframe would render a recursive copy of
          Home HQ instead of the docs. Show a plain "needs a connection" panel
          instead (this is the installed-PWA-offline case the module targets). */}
      {online ? (
        <iframe
          src={DOCS_URL}
          title="API reference"
          className="min-h-[400px] w-full flex-1 rounded-lg border border-slate-800 bg-white"
        />
      ) : (
        <div className="flex min-h-[400px] flex-1 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
          The API reference needs a connection to the server — it’s unavailable offline.
        </div>
      )}
    </div>
  )
}
