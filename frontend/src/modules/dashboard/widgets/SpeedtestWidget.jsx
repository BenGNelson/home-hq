import { ArrowDown, ArrowUp, Gauge } from 'lucide-react'
import { useApi } from '../../../lib/useApi.js'
import { formatMbps, formatPing } from '../../../lib/speedtest.js'
import { formatAgo, formatDateTime } from '../../../lib/format.js'
import { SkeletonLine } from '../../../components/ui.jsx'
import Widget from './Widget.jsx'

// Sized to mirror the real body at BOTH breakpoints (compact stack below lg, a
// spread 3-up grid at lg+) so the card doesn't grow when the first result swaps
// in (keeps the dashboard's no-layout-shift guarantee).
const speedtestSkeleton = (
  <div aria-hidden="true">
    <div className="space-y-2 lg:hidden">
      <SkeletonLine className="h-8 w-28" />
      <SkeletonLine className="h-4 w-20" />
      <SkeletonLine className="h-3 w-24" />
    </div>
    <div className="hidden lg:block">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="h-8 w-14" />
            <SkeletonLine className="h-2.5 w-8" />
          </div>
        ))}
      </div>
      <SkeletonLine className="mx-auto mt-3 h-3 w-24" />
    </div>
  </div>
)

// The download/upload/ping values, formatted as a big number + small unit so the
// tiles stay narrow enough to fit three-up even in a half-width column. This is
// just the display split of formatMbps/formatPing (same one-decimal rounding).
const num = (n) => (n == null ? '—' : n.toFixed(1))

// Compact internet-speed summary for the dashboard: latest download / upload /
// ping + when it was last measured. Hides itself entirely when the feature is
// off (mirrors SolarWidget), so the dashboard stays clean on setups without a
// speedtest configured.
export default function SpeedtestWidget() {
  const { data, error, loading } = useApi('/speedtest', 5000)
  if (data && data.available === false && data.reason === 'not_enabled') return null

  const noData = data && data.available === false // reason === 'no_data'
  const l = data?.latest

  return (
    <Widget title="Internet Speed" to="/speedtest" loading={loading} error={error} skeleton={speedtestSkeleton}>
      {data &&
        (noData ? (
          <p className="text-sm text-slate-400">{data.running ? 'testing…' : 'no tests yet'}</p>
        ) : (
          <Body l={l} />
        ))}
    </Widget>
  )
}

function Body({ l }) {
  const updated = l?.ts ? (
    // Relative by default (auto-fresh on each 5s poll), exact time on hover.
    <span className="text-xs text-slate-500" title={formatDateTime(l.ts)}>
      Updated {formatAgo(l.ts)}
    </span>
  ) : null

  return (
    <div>
      {/* Below lg (mobile + the narrower two-column widths, incl. iPad mini):
          the compact stack, plus the new "last updated" line. */}
      <div className="space-y-2 text-sm lg:hidden">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-5 w-5 shrink-0 text-sky-400" aria-hidden="true" />
          <span className="text-2xl font-semibold tabular-nums text-slate-100">
            {formatMbps(l?.download_mbps)}
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
            <ArrowUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            {formatMbps(l?.upload_mbps)}
          </span>
        </div>
        <div className="text-xs text-slate-400">ping {formatPing(l?.ping_ms)}</div>
        {updated}
      </div>

      {/* lg+ (desktop, where the wide card was mostly empty): spread download,
          upload and ping evenly across the width as equal labeled tiles — upload
          now reads as a peer of download instead of a tiny right-aligned note. */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-3 gap-2">
          <Metric Icon={ArrowDown} iconClass="text-sky-400" label="Download" value={num(l?.download_mbps)} unit="Mbps" />
          <Metric Icon={ArrowUp} iconClass="text-emerald-400" label="Upload" value={num(l?.upload_mbps)} unit="Mbps" />
          <Metric Icon={Gauge} iconClass="text-fuchsia-400" label="Ping" value={num(l?.ping_ms)} unit="ms" />
        </div>
        {updated && <div className="mt-3 text-center">{updated}</div>}
      </div>
    </div>
  )
}

// One centered metric tile for the wide layout: a colored icon + label over a
// big value with a small unit caption.
function Metric({ Icon, iconClass, label, value, unit }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <span className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-400">
        <Icon className={`h-3.5 w-3.5 ${iconClass}`} aria-hidden="true" />
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-slate-100">{value}</span>
      <span className="text-[10px] text-slate-500">{unit}</span>
    </div>
  )
}
