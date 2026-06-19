import { useApi } from '../../../lib/useApi.js'
import { useNetworkRates } from '../../../lib/useRates.js'
import { Row, Bar, SkeletonLine } from '../../../components/ui.jsx'
import { formatBytes, formatRate, formatUptime } from '../../../lib/format.js'
import { primaryGpu, gpuCaption } from '../../../lib/gpu.js'
import Widget from './Widget.jsx'

// GPU stats come from a separate host-timer source (/api/gpu); the rows below
// only render when a GPU is reported, so installs without one show nothing.
const MIB = 1024 * 1024

// A placeholder shaped like the real body below (3 label/value rows + 2 bars),
// so the card holds its height and the data swaps in without a jump. /system
// blocks ~300ms server-side (cpu_percent), so this is the widget that visibly
// flashed on every dashboard open.
function SystemSkeleton() {
  // Literal width classes only — Tailwind's JIT can't see interpolated ones.
  const labelWidths = ['w-16', 'w-14', 'w-20']
  return (
    <dl className="space-y-3 text-sm" aria-hidden="true">
      {labelWidths.map((w, i) => (
        <div key={i} className="flex items-center justify-between">
          <SkeletonLine className={`h-4 ${w}`} />
          <SkeletonLine className="h-4 w-24" />
        </div>
      ))}
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between">
            <SkeletonLine className="h-3 w-14" />
            <SkeletonLine className="h-3 w-20" />
          </div>
          <SkeletonLine className="h-2 w-full rounded-full" />
        </div>
      ))}
    </dl>
  )
}

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
    <Widget title="System" loading={loading} error={error} skeleton={<SystemSkeleton />}>
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
