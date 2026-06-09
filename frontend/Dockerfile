# Production image: build the static site, then serve it with nginx.
# nginx also reverse-proxies /api to the backend, so the browser sees one
# origin (same contract as the dev server's Vite proxy). This replaces the
# Vite dev server as the always-on frontend; dev hot-reload still lives in
# Dockerfile.dev (compose "dev" profile).

# --- build stage: compile the React app + generate the PWA assets ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- serve stage: static files behind nginx ---
FROM nginx:alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
