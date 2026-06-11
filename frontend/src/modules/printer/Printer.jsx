import { useState, useEffect } from 'react'
import { useApi, API_BASE } from '../../lib/useApi.js'
import { formatMinutes } from '../../lib/format.js'
import { printerUnavailableMessage } from '../../lib/printer.js'
import StateBadge from './StateBadge.jsx'
import { FilamentSpool } from './Filament.jsx'

// The Printer module: live telemetry from a Bambu printer over LAN MQTT.
// Read-only for now (temps, progress, AMS, errors); controls + camera later.
export default function Printer() {
  const { data, error, loading } = useApi('/printer', 3000)
  const name = data?.name ?? '3D Printer'

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">{name}</h2>

      {loading && !data && <p className="text-sm text-slate-500">loading…</p>}
      {error && <p className="text-sm text-rose-400">unavailable — {error}</p>}

      {data && data.available === false && (
        <Unavailable reason={data.reason} />
      )}

      {data && data.available && <Telemetry p={data.printer} camera={data.camera} />}
    </div>
  )
}

// Chamber camera: the backend serves one JPEG per request (connecting on demand),
// so we just re-fetch with a cache-buster ~1/sec. Rides out the initial connect
// latency before declaring it offline, and auto-recovers when frames return.
function Camera() {
  const [tick, setTick] = useState(0)
  const [errs, setErrs] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const offline = errs >= 4
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
      <img
        src={`${API_BASE}/printer/camera?t=${tick}`}
        alt="Chamber camera"
        className="mx-auto block max-h-[60vh] w-full object-contain"
        style={offline ? { display: 'none' } : undefined}
        onLoad={() => setErrs(0)}
        onError={() => setErrs((e) => e + 1)}
      />
      {offline && (
        <p className="p-8 text-center text-sm text-slate-500">Camera offline</p>
      )}
    </div>
  )
}

function Unavailable({ reason }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <p className="text-amber-400">{printerUnavailableMessage(reason)}</p>
      {reason === 'not_configured' && (
        <p className="mt-2 text-sm text-slate-400">
          Set{' '}
          <code className="rounded bg-slate-800 px-1">PRINTER_HOST</code>,{' '}
          <code className="rounded bg-slate-800 px-1">PRINTER_ACCESS_CODE</code> and{' '}
          <code className="rounded bg-slate-800 px-1">PRINTER_SERIAL</code> in{' '}
          <code className="rounded bg-slate-800 px-1">.env</code> (from the printer’s
          Network &amp; Device screens — no LAN-Only mode needed) and restart the backend.
        </p>
      )}
      {reason === 'offline' && (
        <p className="mt-2 text-sm text-slate-400">
          The backend is configured but isn't hearing from the printer — it's likely
          powered off, asleep, or off the network.
        </p>
      )}
    </div>
  )
}

function Telemetry({ p, camera }) {
  const printing = p.state === 'RUNNING'
  const eta =
    printing && p.remaining_min != null
      ? new Date(Date.now() + p.remaining_min * 60000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

  return (
    <div className="space-y-4">
      {camera && <Camera />}

      {/* Status header */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <StateBadge state={p.state} />
          {p.stage && <span className="text-sm text-slate-400">{p.stage}</span>}
          {p.file && (
            <span className="ml-auto truncate text-sm text-slate-300" title={p.file}>
              {p.file}
            </span>
          )}
        </div>

        {printing && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-slate-400">
              <span>
                {p.layer != null && p.total_layers != null
                  ? `Layer ${p.layer} / ${p.total_layers}`
                  : 'Printing'}
              </span>
              <span className="font-medium text-slate-200">{p.progress ?? 0}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${p.progress ?? 0}%` }}
              />
            </div>
            {p.remaining_min != null && (
              <p className="mt-2 text-sm text-slate-400">
                {formatMinutes(p.remaining_min)} remaining
                {eta && <span className="text-slate-500"> · done ~{eta}</span>}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-300">Controls</h3>
        <Controls p={p} />
      </div>

      {/* AMS filament — front and center, big color swatches */}
      {p.ams?.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="mb-4 text-sm font-medium text-slate-300">Filament (AMS)</h3>
          <div className="space-y-4">
            {p.ams.map((unit) => (
              <div key={unit.id} className="flex flex-wrap gap-4">
                {unit.trays.map((tray) => (
                  <FilamentSpool key={tray.slot} tray={tray} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Temperatures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TempCard label="Nozzle" temp={p.nozzle} />
        <TempCard label="Bed" temp={p.bed} />
        <TempCard label="Chamber" temp={{ current: p.chamber, target: null }} />
      </div>

      {/* HMS errors */}
      {p.hms?.length > 0 && (
        <div className="rounded-xl border border-rose-900/50 bg-rose-950/30 p-4">
          <h3 className="mb-2 text-sm font-medium text-rose-300">Printer alerts</h3>
          <ul className="space-y-1 text-sm text-rose-200">
            {p.hms.map((h, i) => (
              <li key={i}>
                Code {h.code ?? '—'} (attr {h.attr ?? '—'})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Misc footer */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
        {p.speed_level != null && <span>Speed level {p.speed_level}</span>}
        {p.fans?.part != null && <span>Part fan {p.fans.part}%</span>}
        {p.fans?.aux != null && <span>Aux fan {p.fans.aux}%</span>}
        {p.light != null && <span>Light {p.light ? 'on' : 'off'}</span>}
      </div>
    </div>
  )
}

// Full class strings per tone so Tailwind's scanner keeps them.
const BTN_TONE = {
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/40 hover:bg-amber-500/25',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40 hover:bg-emerald-500/25',
  rose: 'bg-rose-500/20 text-rose-200 ring-rose-500/50 hover:bg-rose-500/30',
  roseOutline: 'text-rose-300 ring-rose-500/40 hover:bg-rose-500/10',
  slate: 'bg-slate-700/40 text-slate-200 ring-slate-600/50 hover:bg-slate-700/60',
}

function Btn({ tone, ...rest }) {
  return (
    <button
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${BTN_TONE[tone]}`}
      {...rest}
    />
  )
}

function Controls({ p }) {
  const [busy, setBusy] = useState(null)
  const [confirmStop, setConfirmStop] = useState(false)

  // Auto-cancel a pending stop confirmation if not clicked again shortly.
  useEffect(() => {
    if (!confirmStop) return
    const id = setTimeout(() => setConfirmStop(false), 4000)
    return () => clearTimeout(id)
  }, [confirmStop])

  const send = async (action) => {
    setBusy(action)
    try {
      await fetch(`${API_BASE}/printer/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    } catch {
      /* the next poll reflects the real state regardless */
    }
    setBusy(null)
    setConfirmStop(false)
  }

  const running = p.state === 'RUNNING'
  const paused = p.state === 'PAUSE'
  const active = running || paused
  const disabled = busy !== null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {running && (
        <Btn tone="amber" disabled={disabled} onClick={() => send('pause')}>
          Pause
        </Btn>
      )}
      {paused && (
        <Btn tone="emerald" disabled={disabled} onClick={() => send('resume')}>
          Resume
        </Btn>
      )}
      {active &&
        (confirmStop ? (
          <Btn tone="rose" disabled={disabled} onClick={() => send('stop')}>
            Confirm stop?
          </Btn>
        ) : (
          <Btn tone="roseOutline" disabled={disabled} onClick={() => setConfirmStop(true)}>
            Stop
          </Btn>
        ))}
      <Btn
        tone="slate"
        disabled={disabled}
        onClick={() => send(p.light ? 'light_off' : 'light_on')}
      >
        {p.light ? 'Light off' : 'Light on'}
      </Btn>
    </div>
  )
}

function TempCard({ label, temp }) {
  const current = temp?.current
  const target = temp?.target
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">
        {current == null ? '—' : `${Math.round(current)}°`}
      </div>
      {target != null && target > 0 && (
        <div className="text-xs text-slate-500">→ {Math.round(target)}°</div>
      )}
    </div>
  )
}

