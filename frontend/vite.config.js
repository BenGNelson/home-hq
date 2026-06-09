import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Dev server config. In development the browser loads this Vite server, which
// hot-reloads on save. Calls to /api are proxied to the backend container so
// the whole app behaves as one origin (no CORS, same URLs as production).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Turns the production build into an installable PWA: generates the web
    // app manifest + a service worker that precaches the built app shell so it
    // launches instantly from the home screen. We deliberately do NOT cache
    // /api (live server data should always hit the network), so the service
    // worker only handles the static shell. Disabled in dev to avoid stale
    // caches while iterating.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Home HQ',
        short_name: 'Home HQ',
        description: 'Home server dashboard and control panel.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the build output only; never let the SW serve API responses.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    host: true, // listen on 0.0.0.0 so the port is reachable from outside the container
    port: 5173,
    // Accept the Host header when reached over a Tailscale HTTPS hostname
    // (*.ts.net), which `tailscale serve` proxies to this dev server. Without
    // this, Vite blocks the request as an unrecognized host. LAN access by
    // IP:port is unaffected.
    allowedHosts: ['.ts.net'],
    watch: { usePolling: true }, // reliable file-watching across a Docker bind mount
    proxy: {
      // "backend" is the compose service name; Docker's network resolves it.
      '/api': { target: 'http://backend:8000', changeOrigin: true },
    },
  },
})
