# Deployment

MandiMate ships as two images plus PostgreSQL, orchestrated by Docker Compose. The same files run
the production-like stack on a laptop (`make up`) and a single-server pilot deployment.

## Topology

```text
                 :443 TLS terminator (Caddy, cloud load balancer, ...)   ← production only
                                   │ HTTP
                                   ▼
┌────────────────────────── compose network ──────────────────────────────┐
│  web    nginx:1.27-alpine    :80  (published on MANDIMATE_WEB_PORT, 8080)  │
│         prerendered site · /app SPA fallback · immutable /assets         │
│         /api/*, /media/*  ──proxy──►  api:8000                           │
│                                                                          │
│  api    python:3.12-slim     :8000 (not published)                       │
│         alembic upgrade head → uvicorn app.main:app --proxy-headers      │
│         volume mandimate-media → /app/media (uploaded photos)              │
│                                                                          │
│  db     postgres:17-alpine   :5432 (published on MANDIMATE_DB_PORT)        │
│         volume mandimate-db-data → /var/lib/postgresql/data                │
└──────────────────────────────────────────────────────────────────────────┘
          api ──► DeepSeek API (only when AI_MODE resolves to live)
```

| Service | Profile | Image | Health check | Depends on |
|---|---|---|---|---|
| `db` (`mandimate-db`) | always | `postgres:17-alpine` | `pg_isready` | |
| `api` (`mandimate-api`) | `full` | built from `backend/Dockerfile` | `GET /health` | `db` healthy |
| `web` (`mandimate-web`) | `full` | built from `frontend/Dockerfile` | `GET /healthz` | `api` healthy |
| `adminer` (`mandimate-adminer`) | `tools` | `adminer:4` | | `db` healthy |

## Run the full stack

```bash
cp backend/.env.example backend/.env    # once; make setup does this too
make up                                 # docker compose --profile full up -d --build
docker compose exec api python -m app.seed   # optional: demo data on a fresh volume
```

Open <http://localhost:8080>. `make logs` follows all containers, `make down` stops and removes
them (volumes and data are kept).

The API container applies pending migrations on every start before serving. That is safe for a
single API replica; with several replicas, run migrations as a one-off job instead
(`docker compose run --rm api alembic upgrade head`) and start the replicas afterwards.

## Images

### API (`backend/Dockerfile`)

- Multi-stage: `uv sync --frozen --no-dev` (uv from `ghcr.io/astral-sh/uv`) builds
  `/app/.venv` from `uv.lock`; the runtime stage copies only the virtualenv and code onto a clean
  `python:3.12-slim`.
- Runs as the unprivileged `mandimate` user (uid 10001); `/app/media` is owned by it, so a fresh
  named volume mounted there is writable.
- Command: `alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers`.

```bash
docker build -t mandimate-api backend
```

### Web (`frontend/Dockerfile`)

- `node:20-alpine` runs `npm ci` and `npm run build` (client bundle, SSR bundle, prerendered
  public pages, sitemap), then `nginx:1.27-alpine` serves `dist/client`.
- The nginx configuration has a single source, `infra/nginx/`: `default.conf` plus
  `snippets/security-headers.conf` and `snippets/proxy-api.conf`. It reaches the image through
  the named build context `nginx-config`, so the frontend build context stays `./frontend`.
- Build arguments: `VITE_SITE_URL` (public origin for canonical URLs, Open Graph and the
  sitemap; compose passes `MANDIMATE_SITE_URL`) and `VITE_API_BASE` (default `/api/v1`).

```bash
docker build --build-context nginx-config=infra/nginx \
  --build-arg VITE_SITE_URL=https://mandimate.example \
  -t mandimate-web frontend
```

What nginx does (`infra/nginx/default.conf`):

| Path | Behaviour | Cache-Control |
|---|---|---|
| `/assets/*` | hashed bundles, fonts | `public, max-age=31536000, immutable` |
| `/app`, `/app/**` | `try_files $uri $uri/index.html /app.html` (SPA shell), `X-Robots-Tag: noindex` | `no-cache` |
| `/*.html`, `/`, prerendered routes | `try_files $uri $uri/index.html $uri.html`, else `404.html` with status 404 | `no-cache` |
| other root files (`robots.txt`, `sitemap.xml`, icons) | static | `public, max-age=3600` |
| `/api/*`, `/media/*` | proxied to `api:8000`, bodies up to 10 MB, 120 s read timeout | set by the API |
| `/healthz` | liveness probe | |

gzip is enabled for text, JSON, JavaScript, CSS, SVG and fonts. The API upstream is resolved
through Docker's DNS at request time, so restarting the API never requires restarting nginx.

## Configuration

### API environment (`backend/.env` or the container environment)

| Variable | Default | Production guidance |
|---|---|---|
| `APP_ENV` | `development` | `production` (enables the startup secret check) |
| `LOG_LEVEL` | `INFO` | `INFO` |
| `DATABASE_URL` | `postgresql+asyncpg://mandimate:mandimate@localhost:5432/mandimate` | Set by compose to the `db` service; managed databases work too (`postgresql://` URLs are converted to asyncpg) |
| `TEST_DATABASE_URL` | `.../mandimate_test` | Tests only |
| `DB_ECHO` | `false` | `false` |
| `JWT_SECRET` | development value | **Required**: random, at least 32 characters |
| `JWT_ALGORITHM` | `HS256` | `HS256` |
| `ACCESS_TOKEN_MINUTES` | `30` | `30` |
| `REFRESH_TOKEN_DAYS` | `14` | `14` |
| `COOKIE_SECURE` | `false` | **`true`** behind HTTPS |
| `COOKIE_DOMAIN` | unset | Leave unset (host-only cookies) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173,http://localhost:8080` | The public origin only; JSON array or comma-separated |
| `SITE_URL` | `http://localhost:5173` | Public origin; compose sets it from `MANDIMATE_SITE_URL` |
| `MEDIA_DIR` | `backend/media` (`/app/media` in the image) | Keep on the `mandimate-media` volume |
| `MEDIA_URL` | `/media` | `/media` (nginx proxies it) |
| `MAX_UPLOAD_MB` | `8` | `8` (nginx allows 10 MB bodies) |
| `AI_MODE` | `auto` | `auto`, or `mock` if data may not leave the server |
| `DEEPSEEK_API_KEY` | empty | Secret; empty means rules-only demo mode |
| `DEEPSEEK_MODEL` | `deepseek-flash` | |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | |
| `AI_TIMEOUT_SECONDS` | `30` | Lower for snappier fallbacks |
| `FORWARDED_ALLOW_IPS` | uvicorn default `127.0.0.1` | Compose sets `*` (only nginx can reach the API); otherwise the proxy's address or network |

`API_PREFIX` (`/api/v1`) is shared with the frontend and nginx; do not change it in one place
only.

### Compose variables (shell or a root-level `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `mandimate` | Database credentials; change the password on any server |
| `MANDIMATE_DB_PORT` | `5432` | Host port for PostgreSQL |
| `MANDIMATE_WEB_PORT` | `8080` | Host port for the web container |
| `MANDIMATE_ADMINER_PORT` | `8081` | Host port for Adminer |
| `MANDIMATE_SITE_URL` | `http://localhost:8080` | Public origin baked into the web build and passed to the API |

## Production checklist

- [ ] `APP_ENV=production` and a fresh `JWT_SECRET` (`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`).
- [ ] `POSTGRES_PASSWORD` changed; port 5432 not reachable from the internet (bind it to
      `127.0.0.1` or remove the mapping).
- [ ] TLS in front of the web container, `COOKIE_SECURE=true`, HSTS on the terminator.
- [ ] `MANDIMATE_SITE_URL` and `CORS_ORIGINS` set to the public origin; images rebuilt.
- [ ] Demo seed **not** loaded; real coordinator and admin accounts created.
- [ ] Nightly database and media backups scheduled, and a restore rehearsed.
- [ ] `AI_MODE` chosen deliberately (and the DeepSeek key stored as a secret if live).
- [ ] Adminer (`tools` profile) not running on the server.

## TLS and cookies

The containers speak plain HTTP; terminate TLS in front of `web`:

- **Caddy** on the same host (automatic certificates):

  ```text
  mandimate.example {
      reverse_proxy 127.0.0.1:8080
      header Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
  ```

- **A cloud load balancer** forwarding to port 8080, with HSTS configured on the balancer.

Then set `COOKIE_SECURE=true` so `mandimate_access` and `mandimate_refresh` are only ever sent over
HTTPS. nginx forwards the terminator's `X-Forwarded-Proto` to the API, so the API knows requests
arrived over HTTPS.

Any proxy in front of `web` becomes the client address nginx sees: for Caddy on the same host
that is the Docker bridge gateway, for a load balancer its private address. Without further
configuration every user would then share one IP, and login throttling would lock out an
identifier for everyone. Tell nginx which addresses are trusted proxies so it recovers the real
client from `X-Forwarded-For` (and forwards that to the API). Add to the `server` block of
`infra/nginx/default.conf`, keeping only the range that applies:

```nginx
set_real_ip_from 172.16.0.0/12;       # Docker bridge networks: a proxy on the same host
set_real_ip_from 10.0.0.0/8;          # or the load balancer's private range
real_ip_header   X-Forwarded-For;
real_ip_recursive on;
```

This is deliberately not the default: without a proxy in front, trusting these ranges would
let clients choose their own IP address.

## Backups

All state lives in two named volumes: `mandimate_mandimate-db-data` (PostgreSQL) and
`mandimate_mandimate-media` (photos).

**Logical database backup** (consistent, online, portable across PostgreSQL versions):

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U mandimate -d mandimate --format=custom \
  > "backups/mandimate-$(date +%Y%m%d-%H%M).dump"
```

**Restore** into an empty database (stop the API first so nothing writes meanwhile):

```bash
docker compose stop api
docker compose exec -T db pg_restore -U mandimate -d mandimate --clean --if-exists --no-owner \
  < backups/mandimate-20260101-0200.dump
docker compose start api
```

**Media backup**:

```bash
docker run --rm -v mandimate_mandimate-media:/media:ro -v "$PWD/backups":/backup alpine \
  tar czf "/backup/media-$(date +%Y%m%d-%H%M).tar.gz" -C /media .
```

**Whole-volume snapshot** (fast restore of the exact cluster; requires the same PostgreSQL major
version and a stopped database):

```bash
docker compose stop db
docker run --rm -v mandimate_mandimate-db-data:/data:ro -v "$PWD/backups":/backup alpine \
  tar czf "/backup/pgdata-$(date +%Y%m%d-%H%M).tar.gz" -C /data .
docker compose start db
```

Schedule the logical dump and the media archive nightly (cron or a systemd timer), keep at least
14 daily and 8 weekly copies off the host, **encrypt them** (they contain personal data) and
rehearse a restore into a scratch environment every month. `make db-reset` deletes the database
volume and must never be run on a server.

## Updating and rolling back

```bash
git pull
make up               # rebuilds images, recreates changed containers, migrates on API start
```

Take a logical backup before every update that includes migrations. To roll back code, check
out the previous release and `make up`; to roll back a migration, run
`docker compose run --rm api alembic downgrade -1` first, or restore the pre-update dump.

## Observability

- `GET /health` (and `/api/v1/health`) returns `HealthStatus`: `status` (`ok` or `degraded`),
  `database`, `ai_mode` and `version`. Container health checks use it.
- Logs go to stdout and include the request id (`X-Request-ID`, echoed to clients). Read them
  with `make logs` or `docker compose logs api`.
- `ai_interactions` records every AI call (feature, source, latency, success): the share of
  live calls that fell back to rules is the first number to watch after enabling DeepSeek.
- Pilot outcomes (`PilotMetrics`) are on the coordinator and admin dashboards.

## Scaling

The pilot deployment is one host, one API process, one database, and that comfortably serves a
village cluster with a few hundred users. Before going beyond it:

| Concern | Today | When scaling out |
|---|---|---|
| API processes | One uvicorn process per container | More processes (uvicorn `--workers` / `WEB_CONCURRENCY`) or replicas need a shared store for login-throttling counters (the limiter is in-process) |
| Migrations | On API start | A one-off job before rolling out replicas |
| Media | Local named volume | Object storage (S3-compatible) behind `/media`, or a shared volume |
| Static site | nginx | Any CDN in front of `web`; `/assets` is immutable, HTML is `no-cache` |
| Database | PostgreSQL 17 container | Managed PostgreSQL with point-in-time recovery; tune the SQLAlchemy pool per process |
| AI | Synchronous calls with timeout and fallback | Concurrency limits per deployment, provider quotas, `AI_MODE=mock` as a kill switch |
| Notifications | In-app | Add SMS / WhatsApp delivery as a separate worker |

Horizontal scaling is a configuration and storage change, not an architectural one: the API is
otherwise stateless, and every request uses its own database session.
