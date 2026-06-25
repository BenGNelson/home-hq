import { useState, useEffect } from 'react'
import { Check, RotateCw, X } from 'lucide-react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { useDiskRates } from '../../lib/useRates.js'
import { formatBytes, formatAgo, formatRate } from '../../lib/format.js'
import { Row, Bar, Spinner } from '../../components/ui.jsx'
import { Graph } from '../../components/Graph.jsx'
import { watchdogBadge } from '../../lib/watchdog.js'
import { attrNote, attrHealth } from '../../lib/smart.js'
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
      <Capacity disk={disk.data} projection={trends.data?.projection} />
      <SpaceBreakdown />
      <RaidDetail raid={raid.data} />
      <DiskActivity />
      <Drives smart={smart.data} trends={trends.data} watched={watchdog.data} />
      <Database />
    </div>
  )
}

// The Home HQ SQLite database: total size + per-table row counts, so its growth
// is visible. Sampler/log tables show a cap (the runaway-growth backstop); a bar
// shows how much of that cap is used.
function Database() {
  const { data, error, loading } = useApi('/storage/db', 60000)
  return (
    <Card title="Database (Home HQ)">
      {loading && !data && <Spinner label="reading database…" />}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}
      {data && (
        <div className="space-y-3">
          <Row label="On disk" value={formatBytes(data.size_bytes)} />
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Table</th>
                  <th className="px-3 py-1.5 text-right font-medium">Rows</th>
                  <th className="px-3 py-1.5 text-right font-medium">Cap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.tables.map((t) => (
                  <tr key={t.name} className="bg-slate-900/40">
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-300">{t.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-200">
                      {t.rows.toLocaleString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                      {t.cap ? (
                        <span title={`${Math.round((t.rows / t.cap) * 100)}% of cap`}>
                          {t.cap.toLocaleString()}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600">
            Capped tables drop their oldest rows past the cap; an alert fires if the file ever
            grows past its size limit.
          </p>
        </div>
      )}
    </Card>
  )
}

// --- Live disk I/O throughput ---

// md* is the software-RAID aggregate; everything else is a physical disk.
function describeDisk(name) {
  if (/^md\d+$/.test(name)) return 'RAID array (aggregate)'
  return 'Physical disk'
}

function DiskActivity() {
  const { rates, error } = useDiskRates(2000, 60)
  const names = Object.keys(rates)
  return (
    <Card title="Disk activity">
      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : names.length === 0 ? (
        <p className="text-sm text-slate-500">sampling… (2s, ~2 min window)</p>
      ) : (
        <div className="space-y-4">
          {names.map((name) => {
            const r = rates[name]
            return (
              <div key={name}>
                <div className="mb-1 flex items-start justify-between gap-4">
                  <div>
                    <span className="font-mono text-sm text-slate-200">{name}</span>
                    <span className="ml-2 text-xs text-slate-500">{describeDisk(name)}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end text-xs tabular-nums">
                    <span className="text-sky-400">↑ read {formatRate(r.readRate)}</span>
                    <span className="text-amber-400">↓ write {formatRate(r.writeRate)}</span>
                  </div>
                </div>
                <Graph
                  heightClass="h-16"
                  formatValue={formatRate}
                  legend={[
                    { label: 'read', color: '#38bdf8' },
                    { label: 'write', color: '#f59e0b' },
                  ]}
                  caption="live · ~2 min window"
                  series={[
                    { color: '#38bdf8', points: r.readHistory },
                    { color: '#f59e0b', points: r.writeHistory },
                  ]}
                />
              </div>
            )
          })}
        </div>
      )}
    </Card>
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

// --- What's using space (cached daily du breakdown) ---

// A neutral palette so the largest few directories are easy to tell apart.
const SPACE_COLORS = ['#38bdf8', '#34d399', '#a78bfa', '#f59e0b', '#f472b6', '#2dd4bf']

function SpaceBreakdown() {
  const { data, error, loading } = useApi('/storage/space', 300000)
  if (loading && !data) {
    return (
      <Card title="What's using space">
        <Spinner />
      </Card>
    )
  }
  if (error || !data || data.available === false) {
    return (
      <Card title="What's using space">
        <p className="text-sm text-slate-500">
          Breakdown pending — a daily background scan measures the array; check back
          once it has run.
        </p>
      </Card>
    )
  }
  const total = data.total_bytes || data.entries.reduce((s, e) => s + e.bytes, 0) || 1
  return (
    <Card title="What's using space">
      <div className="space-y-2 text-sm">
        {data.entries.map((e, i) => {
          const pct = (e.bytes / total) * 100
          return (
            <div key={e.name}>
              <div className="mb-0.5 flex items-baseline justify-between">
                <span className="truncate text-slate-300">{e.name}</span>
                <span className="ml-2 shrink-0 tabular-nums text-slate-400">
                  {formatBytes(e.bytes)} <span className="text-slate-600">· {pct.toFixed(0)}%</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: SPACE_COLORS[i % SPACE_COLORS.length] }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-slate-600">
        {formatBytes(total)} across {data.entries.length} folders · scanned{' '}
        {formatAgo(data.scanned_at)}
      </p>
    </Card>
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
  const [open, setOpen] = useState(false)
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
      {d.supported && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            {open ? '▾' : '▸'} SMART attributes
          </button>
          {open && <AttributeTable name={d.name} />}
        </div>
      )}
    </div>
  )
}

// The full SMART attribute table — fetched on demand (kept out of the polled
// /smart list) when a drive row is expanded.
function AttributeTable({ name }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/smart/${name}/attributes`)
      .then((r) => r.json())
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [name])

  if (error) return <p className="mt-2 text-xs text-rose-400">couldn’t load attributes</p>
  if (!data) return <p className="mt-2 text-xs text-slate-500">loading attributes…</p>
  if (!data.available) return <p className="mt-2 text-xs text-slate-500">No attribute detail.</p>
  if (data.nvme && (!data.attributes || data.attributes.length === 0)) {
    return <NvmeHealth nvme={data.nvme} />
  }
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-2 font-medium">ID</th>
            <th className="py-1 pr-2 font-medium">Attribute</th>
            <th className="py-1 pr-2 text-right font-medium">Value</th>
            <th className="py-1 pr-2 text-right font-medium">Worst</th>
            <th className="py-1 pr-2 text-right font-medium">Thresh</th>
            <th className="py-1 text-right font-medium">Raw</th>
          </tr>
        </thead>
        <tbody>
          {data.attributes.map((a) => {
            const h = attrHealth(a)
            const note = attrNote(a.id)
            const nameCls =
              h === 'fail' ? 'text-rose-400' : h === 'warn' ? 'text-amber-400' : 'text-slate-300'
            return (
              <tr key={a.id} className="border-t border-slate-800/60 align-top">
                <td className="py-1 pr-2 tabular-nums text-slate-500">{a.id}</td>
                <td className="py-1 pr-2">
                  <span className={nameCls}>{a.name}</span>
                  {note && <p className="text-[10px] leading-snug text-slate-600">{note}</p>}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-slate-400">{a.value ?? '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums text-slate-500">{a.worst ?? '—'}</td>
                <td className="py-1 pr-2 text-right tabular-nums text-slate-500">{a.thresh ?? '—'}</td>
                <td className="py-1 text-right tabular-nums text-slate-300">{a.raw ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// NVMe drives report a health log instead of an ATA attribute table.
function NvmeHealth({ nvme }) {
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
      {Object.entries(nvme).map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-slate-800/40 py-0.5">
          <dt className="text-slate-500">{k.replace(/_/g, ' ')}</dt>
          <dd className="tabular-nums text-slate-300">{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

// Temperature + wear trend mini-charts. Each renders only with >= 2 points.
function TrendCharts({ trends }) {
  if (!trends) return null
  const charts = [
    { key: 'temperature_c', label: 'Temp °C', color: '#38bdf8', unit: '°C' },
    { key: 'wear_percent', label: '% life used', color: '#f59e0b', unit: '%' },
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
            <Graph series={[{ color: c.color, points: pts }]} heightClass="h-10" height={40} unit={c.unit} />
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
      <RecoveryLog events={d.recoveries} />
    </div>
  )
}

// Recent wedge/recovery events from the watchdog's append-only log.
const EVENT_STYLE = {
  recovered: { cls: 'text-emerald-400', Icon: Check },
  remounted: { cls: 'text-sky-400', Icon: RotateCw },
  'recovery-failed': { cls: 'text-rose-400', Icon: X },
}

function RecoveryLog({ events }) {
  if (!events || events.length === 0) return null
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Recent recoveries
      </p>
      <ul className="space-y-1">
        {events.map((e, i) => {
          const s = EVENT_STYLE[e.event] || { cls: 'text-slate-400', Icon: null }
          return (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className={`${s.cls} flex shrink-0`}>
                {s.Icon ? (
                  <s.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{formatAgo(e.ts)}</span>
              <span className="text-slate-400">{e.detail || e.event}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
