# syntax=docker/dockerfile:1
#
# Backend-image (T19.1). Build-context is de **repo-root**: dit is een npm-workspaces-monorepo en de
# server hangt aan `shared/`. Bouwen vanuit `server/` alleen zou dus niet werken.
#
#   docker build -f server/Dockerfile -t intento-server .
#
# Debian (`bookworm-slim`) en niet Alpine, omdat `argon2` en `better-sqlite3` native modules zijn die
# tegen glibc bouwen; op musl kost dat een eigen toolchain en een hoop tijd.

# --- Bouwen ---------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Toolchain voor de native modules (argon2, better-sqlite3) als er geen prebuild beschikbaar is.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Eerst alleen de manifesten: dan blijft de dependency-laag in de cache zolang die niet wijzigen.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# `--ignore-scripts` houdt de postinstall (`prisma generate`) buiten deze laag: het schema komt pas
# hierna binnen, en zonder schema faalt die stap. Let op: het zet óók de *install*-scripts van de
# native modules stil — zonder de `npm rebuild` verderop mist `better-sqlite3` zijn binding en valt de
# eerste databasequery om (`Could not locate the bindings file`), terwijl `/health` nog vrolijk 200 geeft.
RUN npm ci --ignore-scripts

# Daarna de bron. `web/` hoeft hier niet mee — dat image bouwt apart.
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/

# Nu pas de native modules bouwen (argon2, better-sqlite3): hun install-scripts stonden hierboven uit.
RUN npm rebuild better-sqlite3 argon2

# `npm run build --workspace=server` doet zelf `prisma generate && tsc`.
RUN npm run build --workspace=shared \
    && npm run build --workspace=server \
    # De dev-dependencies (typescript, vitest, eslint, vite…) hebben in het draaiende image niets te
    # zoeken; dat scheelt honderden MB's. `prisma` staat daarom bij de *dependencies*: het entrypoint
    # draait `migrate deploy` bij elke start, dus de CLI is hier runtime en geen ontwikkelgereedschap.
    && npm prune --omit=dev

# --- Draaien --------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `dumb-init` zorgt dat SIGTERM bij Node aankomt (netjes stoppen i.p.v. na tien seconden gekilld).
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# In een npm-workspaces-installatie staan de pakketten **gehesen** in de root-`node_modules`; er is dus
# geen `server/node_modules` om te kopiëren. `@intento/shared` staat er als symlink naar `../shared`,
# vandaar dat `shared/dist` en `shared/package.json` hieronder ook meekomen.
# De (gesnoeide) node_modules komen mee: de native modules zijn in de builder al voor deze basis
# gebouwd, dus hier is geen compiler meer nodig.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/prisma.config.ts ./server/prisma.config.ts
COPY --from=builder /app/server/prisma ./server/prisma
COPY docker/entrypoint-server.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# De database staat op een volume, niet in het image: `/data` is van de container-gebruiker.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
WORKDIR /app/server
ENV DATABASE_URL=file:/data/intento.db \
    PORT=3000
EXPOSE 3000

# Geen curl/wget in dit image; Node kan zelf prima een verzoek doen.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/entrypoint.sh"]
