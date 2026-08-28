# syntax=docker/dockerfile:1
#
# Web-app-image (T19.1). Build-context is de **repo-root** (npm-workspaces, `shared/`):
#
#   docker build -f web/Dockerfile --build-arg VITE_API_URL=http://localhost:3000 -t intento-web .
#
# `VITE_API_URL` is een **build**-argument, geen runtime-variabele: Vite bakt de waarde in de bundel.
# Wijs je de app naar een andere API-host, dan hoort daar een nieuwe build bij. Dat de API op een
# eigen host/poort staat is bewust — de SPA heeft een route `/operator` en de API een routetak
# `/operator/*`, dus één origin delen zou botsen (zie ADR-0016).

# --- Bouwen ---------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY web/ web/

ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace=shared \
    && npm run build --workspace=web

# --- Serveren -------------------------------------------------------------------------------------
FROM nginx:1.29-alpine AS runtime
# Alpine mag hier wél: nginx serveert statische bestanden, er wordt niets natives gecompileerd.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/web/dist /usr/share/nginx/html
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1
