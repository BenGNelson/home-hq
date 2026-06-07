import { useApi } from '../../../lib/useApi.js'
import { Row } from '../../../components/ui.jsx'
import Widget from './Widget.jsx'

// kbps → a friendly "x.x Mbps" (or kbps when small).
function formatBitrate(kbps) {
  if (!kbps) return '—'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${kbps} kbps`
}

export default function PlexWidget() {
  const { data, error, loading } = useApi('/plex', 5000)
  const { data: libData } = useApi('/plex/libraries', 30000)

  // Aggregate the per-library counts into glanceable content totals.
  const libs = libData?.libraries ?? []
  const movies = libs
    .filter((l) => l.type === 'movie')
    .reduce((a, l) => a + (l.count || 0), 0)
  const episodes = libs.reduce((a, l) => a + (l.episodes || 0), 0)

  return (
    <Widget title="Plex" loading={loading} error={error}>
      {data &&
        (!data.configured ? (
          <p className="text-sm text-slate-500">not configured</p>
        ) : !data.reachable ? (
          <p className="text-sm text-amber-400">unreachable</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <Row label="Server" value={data.server_name} />
            <Row
              label="Active streams"
              value={
                <span className="flex items-center gap-2">
                  <span className={data.streams > 0 ? 'text-emerald-400' : 'text-slate-400'}>
                    {data.streams}
                  </span>
                  {data.transcodes > 0 && (
                    <span className="text-xs text-amber-400">
                      ({data.transcodes} transcoding)
                    </span>
                  )}
                </span>
              }
            />
            {data.streams > 0 && data.bandwidth_kbps && (
              <Row label="Bandwidth" value={formatBitrate(data.bandwidth_kbps)} />
            )}
            {movies > 0 && <Row label="Movies" value={movies.toLocaleString()} />}
            {episodes > 0 && (
              <Row label="TV episodes" value={episodes.toLocaleString()} />
            )}
            <Row label="Version" value={data.version} />
          </dl>
        ))}
    </Widget>
  )
}
