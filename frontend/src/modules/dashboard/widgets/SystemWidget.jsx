import { useApi } from '../../../lib/useApi.js'
import { useNetworkRates } from '../../../lib/useRates.js'
import { Row, Bar, WidgetSkeleton } from '../../../components/ui.jsx'
import { formatBytes, formatRate, formatUptime } from '../../../lib/format.js'
import { primaryGpu, gpuCaption } from '../../../lib/gpu.js'
import Widget from './Widget.jsx'

// GPU stats come from a separate host-timer source (/api/gpu); the rows below
// only render when a GPU is reported, so installs without one show nothing.
const MIB = 1024 * 1024

export default function SystemWidget() {
  const { data, error, loading } = useApi('/system', 5000)
  // A tiny rolling window — we only need the current rate for an at-a-glance line.
  const { rates } = useNetworkRates(2000, 2)
  // The physical wired interface is the meaningful "real" throughput to show.
  const wired = Object.keys(rates).find((n) => n.startsWith('en') || n.startsWith('eth'))
  const net = wired ? rates[wired] : null
  // Optional extra source — self-hides on installs without an NVIDIA GPU.
  const gpuApi = useApi('/gpu', 5000)
  const g = primaryGpu(gpuApi.data)

  return (
    <Widget
      title="System"
      loading={loading}
      error={error}
      // Match the real body height: 3 rows + CPU/Memory/Disk bars, plus GPU/VRAM
      // when a GPU is present (/api/gpu resolves before /system, so `g` is known
      // by the time the skeleton is revealed) — so the card doesn't grow on load.
      skeleton={<WidgetSkeleton rows={3} bars={g ? 5 : 3} />}
    >
      {data && (
        <dl className="space-y-3 text-sm">
          <Row label="Host" value={data.server_name} />
          <Row label="Uptime" value={formatUptime(data.uptime_seconds)} />
          <Row
            label="Network"
            value={
              <span className="flex gap-3 tabular-nums">
                <span className="text-emerald-400">↓ {net ? formatRate(net.rxRate) : '—'}</span>
                <span className="text-sky-400">↑ {net ? formatRate(net.txRate) : '—'}</span>
              </span>
            }
          />
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
          {/* Disk can be omitted if the OS mount can't be read (or on a stale
              pre-deploy cached response), so guard before dereferencing. */}
          {data.disk && (
            <Bar
              label="Disk"
              percent={data.disk.percent}
              caption={`${formatBytes(data.disk.used_bytes)} / ${formatBytes(data.disk.total_bytes)}`}
            />
          )}
          {g && (
            <>
              <Bar label="GPU" percent={g.utilization_percent ?? 0} caption={gpuCaption(g)} />
              <Bar
                label="VRAM"
                percent={g.memory_percent ?? 0}
                caption={`${formatBytes((g.memory_used_mb ?? 0) * MIB)} / ${formatBytes((g.memory_total_mb ?? 0) * MIB)}`}
              />
            </>
          )}
        </dl>
      )}
    </Widget>
  )
}
