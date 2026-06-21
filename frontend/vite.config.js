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
    // Turns the production build into an installable PWA. We use the
    // `injectManifest` strategy with our OWN service worker (src/sw.js) instead
    // of the auto-generated one, so the caching behavior is exactly what we say
    // it is — the foundation of the offline feature's audit-grade transparency
    // (precache the shell + serve explicit downloads cache-first; never cache
    // anything else implicitly). The plugin injects the precache manifest at
    // `self.__WB_MANIFEST` in our SW. Disabled in dev to avoid stale caches.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
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
      injectManifest: {
        // Precache the built shell only. The self-hosted EmulatorJS engine/cores
        // (frontend/public/emulatorjs/, ~300 MB) and the isolated emulator host
        // page load on demand — never precache them (would bloat the install and
        // blow the size cap).
        globIgnores: ['**/emulatorjs/**', 'emulator.html'],
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
