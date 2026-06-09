import { useEffect, useState } from 'react'

// Dark themes. `bg`/`accent` are fixed preview swatches (so each dot shows its
// own colour regardless of the active theme). Applying a theme just sets
// data-theme on <html>, which swaps the CSS color variables (see index.css).
export const THEMES = [
  { id: 'slate', name: 'Slate', bg: '#0f172a', accent: '#34d399' },
  { id: 'carbon', name: 'Carbon', bg: '#0b0b0b', accent: '#34d399' },
  { id: 'olive', name: 'Olive', bg: '#141a0f', accent: '#a3e635' },
  { id: 'crimson', name: 'Crimson', bg: '#1d0d0f', accent: '#f87171' },
  { id: 'indigo', name: 'Midnight', bg: '#11132e', accent: '#818cf8' },
]

export default function ThemePicker() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'slate',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('hq-theme', theme)
    // Keep the browser/PWA chrome colour in sync with the page background.
    const meta = document.querySelector('meta[name="theme-color"]')
    const t = THEMES.find((x) => x.id === theme)
    if (meta && t) meta.setAttribute('content', t.bg)
  }, [theme])

  return (
    <div className="px-2">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Theme
      </p>
      <div className="flex gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            title={t.name}
            aria-label={`${t.name} theme`}
            aria-pressed={theme === t.id}
            className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${
              theme === t.id
                ? 'border-transparent ring-2 ring-slate-300 ring-offset-2 ring-offset-slate-900'
                : 'border-slate-700 hover:border-slate-500'
            }`}
            style={{ background: t.bg }}
          >
            <span
              className="block h-2.5 w-2.5 rounded-full"
              style={{ background: t.accent }}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
