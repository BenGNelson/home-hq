import { Link } from 'react-router-dom'

// The standard "return to where you came from" link for detail, list, and
// reader pages — a muted "← Label". Pass `to` for a route, or `onClick` for a
// history-style back. Keeps every back affordance in the app looking the same.
export default function BackLink({ to, onClick, children, className = '' }) {
  const cls = `inline-flex items-center gap-1 text-sm text-slate-400 transition hover:text-slate-200 ${className}`
  const inner = (
    <>
      <span aria-hidden>←</span> {children}
    </>
  )
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}
