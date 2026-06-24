import { useState } from 'react'
import {
  Cpu,
  WashingMachine,
  Wrench,
  Hammer,
  Armchair,
  Server,
  Router,
  Car,
  Box,
  Search,
  AlertTriangle,
} from 'lucide-react'
import { useApi } from '../../lib/useApi.js'
import {
  categoryLabel,
  itemTags,
  itemVisible,
  floorItemCount,
} from '../../lib/catalog.js'
import { entityValue, entityColor } from '../../lib/ha.js'
import { homeAssistantUrl } from '../../lib/hostLocal.js'

// The Home Catalog module: a floor-by-floor inventory of the house — smart
// devices (cross-referenced to HA), appliances, AND non-HA physical things
// (tools, 3D printer, computers, network gear). Read-only; the data is a
// host-side YAML file (CATALOG_FILE) parsed by /api/catalog. This is reference
// material, not a control surface — it stays true to "HA is the brain".
export default function Catalog() {
  // Catalog changes only when the YAML is edited, so fetch once (no polling) —
  // a page refresh picks up edits.
  const { data, error, loading } = useApi('/catalog', 0)
  const [q, setQ] = useState('')
  const [onlyHa, setOnlyHa] = useState(false)
  const [onlyFlag, setOnlyFlag] = useState(false)

  return (
    <div>
      {/* Title omitted — the shell's top bar already shows "Home Catalog"; the
          scope line below is kept as it adds context the bar doesn't. */}
      {data?.meta?.scope && <p className="mb-4 text-sm text-slate-500">{data.meta.scope}</p>}

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && <Unavailable />}
      {data && data.available && (
        <Live d={data} filter={{ q, onlyHa, onlyFlag }} setQ={setQ} setOnlyHa={setOnlyHa} setOnlyFlag={setOnlyFlag} />
      )}
    </div>
  )
}

function Live({ d, filter, setQ, setOnlyHa, setOnlyFlag }) {
  const s = d.stats || { total: 0, in_ha: 0, flagged: 0 }
  const filtering = !!(filter.q || filter.onlyHa || filter.onlyFlag)

  return (
    <div className="space-y-6">
      {/* Stats + controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Stat label="items" value={s.total} />
        <Stat label="in Home Assistant" value={s.in_ha} />
        {s.flagged > 0 && <Stat label="to confirm" value={s.flagged} tone="amber" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            value={filter.q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items…"
            aria-label="Search the catalog"
            className="w-full rounded-lg border border-slate-800 bg-slate-900/60 py-2 pl-8 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-600 focus:outline-none"
          />
        </div>
        <Toggle active={filter.onlyHa} onClick={() => setOnlyHa((v) => !v)}>In HA</Toggle>
        <Toggle active={filter.onlyFlag} onClick={() => setOnlyFlag((v) => !v)}>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> To confirm
        </Toggle>
      </div>

      {/* Floors → rooms */}
      {d.floors.map((floor) => (
        <Floor key={floor.id} floor={floor} filter={filter} filtering={filtering} />
      ))}

      {/* Outside / Spares as their own sections */}
      {[d.outside, d.spares].filter(Boolean).map((g) => {
        const items = g.items.filter((it) => itemVisible(it, filter))
        if (filtering && items.length === 0) return null
        return (
          <section key={g.label}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{g.label}</h3>
            <RoomCard items={items} empty={g.items.length === 0} />
          </section>
        )
      })}

      {/* Infrastructure: topology note + roaming items */}
      {d.infrastructure && (() => {
        const items = d.infrastructure.items.filter((it) => itemVisible(it, filter))
        const showTopo = !filtering && d.infrastructure.topology
        if (filtering && items.length === 0) return null
        return (
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Infrastructure</h3>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
              {showTopo && <p className="text-sm text-slate-400">{d.infrastructure.topology}</p>}
              {items.map((it, i) => (
                <ItemRow key={i} item={it} />
              ))}
            </div>
          </section>
        )
      })()}

      {d.live_available && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Live device state from Home Assistant{d.live_stale ? ' (may be stale)' : ''}.
        </p>
      )}
      {filtering && <p className="text-[11px] text-slate-600">Filtered view — clear search/filters to see the whole house.</p>}
      {d.meta?.last_updated && <p className="text-[11px] text-slate-600">Catalog last updated {d.meta.last_updated}.</p>}
    </div>
  )
}

function Floor({ floor, filter, filtering }) {
  const rooms = (floor.rooms || [])
    .map((r) => ({ ...r, _visible: r.items.filter((it) => itemVisible(it, filter)) }))
    // When filtering, drop rooms with no matches; otherwise keep them all.
    .filter((r) => (filtering ? r._visible.length > 0 : true))

  if (rooms.length === 0) return null

  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{floor.label}</h3>
        {!filtering && <span className="text-xs text-slate-600">{floorItemCount(floor)} items</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => (
          <div key={room.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h4 className="mb-2 text-sm font-medium text-slate-200">{room.label}</h4>
            <RoomCard items={room._visible} empty={room.items.length === 0} flat />
          </div>
        ))}
      </div>
    </section>
  )
}

// Renders a list of item rows; if `flat` it omits the outer card (used inside a
// Floor's room cards, which already provide the card frame).
function RoomCard({ items, empty, flat = false }) {
  const body =
    items.length === 0 ? (
      <p className="text-sm text-slate-600">{empty ? 'nothing here' : 'no matches'}</p>
    ) : (
      <div className="space-y-2.5">
        {items.map((it, i) => (
          <ItemRow key={i} item={it} />
        ))}
      </div>
    )
  if (flat) return body
  return <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">{body}</div>
}

function ItemRow({ item }) {
  const tags = itemTags(item)
  return (
    <div className="flex gap-2.5">
      <CategoryIcon category={item.category} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-slate-100">{item.name}</span>
          <LiveChip item={item} />
          {item.in_ha && !item.live && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">HA</span>
          )}
          {item.flag && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">confirm</span>
          )}
        </div>
        {tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
            {tags.map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
        )}
        {item.notes && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{item.notes}</p>}
      </div>
    </div>
  )
}

// A small live-state chip for catalog items whose HA entity the collector
// tracks. Reuses the HA glance's value/color helpers and deep-links into HA's
// history for that entity; falls back to plain text when no HA link is
// configured. Reference + handoff, not control — true to HA-is-the-brain.
function LiveChip({ item }) {
  if (!item.live) return null
  const e = {
    entity_id: item.entity,
    domain: item.entity ? item.entity.split('.')[0] : '',
    state: item.live.state,
    unit: item.live.unit,
    device_class: item.live.device_class,
  }
  const value = entityValue(e)
  const color = entityColor(e)
  const href = item.entity ? homeAssistantUrl(`/history?entity_id=${item.entity}`) : null
  const cls = `inline-flex items-center gap-1 rounded bg-slate-800/70 px-1.5 py-0.5 text-[11px] font-medium ${color}`
  const dot = <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:bg-slate-700/70`} title="View in Home Assistant">
        {dot}
        {value}
      </a>
    )
  }
  return (
    <span className={cls}>
      {dot}
      {value}
    </span>
  )
}

const CATEGORY_ICONS = {
  device: Cpu,
  appliance: WashingMachine,
  tool: Wrench,
  equipment: Hammer,
  furniture: Armchair,
  infrastructure: Server,
  network: Router,
  vehicle: Car,
}

function CategoryIcon({ category }) {
  const Icon = CATEGORY_ICONS[category] || Box
  return (
    <span title={categoryLabel(category)} className="mt-0.5 shrink-0 text-slate-500">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'amber' ? 'text-amber-400' : 'text-slate-100'
  return (
    <span className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-sm">
      <span className={`font-semibold tabular-nums ${color}`}>{value}</span>{' '}
      <span className="text-slate-500">{label}</span>
    </span>
  )
}

function Toggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
        active
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function Unavailable() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">The home catalog isn’t set up yet.</p>
      <p className="mt-2 text-sm text-slate-400">
        Create a catalog YAML host-side, then set{' '}
        <code className="rounded bg-slate-800 px-1">CATALOG_FILE</code> in{' '}
        <code className="rounded bg-slate-800 px-1">.env</code> to its path and restart the backend.
        Use <code className="rounded bg-slate-800 px-1">docs/home-catalog.example.yaml</code> as a template.
      </p>
    </div>
  )
}
