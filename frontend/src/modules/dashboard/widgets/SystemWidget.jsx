import { useApi } from '../../../lib/useApi.js'
import { Row, Bar } from '../../../components/ui.jsx'
import { formatBytes, formatUptime } from '../../../lib/format.js'
import Widget from './Widget.jsx'

export default function SystemWidget() {
  const { data, error, loading } = useApi('/system', 5000)
  return (
    <Widget title="System" loading={loading} error={error}>
      {data && (
        <dl className="space-y-3 text-sm">
          <Row label="Host" value={data.server_name} />
          <Bar
            label="CPU"
            percent={data.cpu.percent}
            caption={`${data.cpu.percent.toFixed(0)}% · ${data.cpu.cores} cores`}
          />
          <Bar
            label="Memory"
            percent={data.memory.percent}
            caption={`${formatBytes(data.memory.used_bytes)} / ${formatBytes(data.memory.total_bytes)}`}
          />
          <Row label="Uptime" value={formatUptime(data.uptime_seconds)} />
        </dl>
      )}
    </Widget>
  )
}
