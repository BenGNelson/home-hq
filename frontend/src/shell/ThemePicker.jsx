import { useEffect, useRef, useState } from 'react'

// Dark themes. `bg`/`accent` are fixed preview swatches so each one shows its
// own colour regardless of the active theme. Applying a theme sets data-theme
// on <html>, which swaps the CSS color variables (see index.css).
export const THEMES = [
  { id: 'slate', name: 'Slate', bg: '#0f172a', accent: '#34d399' },
  { id: 'carbon', name: 'Carbon', bg: '#0b0b0b', accent: '#34d399' },
  { id: 'olive', name: 'Olive', bg: '#141a0f', accent: '#a3e635' },
  { id: 'crimson', name: 'Crimson', bg: '#1d0d0f', accent: '#f87171' },
  { id: 'indigo', name: 'Midnight', bg: '#11132e', accent: '#818cf8' },
]

function applyTheme(id) {
  document.documentElement.dataset.theme = id
  localStorage.setItem('hq-theme', id)
  // Keep the browser/PWA chrome colour in sync with the page background.
  const meta = document.querySelector('meta[name="theme-color"]')
  const t = THEMES.find((x) => x.id === id)
  if (meta && t) meta.setAttribute('content', t.bg)
}

// A round swatch: theme background with a centred accent dot.
function Swatch({ bg, accent, size = 'h-5 w-5', dot = 'h-2 w-2' }) {
  return (
    <span
      className={`flex ${size} items-center justify-center rounded-full border border-slate-700`}
      style={{ background: bg }}
    >
      <span className={`block ${dot} rounded-full`} style={{ background: accent }} />
    </span>
  )
}

// A compact theme button that expands into a popover of all themes.
export default function ThemePicker() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'slate',
  )
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => applyTheme(theme), [theme])

  // Close the popover on an outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-expanded={open}
        title="Theme"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 transition hover:border-slate-500"
        style={{ background: current.bg }}
      >
        <Swatch bg={current.bg} accent={current.accent} size="h-4 w-4" dot="h-2 w-2" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-xl shadow-black/40">
          <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Theme
          </p>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTheme(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                theme === t.id
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <Swatch bg={t.bg} accent={t.accent} />
              <span>{t.name}</span>
              {theme === t.id && <span className="ml-auto text-emerald-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
