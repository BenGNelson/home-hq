import { Link } from 'react-router-dom'
import { useApi } from '../lib/useApi.js'

// An explicit "return to the list you came from" link for detail pages, e.g.
// "← Back to Movies". Resolves the library's name from its key.
export default function BackToLibrary({ libraryKey }) {
  const libs = useApi('/plex/libraries', 60000)
  if (!libraryKey) return null
  const lib = (libs.data?.libraries ?? []).find((l) => l.key === libraryKey)
  return (
    <Link
      to={`/plex/library/${libraryKey}`}
      className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
    >
      <span aria-hidden>←</span> Back to {lib?.title ?? 'library'}
    </Link>
  )
}
