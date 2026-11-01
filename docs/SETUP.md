# Local setup

From a fresh clone to a running MandiMate in about five minutes. The short version is
`./dev.sh` (it installs what is missing, so `make setup` is optional); this guide explains each
step and what to do when something gets in the way.

## 1. Prerequisites

| Tool | Version | Check | Install |
|---|---|---|---|
| Docker Desktop (or Docker Engine + Compose plugin) | Compose v2.17+ | `docker compose version` | <https://docs.docker.com/get-docker/> |
| uv (manages Python 3.12 and the backend virtualenv) | 0.11+ | `uv --version` | <https://docs.astral.sh/uv/getting-started/installation/> |
| Node.js with npm | Node 20 LTS | `node --version` | <https://nodejs.org/> (or `nvm install 20`) |
| make | any GNU make (3.81 on macOS is fine) | `make --version` | preinstalled on macOS (Xcode CLT) and most Linux distributions |
| curl, lsof | any | | preinstalled on macOS; `apt install curl lsof` on Debian/Ubuntu |

You do **not** need a local PostgreSQL or a system Python: the database runs in Docker and uv
downloads Python 3.12 if your machine lacks it.

## 2. Install dependencies

```bash
make setup
```

This runs:

1. `uv sync` in `backend/`: creates `backend/.venv` with the locked dependencies (including
   dev tools: pytest, ruff).
2. `npm install` in `frontend/`. `frontend/.npmrc` sets `legacy-peer-deps=true`; keep it. A few
   libraries have not yet widened their React 19 peer ranges, and without the flag npm refuses
   to resolve the tree.
3. Copies `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env`
   when they do not exist yet. Existing files are never overwritten.

The defaults work out of the box: the API connects to
`postgresql+asyncpg://mandimate:mandimate@localhost:5432/mandimate`, AI runs in demo (rules) mode and
cookies are not marked `Secure` (plain `http://localhost`).

## 3. Run everything

```bash
./dev.sh          # or: make dev
```

`./dev.sh` then:

1. checks curl, uv, Node (20.19+ / 22.12+, loading nvm if needed) and Docker — and starts Docker
   Desktop on macOS when it is not running;
2. stops any previous MandiMate run (another `./dev.sh`, `make api`/`make web`, an IDE run);
3. frees ports 8000 and 5173: programs and Docker containers holding them are stopped. With
   `--no-kill` (or when a program cannot be stopped) MandiMate moves to the next free port and
   wires the Vite proxy and CORS to it. Another database server on 5432 is never stopped
   (unless `--force`): MandiMate's database moves to 5433 instead and the API follows;
4. creates `backend/.env` (random JWT secret, free `AI_MODE=mock`) and `frontend/.env` when missing,
   and runs `uv sync` / `npm install` only when the lock files changed;
5. starts the `db` service (container `mandimate-db`, PostgreSQL 17), waits until it accepts
   connections and makes sure the `mandimate_test` database exists;
6. applies migrations (`alembic upgrade head`, retried while the database warms up);
7. loads the demo data when the `users` table is empty (`--reset` wipes and reloads it,
   `--seed=never` skips it);
8. runs the API (`uvicorn --reload`) and the web app (Vite) with `[api]` / `[web]` prefixed logs
   (also written to `.dev/logs/`), prints the URLs once both answer, and stops both cleanly on
   Ctrl-C or when either one crashes (showing its last log lines).

### Sharing a public link

`./dev.sh share` (add `-d` for background) builds the web app and serves the production build through a
public HTTPS tunnel. A visit then downloads about 0.9 MB instead of about 16 MB from the dev server,
which matters on ngrok's free plan (1 GB a month). `--dev` shares the hot-reloading dev server instead.

- `--tunnel=auto` (default) uses ngrok and falls back to cloudflared when ngrok is missing, fails, or its free
  monthly bandwidth is used up (ERR_NGROK_725). `--tunnel=ngrok` / `--tunnel=cloudflared` pick one.
- cloudflared needs no account and has no bandwidth cap: `brew install cloudflared`.
- The link is printed as **Public**; tunnel logs are in `.dev/logs/ngrok.log` / `.dev/logs/cloudflared.log`.

Other commands: `./dev.sh -d` (background), `./dev.sh stop [--all]`, `./dev.sh restart`,
`./dev.sh status`, `./dev.sh logs [api|web|db]`, `./dev.sh reset [--hard]`, `./dev.sh doctor`,
`./dev.sh help`.

Open **http://localhost:5173** and sign in with any [demo account](../README.md#demo-accounts)
(password `MandiMate@2026`). Vite proxies `/api` and `/media` to the API, so the browser only ever
talks to one origin and the auth cookies just work.

Press **Ctrl-C** once to stop the API and the web app; the database keeps running for the next
session (`make db-stop` stops it). If either process crashes, the script stops the other one too
and exits with an error, so you never end up with a half-running stack.

### Windows

Open PowerShell (or Command Prompt) in the project folder and run:

```powershell
.\dev.cmd            # or: .\dev.cmd install  to only install the prerequisites
```

`dev.cmd` runs `dev.ps1` (Windows PowerShell 5.1 or PowerShell 7) without changing your execution
policy. It:

1. installs what is missing with **winget**, asking first (`-y` skips the questions):
   - **Docker Desktop**, plus **WSL 2** if it is not set up. WSL asks for administrator permission and
     usually needs a restart; run `.\dev.cmd` again afterwards.
   - **uv**, which then downloads Python 3.12 by itself.
   - **Node.js LTS**.
   - **ngrok** or **cloudflared** for `share`.
2. starts Docker Desktop when it is not running. The first time, accept Docker's terms in its window and
   the script carries on.
3. does everything `./dev.sh` does: frees or moves ports, creates the `.env` files, installs dependencies,
   starts PostgreSQL, migrates, seeds, and runs the API and web with `[api]` / `[web]` logs.

Every command and option is the same as on macOS and Linux: `.\dev.cmd -d`, `share`, `stop --all`, `status`,
`logs api`, `reset --hard`, `doctor`, `help`. Running `./dev.sh` from Git Bash forwards to `dev.ps1`
automatically. Inside **WSL**, `./dev.sh` runs as on Linux and uses Docker Desktop's WSL integration
(Settings > Resources > WSL integration).

If winget is missing, install "App Installer" from the Microsoft Store. If a port is held by a program
you cannot stop, run the terminal as administrator or use `--no-kill`.

### Running the pieces separately

```bash
make db        # PostgreSQL only
make migrate   # schema
make seed      # demo data
make api       # terminal 1: http://localhost:8000
make web       # terminal 2: http://localhost:5173
```

## 4. Optional extras

| Want | Do |
|---|---|
| Live AI | Put `DEEPSEEK_API_KEY=...` in `backend/.env` and set `AI_MODE=auto`, or run `./dev.sh --live-ai` for one session. See [AI.md](AI.md). |
| Browse the database | `make adminer`, then <http://localhost:8081>: server `db`, user, password and database `mandimate`. |
| The production-like stack | `make up` builds the API and nginx images and serves everything on <http://localhost:8080>. See [DEPLOYMENT.md](DEPLOYMENT.md). |
| A fresh start | `./dev.sh reset --hard` (destroys local data and reseeds). |
| Create a migration | Change the models, then `make revision msg="describe the change"` and review the generated file in `backend/alembic/versions/`. |

## Troubleshooting

### Port 5432 is already in use

`./dev.sh` handles this automatically: it leaves the other database running and moves MandiMate's
database to the next free port (5433, …), pointing the API at it for that run. To make a
different port permanent (or when using `make db` directly), publish it yourself:

```bash
# 1. pick a free port for the container (shell variable or a root-level .env file)
echo "MANDIMATE_DB_PORT=5433" >> .env

# 2. point the API at it (backend/.env)
DATABASE_URL=postgresql+asyncpg://mandimate:mandimate@localhost:5433/mandimate
TEST_DATABASE_URL=postgresql+asyncpg://mandimate:mandimate@localhost:5433/mandimate_test

# 3. recreate the container with the new mapping (data is kept in the volume)
make db
```

Docker Compose reads the root `.env` automatically; `MANDIMATE_WEB_PORT` (8080) and
`MANDIMATE_ADMINER_PORT` (8081) work the same way for the container stack.

### Port 8000 or 5173 is already in use

`./dev.sh` frees both ports automatically (or moves to free ones with `--no-kill`). Usually it is a forgotten
`make api` / `make web` in another terminal. Find it with `lsof -nP -iTCP:8000 -sTCP:LISTEN`.
Both ports are fixed: the Vite proxy targets `localhost:8000` and Vite runs with
`strictPort`.

### npm fails with `ERESOLVE could not resolve`

The peer-dependency override is missing. Make sure `frontend/.npmrc` contains
`legacy-peer-deps=true` (it is committed), then run `make setup` again. If you use a global
`npm config set legacy-peer-deps false`, the project file still wins.

### `Docker is not running`

Start Docker Desktop and wait for the whale icon to settle, then retry. `docker info` must
succeed.

### The database never becomes healthy

```bash
docker compose logs db
```

A volume created by a different PostgreSQL major version is the usual cause. If you do not need
the data, `make db-reset` recreates it.

### `mandimate_test` does not exist

The init script runs only when the volume is created for the first time. If the volume predates
it, create the database once:

```bash
docker compose exec db createdb -U mandimate -O mandimate mandimate_test
```

### Migrations fail with `connection refused`

The API reads `DATABASE_URL` from `backend/.env`. Check that the host port matches the
container (`docker compose port db 5432`) and that `make db` succeeded.

### Login always fails for demo accounts

The demo data is missing or was modified. Run `make seed` (or `make db-reset && make dev` for a
clean slate). Five failed attempts for the same identifier and IP lock logins for five minutes;
restarting the API clears the in-memory counter in development.

### Voice listing does nothing

The Web Speech API is available in Chromium-based browsers and Safari, and needs microphone
permission. Firefox does not implement speech recognition; the form falls back to typing the
sentence, which goes through the same parser.

### Python version errors

uv reads `backend/.python-version` (3.12) and installs it if needed. If an old `.venv` was
created with another interpreter, delete `backend/.venv` and run `make setup`.
