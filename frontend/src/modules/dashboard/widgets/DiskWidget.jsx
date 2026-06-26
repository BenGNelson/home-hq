import { useApi } from '../../../lib/useApi.js'
import { Row, Bar, WidgetSkeleton } from '../../../components/ui.jsx'
import { formatBytes } from '../../../lib/format.js'
import Widget from './Widget.jsx'

export default function DiskWidget() {
  const { data, error, loading } = useApi('/disk', 10000)
  const raid = useApi('/raid', 30000) // array state changes rarely
  const unavailable = data && data.available === false
  const arrays = raid.data?.available ? raid.data.arrays : []

  return (
    <Widget title="Storage" loading={loading} error={error} skeleton={<WidgetSkeleton bars={1} rows={3} barsFirst />}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">mount unavailable</p>
        ) : (
          <div className="space-y-3 text-sm">
            <Bar label="Used" percent={data.percent} caption={`${data.percent.toFixed(0)}%`} />
            <Row label="Used" value={formatBytes(data.used_bytes)} />
            <Row label="Free" value={formatBytes(data.free_bytes)} />
            <Row label="Total" value={formatBytes(data.total_bytes)} />
          </div>
        ))}

      {arrays.map((a) => (
        <div key={a.name} className="mt-3 border-t border-slate-800 pt-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">
              {a.level.toUpperCase()} <span className="text-slate-400">({a.name})</span>
            </span>
            <span className={a.healthy ? 'text-emerald-400' : 'text-rose-400'}>
              <span className="mr-1">●</span>
              {a.healthy ? 'Healthy' : 'Degraded'}
              {a.status ? ` [${a.status}]` : ''}
              {a.resync ? ` · ${a.resync.action} ${a.resync.percent}%` : ''}
            </span>
          </div>
          {!a.healthy && (
            <p className="mt-1 text-xs text-rose-300/80">
              {a.failed.length ? `Failed: ${a.failed.join(', ')}. ` : ''}
              {a.devices_active}/{a.devices_total} drives active.
            </p>
          )}
        </div>
      ))}
    </Widget>
  )
}
