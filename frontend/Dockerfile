# Production image: build the static site, then serve it with nginx.
# nginx also reverse-proxies /api to the backend, so the browser sees one
# origin (same contract as the dev server's Vite proxy). This replaces the
# Vite dev server as the always-on frontend; dev hot-reload still lives in
# Dockerfile.dev (compose "dev" profile).

# --- build stage: compile the React app + generate the PWA assets ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci  # exact lockfile install (deterministic; fails on drift) vs npm install
COPY . .
RUN npm run build

# --- serve stage: static files behind nginx ---
FROM nginx:alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# Liveness: confirm nginx is actually serving the shell on :80. nginx:alpine
# ships wget (not curl); --spider does a request without saving the body. Use
# 127.0.0.1, not localhost — localhost resolves to ::1 first, but nginx only
# binds IPv4, so a localhost probe gets connection-refused.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
