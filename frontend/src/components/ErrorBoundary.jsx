import { Component } from 'react'

// A class error boundary (the only way React lets you catch render/lifecycle
// errors). Without one, an exception thrown inside the tree — e.g. a reader
// engine throwing during render or teardown — unmounts the WHOLE app to a blank
// screen. This catches it and shows a graceful fallback with a way out instead.
//
// Reset behavior is controlled by the caller via `key` (e.g. key={pathname} so
// navigating to a new route remounts the boundary and clears a prior error).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-slate-300">Something went wrong on this screen.</p>
          <p className="max-w-sm text-sm text-slate-500">
            It’s been contained — the rest of the app is fine. Try again, or head back.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-100 active:bg-slate-700"
            >
              Try again
            </button>
            <a
              href="/library"
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-100 active:bg-slate-700"
            >
              Library
            </a>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
