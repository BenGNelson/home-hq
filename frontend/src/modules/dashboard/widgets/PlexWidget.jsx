import { useApi } from '../../../lib/useApi.js'
import { Row } from '../../../components/ui.jsx'
import Widget from './Widget.jsx'

export default function PlexWidget() {
  const { data, error, loading } = useApi('/plex', 5000)
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
            <Row label="Version" value={data.version} />
            <Row
              label="Active streams"
              value={
                <span
                  className={
                    data.streams > 0 ? 'text-emerald-400' : 'text-slate-400'
                  }
                >
                  {data.streams}
                </span>
              }
            />
          </dl>
        ))}
    </Widget>
  )
}
