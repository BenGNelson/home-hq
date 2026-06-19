import { useApi } from '../lib/useApi.js'
import BackLink from './BackLink.jsx'

// An explicit "return to the list you came from" link for detail pages, e.g.
// "← Back to Movies". Resolves the library's name from its key.
export default function BackToLibrary({ libraryKey }) {
  const libs = useApi('/plex/libraries', 60000)
  if (!libraryKey) return null
  const lib = (libs.data?.libraries ?? []).find((l) => l.key === libraryKey)
  return (
    <BackLink to={`/plex/library/${libraryKey}`} className="mb-3">
      Back to {lib?.title ?? 'library'}
    </BackLink>
  )
}
