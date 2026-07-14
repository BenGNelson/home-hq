import { useEffect, useRef } from 'react'
import { ChevronLeft, Check, RotateCcw, Gamepad2 } from 'lucide-react'
import { SCHEMES, BINDABLE, resolveBindings, describeBinding } from '../../../lib/controlPresets.js'
import { sectionAccent } from '../../../lib/library.js'
import { glowFilter } from '../../../lib/glow.js'

const GAMES = sectionAccent('games')

// The Controls screen.
//
// It exists because there is no right answer to the face buttons. Nintendo's
// confirm (A) is the RIGHT button; Xbox's confirm (A) is the BOTTOM one. Same
// letter, different place — so whichever you match, you break the other. That's a
// preference, not a bug, so it's a choice you get to make; and since the next
// controller you buy will have its own ideas, every button is remappable on top.
//
// Fully driveable from the pad: this is the one screen you'd most want to reach
// when your controller is doing the wrong thing.
export default function ControlsPanel({
  padName,
  scheme,
  bindings,
  listeningFor, // the RetroPad index waiting for a press, or null
  focus,
  onFocus,
  onScheme,
  onListen,
  onReset,
  onBack,
}) {
  // Scheme cards first, then one row per button, then Reset — one flat list so the
  // d-pad just walks it.
  const rows = [...Object.keys(SCHEMES), ...BINDABLE.map((b) => `bind:${b.index}`), 'reset']
  const resolved = resolveBindings({ scheme, custom: bindings })

  const panelRef = useRef(null)
  useEffect(() => panelRef.current?.focus(), [])

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex flex-col bg-slate-950/90 outline-none backdrop-blur-md"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded-lg bg-slate-800/80 px-2.5 py-1.5 text-sm text-slate-200 active:bg-slate-700"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-sm font-medium text-slate-200">Controls</h2>
        <span className="w-16" aria-hidden="true" />
      </div>

      <div className="min-h-0 flex-1 touch-auto overflow-y-auto overscroll-contain px-4 pb-6">
        <p className="mb-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Gamepad2 className="h-3.5 w-3.5" aria-hidden="true" />
          {padName || 'No controller connected'}
        </p>

        {/* The choice that actually matters. */}
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          {Object.values(SCHEMES).map((s) => (
            <SchemeCard
              key={s.id}
              scheme={s}
              active={scheme === s.id}
              focused={rows[focus] === s.id}
              onSelect={() => onScheme(s.id)}
              onHover={() => onFocus(rows.indexOf(s.id))}
            />
          ))}
        </div>

        <p className="mb-4 text-center text-[11px] leading-relaxed text-slate-500">
          Nintendo puts <b className="text-slate-400">A</b> on the right; Xbox puts it on the bottom. You can keep
          the letter or keep the place — not both.
        </p>

        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Buttons</h3>
        <div className="space-y-1.5">
          {BINDABLE.map((b) => {
            const key = `bind:${b.index}`
            const listening = listeningFor === b.index
            const custom = bindings?.[b.index] != null
            return (
              <BindRow
                key={b.index}
                name={b.name}
                value={describeBinding(resolved[b.index])}
                custom={custom}
                listening={listening}
                focused={rows[focus] === key}
                onSelect={() => onListen(b.index)}
                onHover={() => onFocus(rows.indexOf(key))}
              />
            )
          })}
        </div>

        <button
          onClick={onReset}
          onMouseEnter={() => onFocus(rows.indexOf('reset'))}
          aria-current={rows[focus] === 'reset' || undefined}
          className={`mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm transition-colors ${
            rows[focus] === 'reset'
              ? 'border-violet-400 bg-slate-800/80 text-slate-100 ring-2 ring-violet-400/60'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset this controller to the defaults
        </button>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-600">
          The <b className="text-slate-500">Menu</b> button belongs to the app and can’t be reassigned — tap it for the
          game’s Start, hold it for this menu.
        </p>
      </div>
    </div>
  )
}

function SchemeCard({ scheme, active, focused, onSelect, onHover }) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      aria-current={focused || undefined}
      className={`rounded-2xl border p-3 text-left transition-all ${
        focused
          ? 'scale-[1.02] border-violet-400 bg-slate-800/80 ring-2 ring-violet-400/60'
          : active
            ? 'border-violet-500/50 bg-slate-900/70'
            : 'border-slate-700/80 bg-slate-900/50'
      }`}
      style={focused ? { filter: glowFilter(GAMES.rgb, 0.4) } : undefined}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
        {active && <Check className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />}
        {scheme.name}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{scheme.blurb}</span>
    </button>
  )
}

function BindRow({ name, value, custom, listening, focused, onSelect, onHover }) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      aria-current={focused || undefined}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        focused ? 'border-violet-400 bg-slate-800/80 ring-2 ring-violet-400/60' : 'border-slate-800 bg-slate-900/50'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 text-[11px]">
          {name}
        </span>
        <span className="text-slate-500">in game</span>
      </span>
      {listening ? (
        <span className="animate-pulse text-sm font-medium text-violet-300">Press a button…</span>
      ) : (
        <span className={`text-sm ${custom ? 'text-violet-300' : 'text-slate-400'}`}>
          {value}
          {custom && <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-600">custom</span>}
        </span>
      )}
    </button>
  )
}

// The flat row order the d-pad walks. Exported so PlayerShell can drive focus
// against exactly what's on screen.
export function controlRows() {
  return [...Object.keys(SCHEMES), ...BINDABLE.map((b) => `bind:${b.index}`), 'reset']
}
