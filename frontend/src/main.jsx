import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { OnlineProvider } from './lib/online.jsx'
import { requestPersist } from './lib/offlineStore.js'
import './index.css'

// Best-effort, once at startup: ask the browser to keep our offline downloads
// from being evicted under storage pressure (installed PWAs usually get this
// without a prompt). Fire-and-forget — failure is harmless.
requestPersist()

// Entry point: mount React into #root, wrapped in the router so modules can
// live at their own URLs, and in OnlineProvider so the app knows when the
// server is unreachable (and can fall back to downloaded content).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OnlineProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </OnlineProvider>
  </React.StrictMode>,
)
