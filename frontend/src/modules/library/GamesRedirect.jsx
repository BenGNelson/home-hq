import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { appLinkUrl } from '../../lib/hostLocal.js'

// Games IS the standalone Frog Game Station now — its own app on its own origin
// (so it installs as a PWA and owns its saves). HQ's embedded browser is retired;
// this route (and the Library "Games" tile, and any old /library/games bookmark)
// hands off to it. The target lives only in the gitignored host.local.jsx, so
// committed code carries no host identity. Absent that config (a generic clone),
// fall back to the Library rather than dead-ending.
export default function GamesRedirect() {
  const url = appLinkUrl('games')
  useEffect(() => {
    if (url) window.location.replace(url)
  }, [url])
  if (!url) return <Navigate to="/library" replace />
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm tracking-wide text-slate-400">
      Opening Games…
    </div>
  )
}
