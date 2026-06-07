import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server config. In development the browser loads this Vite server, which
// hot-reloads on save. Calls to /api are proxied to the backend container so
// the whole app behaves as one origin (no CORS, same URLs as production).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on 0.0.0.0 so the port is reachable from outside the container
    port: 5173,
    watch: { usePolling: true }, // reliable file-watching across a Docker bind mount
    proxy: {
      // "backend" is the compose service name; Docker's network resolves it.
      '/api': { target: 'http://backend:8000', changeOrigin: true },
    },
  },
})
