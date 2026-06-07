import { useApi } from '../../../lib/useApi.js'
import { Row, Bar } from '../../../components/ui.jsx'
import { formatBytes } from '../../../lib/format.js'
import Widget from './Widget.jsx'

export default function DiskWidget() {
  const { data, error, loading } = useApi('/disk', 10000)
  const unavailable = data && data.available === false
  return (
    <Widget title="Storage" loading={loading} error={error}>
      {data &&
        (unavailable ? (
          <p className="text-sm text-amber-400">mount unavailable</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <Bar label="Used" percent={data.percent} caption={`${data.percent.toFixed(0)}%`} />
            <Row label="Used" value={formatBytes(data.used_bytes)} />
            <Row label="Free" value={formatBytes(data.free_bytes)} />
            <Row label="Total" value={formatBytes(data.total_bytes)} />
          </dl>
        ))}
    </Widget>
  )
}
