import { useApi } from '../../../lib/useApi.js'
import { Row, WidgetSkeleton } from '../../../components/ui.jsx'
import { formatResolution } from '../../../lib/format.js'
import Widget from './Widget.jsx'

// kbps → a friendly "x.x Mbps" (or kbps when small).
function formatBitrate(kbps) {
  if (!kbps) return '—'
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${kbps} kbps`
}

// One active stream: what's playing, by whom/where, transcode vs direct, and
// a slim playback-progress bar.
function NowPlaying({ s }) {
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-slate-200">{s.title}</span>
        <span
          className={`shrink-0 text-xs ${s.transcoding ? 'text-amber-400' : 'text-emerald-400'}`}
        >
          {s.transcoding ? 'transcode' : 'direct'}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
        {s.user && <span>{s.user}</span>}
        {s.player && <span>· {s.player}</span>}
        {s.resolution && <span>· {formatResolution(s.resolution)}</span>}
        {s.state === 'paused' && <span className="text-slate-400">· paused</span>}
      </div>
      {s.progress_percent != null && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full bg-emerald-500" style={{ width: `${s.progress_percent}%` }} />
        </div>
      )}
    </div>
  )
}

export default function PlexWidget() {
  const { data, error, loading } = useApi('/plex', 5000)
  const { data: libData } = useApi('/plex/libraries', 30000)
  const { data: npData } = useApi('/plex/now-playing', 5000)

  // Aggregate the per-library counts into glanceable content totals.
  const libs = libData?.libraries ?? []
  const movies = libs
    .filter((l) => l.type === 'movie')
    .reduce((a, l) => a + (l.count || 0), 0)
  const episodes = libs.reduce((a, l) => a + (l.episodes || 0), 0)
  const sessions = npData?.sessions ?? []

  return (
    <Widget title="Plex" loading={loading} error={error} skeleton={<WidgetSkeleton rows={6} />}>
      {data &&
        (!data.configured ? (
          <p className="text-sm text-slate-500">not configured</p>
        ) : !data.reachable ? (
          <p className="text-sm text-amber-400">unreachable</p>
        ) : (
          <>
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

            {sessions.length > 0 && (
              <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                {sessions.map((s, i) => (
                  <NowPlaying key={i} s={s} />
                ))}
              </div>
            )}
          </>
        ))}
    </Widget>
  )
}
