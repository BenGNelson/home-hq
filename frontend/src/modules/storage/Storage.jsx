import { useApi } from '../../lib/useApi.js'
import { formatBytes, formatAgo } from '../../lib/format.js'
import { Row, Bar, Spinner } from '../../components/ui.jsx'
import { Graph } from '../../components/Graph.jsx'
import { watchdogBadge } from '../../lib/watchdog.js'
import {
  smartBadge,
  roleTag,
  raidRedundancy,
  summarizeProjection,
  seriesPoints,
} from '../../lib/storage.js'

// The Storage page: the deep-dive view of the box's disks. Capacity + growth
// projection, the RAID array's health in plain language, and per-drive SMART
// with trend charts (temperature / wear over time). The dashboard keeps the
// at-a-glance Storage + Drives widgets; this is where you come to investigate.
export default function Storage() {
  const disk = useApi('/disk', 15000)
  const raid = useApi('/raid', 30000)
  const smart = useApi('/smart', 60000)
  const watchdog = useApi('/drive-watchdog', 60000)
  const trends = useApi('/storage/trends', 60000)

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Storage</h2>
      <Capacity disk={disk.data} projection={trends.data?.projection} />
      <RaidDetail raid={raid.data} />
      <Drives smart={smart.data} trends={trends.data} watched={watchdog.data} />
    </div>
  )
}

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-300">{title}</h3>
      {children}
    </section>
  )
}

// --- Capacity + growth projection ---

function Capacity({ disk, projection }) {
  if (!disk) {
    return (
      <Card title="Capacity">
        <Spinner />
      </Card>
    )
  }
  if (disk.available === false) {
    return (
      <Card title="Capacity">
        <p className="text-sm text-amber-400">Storage mount unavailable</p>
      </Card>
    )
  }
  return (
    <Card title="Capacity">
      <div className="space-y-3 text-sm">
        <Bar label={disk.mount} percent={disk.percent} caption={`${disk.percent.toFixed(0)}% full`} />
        <dl className="space-y-2">
          <Row label="Used" value={formatBytes(disk.used_bytes)} />
          <Row label="Free" value={formatBytes(disk.free_bytes)} />
          <Row label="Total" value={formatBytes(disk.total_bytes)} />
        </dl>
        <Projection p={projection} />
      </div>
    </Card>
  )
}

function Projection({ p }) {
  const s = summarizeProjection(p)
  if (s.state === 'unknown') {
    return (
      <p className="border-t border-slate-800 pt-3 text-xs text-slate-500">
        Growth trend: not enough history yet — a daily sample is recorded, so check
        back in a couple of days.
      </p>
    )
  }
  if (s.state === 'flat') {
    return (
      <p className="border-t border-slate-800 pt-3 text-xs text-slate-400">
        Growth trend: usage is stable — not filling up.
      </p>
    )
  }
  const weeks = s.weeksUntilFull
  return (
    <p className="border-t border-slate-800 pt-3 text-xs text-slate-400">
      Growth trend: <span className="text-slate-200">+{formatBytes(s.perWeekBytes)}/week</span>
      {weeks != null && (
        <>
          {' · '}
          <span className={weeks < 8 ? 'text-amber-400' : 'text-slate-200'}>
            full in ~{weeks < 1 ? '<1' : Math.round(weeks)} week{Math.round(weeks) === 1 ? '' : 's'}
          </span>
        </>
      )}
    </p>
  )
}

// --- RAID array detail ---

function RaidDetail({ raid }) {
  if (!raid) {
    return (
      <Card title="RAID array">
        <Spinner />
      </Card>
    )
  }
  const arrays = raid.available ? raid.arrays : []
  if (arrays.length === 0) {
    return (
      <Card title="RAID array">
        <p className="text-sm text-slate-500">No software-RAID array detected.</p>
      </Card>
    )
  }
  return (
    <Card title="RAID array">
      <div className="space-y-4">
        {arrays.map((a) => (
          <Array key={a.name} a={a} />
        ))}
      </div>
    </Card>
  )
}

function Array({ a }) {
  const redundancy = raidRedundancy(a.level)
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-200">
          {a.level?.toUpperCase()} <span className="text-slate-500">({a.name})</span>
        </span>
        <span className={a.healthy ? 'text-emerald-400' : 'text-rose-400'}>
          <span className="mr-1">●</span>
          {a.healthy ? 'Healthy' : 'Degraded'}
          {a.status ? ` [${a.status}]` : ''}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
        {a.devices_total != null && (
          <span>
            {a.devices_active}/{a.devices_total} drives active
          </span>
        )}
        {a.members?.length > 0 && <span>members: {a.members.join(', ')}</span>}
        {redundancy && <span className="text-slate-400">{redundancy}</span>}
      </div>
      {a.failed?.length > 0 && (
        <p className="mt-1 text-xs text-rose-300/80">Failed: {a.failed.join(', ')}</p>
      )}
      {a.resync && (
        <div className="mt-2">
          <Bar
            label={a.resync.action}
            percent={a.resync.percent}
            caption={`${a.resync.percent}%`}
          />
        </div>
      )}
    </div>
  )
}

// --- Per-drive SMART + trends ---

function Drives({ smart, trends, watched }) {
  if (!smart) {
    return (
      <Card title="Drives">
        <Spinner />
      </Card>
    )
  }
  // Hide SMART's unreadable 'other' disks (e.g. a USB enclosure that blocks
  // passthrough); the externally-watched drive is shown from the watchdog below.
  const drives = (smart.available ? smart.drives : []).filter((d) => d.role !== 'other')
  const watch = watched?.available ? watched : null
  const smartTrends = trends?.smart || {}

  if (drives.length === 0 && !watch) {
    return (
      <Card title="Drives">
        <p className="text-sm text-slate-500">
          No SMART data yet — the host collector hasn’t run.
        </p>
      </Card>
    )
  }
  return (
    <Card title="Drives">
      <div className="space-y-5">
        {drives.map((d) => (
          <Drive key={d.name} d={d} trends={smartTrends[d.name]} />
        ))}
        {watch && <WatchedDrive d={watch} />}
      </div>
      {smart.available && smart.generated_at && (
        <p className="mt-3 text-xs text-slate-600">SMART as of {formatAgo(smart.generated_at)}</p>
      )}
    </Card>
  )
}

function Drive({ d, trends }) {
  const b = smartBadge(d)
  const tag = roleTag(d.role)
  return (
    <div className="border-b border-slate-800 pb-5 last:border-0 last:pb-0">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-200">
          {d.name}
          {tag && (
            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${tag.cls}`}>
              {tag.label}
            </span>
          )}
          {d.model && <span className="ml-2 text-xs font-normal text-slate-500">{d.model}</span>}
        </span>
        <span className={b.cls} title={d.message || ''}>
          <span className="mr-1">●</span>
          {b.label}
        </span>
      </div>
      {d.supported && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {d.capacity_bytes != null && <span>{formatBytes(d.capacity_bytes)}</span>}
          {d.temperature_c != null && <span>{d.temperature_c}°C</span>}
          {d.power_on_hours != null && <span>{d.power_on_hours.toLocaleString()} h</span>}
          {d.wear_percent != null && <span>{d.wear_percent}% life used</span>}
          {d.reallocated != null && <span>{d.reallocated} reallocated</span>}
        </div>
      )}
      {d.warnings?.length > 0 && (
        <p className="mt-1 text-xs text-amber-400/90">{d.warnings.join(' · ')}</p>
      )}
      <TrendCharts trends={trends} />
    </div>
  )
}

// Temperature + wear trend mini-charts. Each renders only with >= 2 points.
function TrendCharts({ trends }) {
  if (!trends) return null
  const charts = [
    { key: 'temperature_c', label: 'Temp °C', color: '#38bdf8' },
    { key: 'wear_percent', label: '% life used', color: '#f59e0b' },
  ]
  const visible = charts.filter((c) => (trends[c.key]?.length || 0) >= 2)
  if (visible.length === 0) return null
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {visible.map((c) => {
        const pts = seriesPoints(trends[c.key])
        const last = pts[pts.length - 1]
        return (
          <div key={c.key}>
            <div className="mb-1 flex justify-between text-[10px] text-slate-500">
              <span>{c.label}</span>
              <span className="text-slate-400">now {last}</span>
            </div>
            <Graph series={[{ color: c.color, points: pts }]} heightClass="h-10" height={40} />
          </div>
        )
      })}
    </div>
  )
}

// The externally-watched USB drive: health comes from the watchdog because SMART
// can't read it through the bridge. Mirrors the dashboard widget's treatment.
function WatchedDrive({ d }) {
  const b = watchdogBadge(d)
  return (
    <div className="border-b border-slate-800 pb-5 last:border-0 last:pb-0">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-200">
          {d.label || 'External drive'}
          <span className="ml-2 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">
            EXT
          </span>
          {d.mount && <span className="ml-2 text-xs font-normal text-slate-500">{d.mount}</span>}
        </span>
        <span className={b.cls} title={d.note || ''}>
          <span className="mr-1">●</span>
          {b.label}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
        {d.fstype && <span>{d.fstype}</span>}
        {d.recovery_count > 0 && (
          <span>
            {d.recovery_count} auto-recover{d.recovery_count === 1 ? 'y' : 'ies'}
          </span>
        )}
        {d.last_recovery && <span>last {formatAgo(d.last_recovery)}</span>}
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        SMART can’t be read through this drive’s USB bridge — health is from the
        auto-recovery watchdog instead.
      </p>
    </div>
  )
}
