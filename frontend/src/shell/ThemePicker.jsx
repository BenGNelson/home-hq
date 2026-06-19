import { useEffect, useRef, useState } from 'react'

// Dark themes. `bg`/`accent` are fixed preview colours so each tile shows its
// own palette regardless of the active theme. Applying a theme sets data-theme
// on <html>, which swaps the CSS color variables (see index.css).
export const THEMES = [
  { id: 'slate', name: 'Slate', bg: '#0f172a', accent: '#34d399' },
  { id: 'carbon', name: 'Carbon', bg: '#0b0b0b', accent: '#34d399' },
  { id: 'olive', name: 'Olive', bg: '#141a0f', accent: '#a3e635' },
  { id: 'crimson', name: 'Crimson', bg: '#1d0d0f', accent: '#f87171' },
  { id: 'indigo', name: 'Midnight', bg: '#11132e', accent: '#818cf8' },
  { id: 'onyx', name: 'Onyx', bg: '#101216', accent: '#34d399' },
]

function applyTheme(id) {
  document.documentElement.dataset.theme = id
  localStorage.setItem('hq-theme', id)
  // Keep the browser/PWA chrome colour in sync with the page background.
  const meta = document.querySelector('meta[name="theme-color"]')
  const t = THEMES.find((x) => x.id === id)
  if (meta && t) meta.setAttribute('content', t.bg)
}

// A small live-looking preview of a theme: its background with an accent dot +
// bar and a couple of muted "content" lines, so each option reads as a mini UI
// rather than a single colour swatch.
function ThemePreview({ bg, accent }) {
  return (
    <div
      className="h-12 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-white/10"
      style={{ background: bg }}
    >
      <div className="flex h-full flex-col justify-center gap-1.5 px-2.5">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
          <span
            className="h-1.5 w-10 rounded-full"
            style={{ background: accent, opacity: 0.55 }}
          />
        </span>
        <span className="h-1.5 w-full rounded-full bg-white/10" />
        <span className="h-1.5 w-2/3 rounded-full bg-white/10" />
      </div>
    </div>
  )
}

// A compact theme button that expands into a popover grid of theme previews.
export default function ThemePicker() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'slate',
  )
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false) // drives the open transition
  const ref = useRef(null)

  useEffect(() => applyTheme(theme), [theme])

  // Animate the panel in on the frame after it mounts (scale/fade).
  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [open])

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
        className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 transition ${
          open ? 'ring-slate-500' : 'ring-slate-700 hover:ring-slate-500'
        }`}
        style={{ background: current.bg }}
      >
        <span
          className="block h-3.5 w-3.5 rounded-full ring-2 ring-black/20"
          style={{ background: current.accent }}
        />
      </button>

      {open && (
        <div
          className={`absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-2xl border border-slate-800 bg-slate-900/95 p-3 shadow-xl shadow-black/50 backdrop-blur transition duration-150 ${
            shown ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}
        >
          <p className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Theme
          </p>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((t) => {
              const active = theme === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTheme(t.id)
                    setOpen(false)
                  }}
                  aria-pressed={active}
                  className={`rounded-xl border p-1.5 text-left transition ${
                    active
                      ? 'border-slate-500 bg-slate-800/60'
                      : 'border-slate-800 hover:border-slate-600 hover:bg-slate-800/40'
                  }`}
                >
                  <ThemePreview bg={t.bg} accent={t.accent} />
                  <div className="mt-1.5 flex items-center justify-between px-0.5">
                    <span className={`text-xs ${active ? 'text-white' : 'text-slate-300'}`}>
                      {t.name}
                    </span>
                    {active && (
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                        style={{ background: t.accent, color: '#0b0b0b' }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
