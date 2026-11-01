# syntax=docker/dockerfile:1.7
#
# MandiMate web — prerendered public site + /app SPA served by nginx.
#
# The nginx configuration lives in infra/nginx (one source of truth for every deployment) and
# reaches this build through the named build context `nginx-config`. docker-compose.yml wires it
# up; a standalone build passes it explicitly:
#
#   docker build --build-context nginx-config=infra/nginx -t mandimate-web frontend

ARG NODE_IMAGE=node:20-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

# ── Build: client bundle, SSR bundle, prerendered HTML ───────────────────────────────────────
FROM ${NODE_IMAGE} AS build

WORKDIR /app

# Dependencies first: this layer is reused until the manifest or lockfile change.
# .npmrc carries legacy-peer-deps=true, which npm ci needs for this dependency set.
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .

# Public origin baked into canonical URLs, Open Graph tags and sitemap.xml, and the API base
# path the client calls. Build args are visible to `npm run build` as environment variables.
ARG VITE_SITE_URL=https://mandimate.in
ARG VITE_API_BASE=/api/v1

RUN npm run build

# ── Runtime: nginx ───────────────────────────────────────────────────────────────────────────
FROM ${NGINX_IMAGE} AS runtime

LABEL org.opencontainers.image.title="mandimate-web" \
      org.opencontainers.image.description="MandiMate web (prerendered site + SPA on nginx)" \
      org.opencontainers.image.licenses="Proprietary"

COPY --from=nginx-config default.conf /etc/nginx/conf.d/default.conf
COPY --from=nginx-config snippets/ /etc/nginx/snippets/
COPY --from=build /app/dist/client /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1/healthz"]
