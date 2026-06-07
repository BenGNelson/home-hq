// Shared frame for every dashboard widget: a titled card that renders one of
// three states — error, loading (no data yet), or its children (the data).
export default function Widget({ title, loading, error, className = '', children }) {
  return (
    <section
      className={`rounded-xl border border-slate-800 bg-slate-900/50 p-4 ${className}`}
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        {loading && <span className="text-xs text-slate-500">…</span>}
      </header>
      {error ? (
        <p className="text-sm text-rose-400">unavailable — {error}</p>
      ) : (
        children || <p className="text-sm text-slate-500">loading…</p>
      )}
    </section>
  )
}
