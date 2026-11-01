#!/usr/bin/env bash
#
# MandiMate — one command to run the whole stack locally.
#
#   ./dev.sh                 set up whatever is missing, then run DB + API + web (Ctrl-C stops API + web)
#   ./dev.sh -d              same, but in the background (stop later with ./dev.sh stop)
#   ./dev.sh share [-d]      same, plus a public HTTPS link (ngrok, or cloudflared). Visitors get the small
#                            production build (about 1 MB per visit instead of ~16 MB from the dev server)
#   ./dev.sh stop [--all]    stop API + web (--all also stops the database container)
#   ./dev.sh restart         stop, then start again
#   ./dev.sh status          what is running, on which ports, AI mode
#   ./dev.sh logs [api|web|db]
#   ./dev.sh reset [--hard]  wipe and reload the demo data (--hard also deletes the database volume)
#   ./dev.sh doctor          check prerequisites and ports without changing anything
#   ./dev.sh help
#
# Start options:
#   -d, --detach        run in the background
#   --open              open the web app in the browser once it is ready
#   --reset             wipe and reload the demo data before starting
#   --seed=auto|always|never   auto (default) seeds only an empty database
#   --no-install        skip the dependency check (uv sync / npm install)
#   --no-kill           never stop other programs; move MandiMate to free ports instead
#   --force             also stop other database servers that hold the database port
#   --mock-ai           force the free rule-based AI mode for this run
#   --live-ai           force live DeepSeek for this run (costs money; needs DEEPSEEK_API_KEY)
#   --api-port=N --web-port=N --db-port=N   preferred ports (defaults 8000, 5173, 5432)
#   -y, --yes           do not ask for confirmation (reset --hard)
#
# Share options:
#   --dev               share the hot-reloading dev server instead of the production build (uses far more data)
#   --tunnel=auto|ngrok|cloudflared   auto (default): ngrok, falling back to cloudflared when ngrok is missing,
#                       fails, or its free monthly bandwidth is used up
#
# What it handles: missing tools (with install hints), Docker Desktop not running (starts it on macOS),
# missing .env files, missing or outdated dependencies, a previous MandiMate run (foreground, background or
# started elsewhere — it is stopped first), anything else listening on MandiMate's ports (stopped, or MandiMate
# moves to the next free port when that is not possible), Docker containers publishing those ports,
# another database server on 5432 (left alone; MandiMate's database moves to a free port), a stopped or
# unhealthy database container, the test database, migrations, demo data, and either process crashing.
#
# Works with the bash 3.2 that ships with macOS and with modern Linux bash. On Windows use dev.cmd (it installs
# Docker Desktop, uv and Node.js with winget); ./dev.sh in Git Bash forwards there, WSL runs this script.

if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi

# Git Bash / MSYS / Cygwin on Windows: the native PowerShell script does the work.
case "$(uname -s 2>/dev/null)" in
  MINGW* | MSYS* | CYGWIN*)
    ps1="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev.ps1"
    ps1="$(cygpath -w "$ps1" 2>/dev/null || echo "$ps1")"
    if command -v pwsh >/dev/null 2>&1; then exec pwsh -NoProfile -ExecutionPolicy Bypass -File "$ps1" "$@"; fi
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1" "$@"
    ;;
esac

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
STATE_DIR="$ROOT_DIR/.dev"
LOG_DIR="$STATE_DIR/logs"
PID_FILE="$STATE_DIR/pids"
PORTS_FILE="$STATE_DIR/ports"
LOCK_DIR="$STATE_DIR/lock"
DB_CONTAINER="mandimate-db"
DB_USER="${POSTGRES_USER:-mandimate}"
DB_PASSWORD="${POSTGRES_PASSWORD:-mandimate}"
DB_NAME="${POSTGRES_DB:-mandimate}"
DEMO_PASSWORD="MandiMate@2026"

# ── Options ────────────────────────────────────────────────────────────────────────────────────
COMMAND="start"
DETACH=0
OPEN_BROWSER=0
SEED_MODE="auto"
INSTALL=1
NO_KILL=0
FORCE=0
ASSUME_YES=0
STOP_ALL=0
HARD_RESET=0
AI_OVERRIDE=""
LOG_TARGET=""
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
DB_PORT="${DB_PORT:-${MANDIMATE_DB_PORT:-5432}}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"
SHARE_DEV=0
TUNNEL="auto"

usage() { sed -n '3,43p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

COMMAND_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    start | stop | restart | status | logs | reset | doctor | help | share)
      if [ "$COMMAND_SET" = 1 ] && [ "$COMMAND" = "logs" ]; then LOG_TARGET="$1"; else COMMAND="$1"; COMMAND_SET=1; fi ;;
    api | web | db) LOG_TARGET="$1" ;;
    -d | --detach) DETACH=1 ;;
    --open) OPEN_BROWSER=1 ;;
    --reset) SEED_MODE="always" ;;
    --seed=*) SEED_MODE="${1#*=}" ;;
    --no-seed) SEED_MODE="never" ;;
    --no-install) INSTALL=0 ;;
    --no-kill) NO_KILL=1 ;;
    --force) FORCE=1 ;;
    --all) STOP_ALL=1 ;;
    --hard) HARD_RESET=1 ;;
    --mock-ai) AI_OVERRIDE="mock" ;;
    --live-ai) AI_OVERRIDE="live" ;;
    --api-port=*) API_PORT="${1#*=}" ;;
    --web-port=*) WEB_PORT="${1#*=}" ;;
    --db-port=*) DB_PORT="${1#*=}" ;;
    -y | --yes) ASSUME_YES=1 ;;
    --dev) SHARE_DEV=1 ;;
    --tunnel=*) TUNNEL="${1#*=}" ;;
    -h | --help) COMMAND="help" ;;
    *) printf 'Unknown argument: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# ── Output ─────────────────────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BRASS=$'\033[38;5;179m' C_DIM=$'\033[2m' C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m' C_MAGENTA=$'\033[35m' C_BLUE=$'\033[34m' C_BOLD=$'\033[1m' C_RESET=$'\033[0m'
else
  C_BRASS='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_CYAN='' C_MAGENTA='' C_BLUE='' C_BOLD='' C_RESET=''
fi

say() { printf '%s[dev]%s %s\n' "$C_BRASS" "$C_RESET" "$*"; }
ok() { printf '%s[dev]%s %s✓%s %s\n' "$C_BRASS" "$C_RESET" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[dev]%s %s! %s%s\n' "$C_BRASS" "$C_RESET" "$C_YELLOW" "$*" "$C_RESET" >&2; }
fail() {
  printf '%s[dev]%s %s✗ %s%s\n' "$C_BRASS" "$C_RESET" "$C_RED" "$*" "$C_RESET" >&2
  exit 1
}
step() { printf '\n%s%s── %s%s\n' "$C_BOLD" "$C_BRASS" "$*" "$C_RESET"; }

on_error() {
  local status=$? line=$1
  printf '%s[dev]%s %s✗ Unexpected failure (exit %s) at dev.sh line %s.%s\n' \
    "$C_BRASS" "$C_RESET" "$C_RED" "$status" "$line" "$C_RESET" >&2
  printf '%s      Logs: %s  ·  Diagnose: ./dev.sh doctor%s\n' "$C_DIM" "$LOG_DIR" "$C_RESET" >&2
}
trap 'on_error $LINENO' ERR

# prefix <label> <colour>: prefixes each line, flushing per line; ignores INT/TERM so shutdown output still prints.
prefix() {
  local tag
  tag="$(printf '%-6s' "[$1]")"
  (
    trap '' INT TERM
    exec awk -v p="$2$tag$C_RESET " '{ print p $0; fflush() }'
  )
}

# ── Tool discovery (non-login shells often miss uv / nvm / Homebrew paths) ─────────────────────
for dir in "$HOME/.local/bin" "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin; do
  if [ -d "$dir" ]; then
    case ":$PATH:" in *":$dir:"*) ;; *) PATH="$PATH:$dir" ;; esac
  fi
done
export PATH

load_nvm() {
  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  [ -s "$nvm_sh" ] || return 1
  set +eu
  # shellcheck disable=SC1090
  . "$nvm_sh" >/dev/null 2>&1
  nvm use --silent default >/dev/null 2>&1 || true
  set -eu
  return 0
}

have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"

node_version_ok() {
  local v major minor
  v="$(node -v 2>/dev/null | sed 's/^v//')" || return 1
  major="${v%%.*}"
  minor="$(echo "$v" | cut -d. -f2)"
  case "$major" in '' | *[!0-9]*) return 1 ;; esac
  # Vite 8 needs ^20.19.0 || >=22.12.0
  if [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; then return 0; fi
  if [ "$major" -ge 23 ]; then return 0; fi
  return 1
}

COMPOSE=()
detect_compose() {
  local v
  v="$(docker compose version --short 2>/dev/null | sed 's/^v//')" || true
  case "$v" in 2.2[4-9]* | 2.[3-9][0-9]* | [3-9]*) ;; *) v="" ;; esac
  if [ -n "$v" ]; then
    COMPOSE=(docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml")
  else
    return 1
  fi
}

docker_running() { docker info >/dev/null 2>&1; }

is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

ensure_docker() {
  if ! have docker && is_wsl; then
    fail "Docker is not available in WSL. Install Docker Desktop for Windows (or run dev.cmd from Windows, which installs it), then turn on Settings > Resources > WSL integration for this distro."
  fi
  have docker || fail "Docker is not installed. Install Docker Desktop: https://docs.docker.com/get-docker/"
  if ! docker_running; then
    if is_wsl; then
      fail "Docker Desktop is not running. Start it on Windows (with WSL integration on for this distro) and run ./dev.sh again."
    elif [ "$OS" = "Darwin" ]; then
      say "Docker Desktop is not running — starting it..."
      open -ga Docker >/dev/null 2>&1 || open -a Docker >/dev/null 2>&1 ||
        fail "Could not start Docker Desktop. Open it from Applications and run ./dev.sh again."
      local waited=0
      until docker_running; do
        [ "$waited" -ge 180 ] && fail "Docker Desktop did not become ready within 3 minutes."
        sleep 2
        waited=$((waited + 2))
      done
      ok "Docker Desktop is ready"
    else
      fail "The Docker daemon is not running. Start it (e.g. sudo systemctl start docker) and run ./dev.sh again."
    fi
  fi
  detect_compose || fail "Docker Compose v2.24+ is required. Update Docker Desktop or the compose plugin."
}

preflight() {
  step "Checking prerequisites"
  have curl || fail "curl is required. Install it with your package manager."
  have uv || fail "uv is required. Install it: curl -LsSf https://astral.sh/uv/install.sh | sh  (then reopen the terminal)"
  if ! have node || ! node_version_ok; then load_nvm || true; fi
  have node || fail "Node.js is required (20.19+ or 22.12+). Install it from https://nodejs.org/ or with nvm."
  have npm || fail "npm is required (it ships with Node.js)."
  node_version_ok || fail "Node $(node -v) is too old for Vite 8. Use Node 20.19+ or 22.12+ (e.g. nvm install 22)."
  ensure_docker
  ok "uv $(uv --version 2>/dev/null | awk '{print $2}') · node $(node -v) · $(docker --version | sed 's/,.*//')"
}

# ── Ports ──────────────────────────────────────────────────────────────────────────────────────
valid_port() { case "$1" in '' | *[!0-9]*) return 1 ;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }

# PIDs listening on a TCP port (only processes this user may inspect).
listening_pids() {
  local port=$1
  if have lsof; then
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
  elif have ss; then
    ss -ltnpH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true
  elif have fuser; then
    fuser "$port/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
  fi
}

# True when anything accepts connections on the port (sees other users' processes too).
port_busy() {
  local port=$1
  [ -n "$(listening_pids "$port")" ] && return 0
  (exec 3<>"/dev/tcp/127.0.0.1/$port") >/dev/null 2>&1 && return 0
  (exec 3<>"/dev/tcp/::1/$port") >/dev/null 2>&1 && return 0
  return 1
}

wait_port_free() {
  local port=$1 tries=$(($2 * 4))
  while [ "$tries" -gt 0 ]; do
    port_busy "$port" || return 0
    sleep 0.25
    tries=$((tries - 1))
  done
  ! port_busy "$port"
}

proc_name() { ps -o comm= -p "$1" 2>/dev/null | sed 's#.*/##' || true; }
proc_cmd() { ps -o command= -p "$1" 2>/dev/null | cut -c1-110 || true; }
proc_cwd() {
  if [ -e "/proc/$1/cwd" ]; then readlink "/proc/$1/cwd" 2>/dev/null || true
  else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true; fi
}

# True when a process group still belongs to MandiMate (guards against PID reuse after a reboot).
mandimate_group() {
  local p
  for p in $(pgrep -g "$1" 2>/dev/null || true); do
    case "$(proc_cmd "$p")" in *uvicorn*app.main:app* | *vite* | *dev.sh* | *ngrok* | *cloudflared*) ;; *) continue ;; esac
    case "$(proc_cwd "$p")" in "$ROOT_DIR" | "$ROOT_DIR"/*) return 0 ;; esac
  done
  return 1
}

is_docker_process() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    *docker* | *vpnkit* | *containerd* | *rootlessport* | *slirp4netns* | *orbstack* | *lima* | *gvproxy* | *podman* | *qemu* | *colima* | ssh) return 0 ;;
  esac
  return 1
}

is_database_process() {
  case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
    postgres* | postmaster* | mysqld* | mariadbd* | mongod* | redis-server*) return 0 ;;
  esac
  return 1
}

is_protected_pid() {
  local pid=$1
  [ "$pid" = "$$" ] || [ "$pid" = "$PPID" ] || [ "$pid" -le 1 ]
}

# free_port <port> <role: api|web|db> — returns 0 when the port is free (or is MandiMate's own DB).
free_port() {
  local port=$1 role=$2 cid name image pid pids pname
  port_busy "$port" || return 0

  if docker_running; then
    for cid in $(docker ps -q --filter "publish=$port" 2>/dev/null); do
      name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')"
      image="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null)"
      if [ "$role" = "db" ] && [ "$name" = "$DB_CONTAINER" ]; then return 0; fi
      [ "$NO_KILL" = 1 ] && return 1
      if [ "$role" = "db" ] && [ "$FORCE" != 1 ] && is_database_process "$image"; then
        warn "Another database container ('$name', $image) is using port $port — leaving it running."
        return 1
      fi
      say "Stopping Docker container '$name' ($image) — it was using port $port"
      docker stop "$cid" >/dev/null 2>&1 || warn "Could not stop container '$name'."
    done
    wait_port_free "$port" 5 && return 0
  fi

  pids="$(listening_pids "$port")"
  if [ -z "$pids" ]; then
    warn "Port $port is in use by a process this user cannot see or stop (another user or root)."
    return 1
  fi
  [ "$NO_KILL" = 1 ] && return 1
  for pid in $pids; do
    is_protected_pid "$pid" && continue
    pname="$(proc_name "$pid")"
    if is_docker_process "$pname"; then
      warn "Port $port is held by Docker ($pname) but no running container publishes it; restarting Docker Desktop clears this."
      return 1
    fi
    if [ "$role" = "db" ] && [ "$FORCE" != 1 ] && is_database_process "$pname"; then
      warn "A local $pname server is listening on $port — leaving your database alone (use --force to stop it)."
      return 1
    fi
    say "Stopping '$pname' (pid $pid) — it was using port $port: $(proc_cmd "$pid")"
    kill -TERM "$pid" 2>/dev/null || warn "No permission to stop pid $pid."
  done
  wait_port_free "$port" 8 && return 0
  for pid in $(listening_pids "$port"); do
    is_protected_pid "$pid" || kill -KILL "$pid" 2>/dev/null || true
  done
  wait_port_free "$port" 3
}

next_free_port() {
  local port=$(($1 + 1)) limit=$(($1 + 100))
  while [ "$port" -le "$limit" ]; do
    port_busy "$port" || { echo "$port"; return 0; }
    port=$((port + 1))
  done
  return 1
}

# resolve_port <VAR> <role> <label>: frees the preferred port or moves to the next free one.
resolve_port() {
  local var=$1 role=$2 label=$3 port alt
  port="${!var}"
  valid_port "$port" || fail "Invalid $label port: '$port'."
  if free_port "$port" "$role"; then
    return 0
  fi
  alt="$(next_free_port "$port")" || fail "No free port found near $port for the $label."
  warn "Using port $alt for the $label instead of $port."
  printf -v "$var" '%s' "$alt"
}

# ── Previous runs ──────────────────────────────────────────────────────────────────────────────
# Stops MandiMate's own API/web processes however they were started (this script, make, the old
# scripts/dev.sh, an IDE...). Matches only processes whose working directory is inside this project.
stop_previous() {
  local quiet=${1:-0} found=0 line role pgid pid cwd

  # Another ./dev.sh still holding the lock (e.g. running in a different terminal).
  if [ -d "$LOCK_DIR" ]; then
    pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && [ "$pid" != "$$" ] && kill -0 "$pid" 2>/dev/null; then
      say "Another ./dev.sh is running (pid $pid) — stopping it first."
      kill -TERM "$pid" 2>/dev/null || true
      local t=0
      while kill -0 "$pid" 2>/dev/null && [ "$t" -lt 60 ]; do sleep 0.25; t=$((t + 1)); done
      kill -KILL "$pid" 2>/dev/null || true
      found=1
    fi
    rm -rf "$LOCK_DIR"
  fi

  local recorded=" "
  if [ -f "$PID_FILE" ]; then
    while read -r role pgid; do
      [ -n "${pgid:-}" ] || continue
      recorded="$recorded$pgid "
      if mandimate_group "$pgid"; then
        [ "$quiet" = 1 ] || say "Stopping the previous MandiMate $role (process group $pgid)"
        kill -TERM -- "-$pgid" 2>/dev/null || true
        found=1
      fi
    done <"$PID_FILE"
  fi

  for pid in $(pgrep -f "uvicorn app.main:app" 2>/dev/null || true) $(pgrep -f 'node_modules/(\.bin/vite|vite/bin/vite\.js)( |$)' 2>/dev/null || true); do
    case "$(proc_cmd "$pid")" in *' build'* | *' preview'*) continue ;; esac
    is_protected_pid "$pid" && continue
    kill -0 "$pid" 2>/dev/null || continue
    pg="$( (ps -o pgid= -p "$pid" 2>/dev/null || true) | tr -d ' ')"
    case "$recorded" in *" $pg "*) continue ;; esac
    cwd="$(proc_cwd "$pid")"
    case "$cwd" in
      "$ROOT_DIR" | "$ROOT_DIR"/*)
        [ "$quiet" = 1 ] || say "Stopping a MandiMate process started elsewhere (pid $pid): $(proc_cmd "$pid")"
        kill -TERM "$pid" 2>/dev/null || true
        found=1
        ;;
    esac
  done

  if [ "$found" = 1 ]; then
    local t=0
    while [ "$t" -lt 40 ]; do
      local alive=0
      if [ -f "$PID_FILE" ]; then
        while read -r role pgid; do
          [ -n "${pgid:-}" ] && mandimate_group "$pgid" && alive=1
        done <"$PID_FILE"
      fi
      [ "$alive" = 0 ] && break
      sleep 0.25
      t=$((t + 1))
    done
    if [ -f "$PID_FILE" ]; then
      while read -r role pgid; do
        [ -n "${pgid:-}" ] && mandimate_group "$pgid" && kill -KILL -- "-$pgid" 2>/dev/null || true
      done <"$PID_FILE"
    fi
  fi
  rm -f "$PID_FILE"
  return 0
}

# ── Setup ──────────────────────────────────────────────────────────────────────────────────────
ensure_env_files() {
  if [ ! -f "$BACKEND_DIR/.env" ]; then
    [ -f "$BACKEND_DIR/.env.example" ] || fail "backend/.env.example is missing."
    local secret
    secret="$(openssl rand -hex 32 2>/dev/null || date +%s%N | shasum | cut -c1-64)"
    sed -e "s#^JWT_SECRET=.*#JWT_SECRET=$secret#" \
      -e 's#^AI_MODE=.*#AI_MODE=mock#' "$BACKEND_DIR/.env.example" >"$BACKEND_DIR/.env"
    ok "Created backend/.env (AI_MODE=mock — the free mode; switch to auto for live DeepSeek)"
  fi
  if [ ! -f "$FRONTEND_DIR/.env" ] && [ -f "$FRONTEND_DIR/.env.example" ]; then
    cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env"
    ok "Created frontend/.env"
  fi
}

ensure_dependencies() {
  [ "$INSTALL" = 1 ] || { say "Skipping dependency check (--no-install)."; return 0; }
  step "Dependencies"
  local stamp="$BACKEND_DIR/.venv/.mandimate-synced"
  if [ ! -x "$BACKEND_DIR/.venv/bin/python" ] || [ ! -f "$stamp" ] ||
    [ "$BACKEND_DIR/uv.lock" -nt "$stamp" ] || [ "$BACKEND_DIR/pyproject.toml" -nt "$stamp" ]; then
    say "Installing backend dependencies (uv sync)..."
    (cd "$BACKEND_DIR" && uv sync --quiet) || fail "uv sync failed. Run 'cd backend && uv sync' to see why."
    touch "$stamp"
  fi
  ok "Backend dependencies are up to date"

  stamp="$FRONTEND_DIR/node_modules/.mandimate-installed"
  if [ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ] || [ ! -f "$stamp" ] ||
    [ "$FRONTEND_DIR/package.json" -nt "$stamp" ] ||
    { [ -f "$FRONTEND_DIR/package-lock.json" ] && [ "$FRONTEND_DIR/package-lock.json" -nt "$stamp" ]; }; then
    say "Installing frontend dependencies (npm install)..."
    (cd "$FRONTEND_DIR" && npm install --no-audit --no-fund --loglevel=error) ||
      fail "npm install failed. Run 'cd frontend && npm install' to see why."
    touch "$stamp"
  fi
  ok "Frontend dependencies are up to date"
}

# ── Database ───────────────────────────────────────────────────────────────────────────────────
db_exec() { docker exec -i "$DB_CONTAINER" "$@"; }
db_sql() { db_exec psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "${2:-$DB_NAME}" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

container_state() { docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || echo "missing"; }
container_health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$DB_CONTAINER" 2>/dev/null || echo "missing"; }
container_host_port() { docker port "$DB_CONTAINER" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://' || true; }

start_database() {
  step "Database (PostgreSQL in Docker)"
  # A container called mandimate-db that does not belong to this compose project blocks ours.
  if [ "$(container_state)" != "missing" ]; then
    local project
    project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$DB_CONTAINER" 2>/dev/null || true)"
    if [ -n "$project" ] && [ "$project" != "mandimate" ]; then
      warn "A container named $DB_CONTAINER belongs to compose project '$project' — removing that container (its volumes are kept)."
      docker rm -f "$DB_CONTAINER" >/dev/null 2>&1 || true
    fi
  fi

  # Our container already serving the preferred port? Keep it. Otherwise make sure the port is usable.
  local current
  current="$(container_host_port)"
  if [ "$(container_state)" = "running" ] && [ -n "$current" ] &&
    { [ "$current" = "$DB_PORT" ] || ! free_port "$DB_PORT" db; }; then
    DB_PORT="$current"
  else
    resolve_port DB_PORT db "database"
  fi

  export MANDIMATE_DB_PORT="$DB_PORT"
  local out status=0 attempt
  for attempt in 1 2; do
    out="$("${COMPOSE[@]}" up -d --wait --wait-timeout 90 db 2>&1)" && { status=0; break; } || status=$?
    if echo "$out" | grep -qiE 'port is already allocated|address already in use|bind'; then
      warn "Port $DB_PORT was taken while starting the database — trying another port."
      DB_PORT="$(next_free_port "$DB_PORT")" || break
      export MANDIMATE_DB_PORT="$DB_PORT"
      continue
    fi
    if echo "$out" | grep -qi 'unknown flag: --wait'; then
      "${COMPOSE[@]}" up -d db >/dev/null 2>&1 && status=0
      break
    fi
    break
  done
  if [ "$status" != 0 ]; then
    echo "$out" | tail -20 >&2
    warn "Recent database logs:"
    docker logs --tail 30 "$DB_CONTAINER" 2>&1 | sed 's/^/      /' >&2 || true
    fail "The database did not start. Try: ./dev.sh reset --hard (deletes local data) or restart Docker Desktop."
  fi

  local t=0
  until db_exec pg_isready -q -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
    [ "$t" -ge 120 ] && fail "PostgreSQL is not accepting connections (container $(container_state), health $(container_health))."
    sleep 0.5
    t=$((t + 1))
  done
  ok "PostgreSQL is ready on localhost:$DB_PORT"

  # The init script only runs on a brand-new volume; make sure the test database exists regardless.
  if [ "$(db_sql "SELECT 1 FROM pg_database WHERE datname='mandimate_test'" postgres)" != "1" ]; then
    db_exec createdb -U "$DB_USER" -O "$DB_USER" mandimate_test >/dev/null 2>&1 &&
      ok "Created the test database mandimate_test" || warn "Could not create mandimate_test (tests only)."
  fi
}

# Points the backend at the database port actually in use, keeping any custom credentials or host.
export_database_urls() {
  local url test_url
  url="$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  test_url="$(grep -E '^TEST_DATABASE_URL=' "$BACKEND_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  [ -n "$url" ] || url="postgresql+asyncpg://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
  [ -n "$test_url" ] || test_url="postgresql+asyncpg://$DB_USER:$DB_PASSWORD@localhost:5432/mandimate_test"
  DATABASE_URL="$(echo "$url" | sed -E "s#@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/#@\1:$DB_PORT/#")"
  TEST_DATABASE_URL="$(echo "$test_url" | sed -E "s#@(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?/#@\1:$DB_PORT/#")"
  case "$DATABASE_URL" in
    *@localhost:"$DB_PORT"/* | *@127.0.0.1:"$DB_PORT"/* | *@\[::1\]:"$DB_PORT"/*) ;;
    *) fail "DATABASE_URL in backend/.env does not point at MandiMate's container (localhost:$DB_PORT); refusing to migrate or seed it." ;;
  esac
  export DATABASE_URL TEST_DATABASE_URL
}

run_migrations() {
  step "Migrations"
  local attempt out
  for attempt in 1 2 3 4 5; do
    if out="$(cd "$BACKEND_DIR" && uv run alembic upgrade head 2>&1)"; then
      ok "Database schema is up to date"
      return 0
    fi
    sleep 2
  done
  echo "$out" | tail -25 >&2
  fail "Migrations failed (see above)."
}

seed_database() {
  step "Demo data"
  case "$SEED_MODE" in auto | always | never) ;; *) fail "--seed must be auto, always or never (got '$SEED_MODE')." ;; esac
  if [ "$SEED_MODE" = "never" ]; then
    say "Skipping demo data (--seed=never)."
    return 0
  fi
  local users flags=""
  users="$(db_sql "SELECT count(*) FROM users" || true)"
  if [ "$SEED_MODE" = "always" ]; then
    flags="--reset"
  elif [ "${users:-0}" != "0" ]; then
    ok "Database already has $users users — keeping your data (./dev.sh reset reloads the demo)"
    return 0
  fi
  say "Loading the Madanapalle demo data${flags:+ (wiping existing data first)}..."
  # shellcheck disable=SC2086
  (cd "$BACKEND_DIR" && uv run python -m app.seed $flags) >"$LOG_DIR/seed.log" 2>&1 ||
    { tail -25 "$LOG_DIR/seed.log" >&2; fail "Seeding failed (full log: .dev/logs/seed.log)."; }
  ok "Demo data loaded (26 accounts, password $DEMO_PASSWORD)"
}

# ── Services ───────────────────────────────────────────────────────────────────────────────────
API_PID=""
WEB_PID=""
NGROK_PID=""
SHARE_URL=""

# start_service <label> <colour> <dir> <log> <command...>: background process group of its own.
start_service() {
  local label=$1 colour=$2 dir=$3 log=$4
  shift 4
  : >"$log"
  set -m
  if [ "$DETACH" = 1 ]; then
    (cd "$dir" && exec nohup "$@" </dev/null >>"$log" 2>&1) &
  else
    (
      cd "$dir"
      "$@" </dev/null 2>&1 | tee -a "$log" | prefix "$label" "$colour"
    ) &
  fi
  set +m
  LAST_PID=$!
}

group_alive() { [ -n "$1" ] && kill -0 -- "-$1" 2>/dev/null; }

stop_services() {
  local pid t=0
  # Disowned jobs are not reported by bash ("Terminated: 15") when they exit.
  for pid in $API_PID $WEB_PID $NGROK_PID; do disown "$pid" 2>/dev/null || true; done
  for pid in $API_PID $WEB_PID $NGROK_PID; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  while { group_alive "$API_PID" || group_alive "$WEB_PID"; } && [ "$t" -lt 40 ]; do
    sleep 0.25
    t=$((t + 1))
  done
  for pid in $API_PID $WEB_PID $NGROK_PID; do kill -KILL -- "-$pid" 2>/dev/null || true; done
  rm -f "$PID_FILE"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM ERR
  if { [ "$DETACH" != 1 ] || [ "${READY:-0}" != 1 ]; } && [ -n "$API_PID$WEB_PID" ]; then
    printf '\n'
    say "Stopping API and web..."
    stop_services
    ok "Stopped. The database keeps running (./dev.sh stop --all stops it too)."
  fi
  if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$$" ]; then rm -rf "$LOCK_DIR"; fi
  exit "$status"
}

ai_mode_now() { curl -fsS --max-time 2 "http://127.0.0.1:$API_PORT/health" 2>/dev/null | sed -n 's/.*"ai_mode":"\([a-z]*\)".*/\1/p'; }

wait_until_ready() {
  local t=0 api_ok=0 web_ok=0
  while [ "$t" -lt "$READY_TIMEOUT" ]; do
    if ! group_alive "$API_PID"; then
      warn "The API stopped while starting. Last lines of .dev/logs/api.log:"
      tail -30 "$LOG_DIR/api.log" | sed 's/^/      /' >&2
      return 1
    fi
    if ! group_alive "$WEB_PID"; then
      warn "The web app stopped while starting. Last lines of .dev/logs/web.log:"
      tail -30 "$LOG_DIR/web.log" | sed 's/^/      /' >&2
      return 1
    fi
    [ "$api_ok" = 1 ] || { curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$API_PORT/health" 2>/dev/null && api_ok=1; }
    [ "$web_ok" = 1 ] || { curl -fsS -o /dev/null --max-time 2 "http://localhost:$WEB_PORT/" 2>/dev/null && web_ok=1; }
    [ "$api_ok" = 1 ] && [ "$web_ok" = 1 ] && return 0
    sleep 1
    t=$((t + 1))
  done
  warn "Timed out after ${READY_TIMEOUT}s waiting for the API ($api_ok) and web ($web_ok)."
  return 1
}

# launch_tunnel <name> <url-regex> <command...>: starts a tunnel in its own process group and waits for its URL.
launch_tunnel() {
  local name=$1 pattern=$2 log="$LOG_DIR/$1.log" t=0
  shift 2
  : >"$log"
  set -m
  (cd "$ROOT_DIR" && exec nohup "$@" </dev/null >>"$log" 2>&1) &
  set +m
  NGROK_PID=$!
  printf '%s %s\n' "$name" "$NGROK_PID" >>"$PID_FILE"
  SHARE_URL=""
  while [ "$t" -lt 60 ]; do
    SHARE_URL="$( (grep -Eo "$pattern" "$log" 2>/dev/null || true) | head -1)"
    [ -n "$SHARE_URL" ] && return 0
    group_alive "$NGROK_PID" || break
    sleep 0.5
    t=$((t + 1))
  done
  tail -5 "$log" | sed 's/^/      /' >&2
  kill -TERM -- "-$NGROK_PID" 2>/dev/null || true
  NGROK_PID=""
  return 1
}

# tunnel_blocked: the public URL answers with an ngrok error page (725 = monthly bandwidth used up).
tunnel_blocked() {
  local body
  body="$(curl -sS --max-time 15 -H 'ngrok-skip-browser-warning: 1' "$SHARE_URL/" 2>/dev/null || true)"
  case "$body" in
    *ERR_NGROK_725*) TUNNEL_ERROR="ngrok's free monthly bandwidth is used up (ERR_NGROK_725)" ;;
    *ERR_NGROK_*) TUNNEL_ERROR="ngrok refused the link ($(printf '%s' "$body" | grep -Eo 'ERR_NGROK_[0-9]+' | head -1))" ;;
    *) return 1 ;;
  esac
  return 0
}

start_ngrok() {
  step "Public link (ngrok)"
  if ! launch_tunnel ngrok 'url=https://[^ ]+' ngrok http "$WEB_PORT" --log stdout --log-format logfmt; then
    TUNNEL_ERROR="ngrok did not start (missing authtoken: ngrok config add-authtoken <token>, or another free-plan session is open)"
    return 1
  fi
  SHARE_URL="${SHARE_URL#url=}"
  if tunnel_blocked; then
    kill -TERM -- "-$NGROK_PID" 2>/dev/null || true
    NGROK_PID=""
    SHARE_URL=""
    return 1
  fi
  return 0
}

start_cloudflared() {
  step "Public link (cloudflared)"
  launch_tunnel cloudflared 'https://[a-z0-9-]+\.trycloudflare\.com' \
    cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT" || {
    TUNNEL_ERROR="cloudflared did not report a link (see .dev/logs/cloudflared.log)"
    return 1
  }
}

start_tunnel() {
  TUNNEL_ERROR=""
  case "$TUNNEL" in
    ngrok)
      have ngrok || fail "ngrok is not installed: brew install ngrok/ngrok/ngrok, then ngrok config add-authtoken <token>."
      start_ngrok || warn "$TUNNEL_ERROR. Try ./dev.sh share --tunnel=cloudflared (free, no bandwidth cap)."
      ;;
    cloudflared)
      have cloudflared || fail "cloudflared is not installed: brew install cloudflared (free, no account needed)."
      start_cloudflared || warn "$TUNNEL_ERROR."
      ;;
    auto)
      if have ngrok && start_ngrok; then :; else
        [ -n "$TUNNEL_ERROR" ] && warn "$TUNNEL_ERROR."
        if have cloudflared; then
          say "Switching to cloudflared (free, no account, no bandwidth cap)."
          start_cloudflared || warn "$TUNNEL_ERROR."
        else
          warn "No other tunnel available. Install cloudflared for a free link with no bandwidth cap: brew install cloudflared"
        fi
      fi
      ;;
    *) fail "Unknown --tunnel=$TUNNEL (use auto, ngrok or cloudflared)." ;;
  esac
  if [ -n "$SHARE_URL" ]; then ok "Public link ready"; fi
}

# build_for_share: production build for visitors (minified, split and compressed instead of ~250 dev modules).
build_for_share() {
  step "Production build for sharing"
  say "Building the web app (visitors download ~1 MB instead of ~16 MB; use --dev to share hot reload instead)..."
  if ! (cd "$FRONTEND_DIR" && npm run --silent build) >"$LOG_DIR/build.log" 2>&1; then
    tail -30 "$LOG_DIR/build.log" | sed 's/^/      /' >&2
    fail "The production build failed (full log: .dev/logs/build.log). ./dev.sh share --dev shares the dev server instead."
  fi
  ok "Build ready"
}

banner() {
  local mode
  mode="$(ai_mode_now)"
  printf '\n%s%s  MandiMate is running%s\n' "$C_BOLD" "$C_BRASS" "$C_RESET"
  printf '  %-10s %shttp://localhost:%s%s\n' "Web" "$C_BOLD" "$WEB_PORT" "$C_RESET"
  printf '  %-10s http://localhost:%s/api/v1   (docs: /api/v1/docs)\n' "API" "$API_PORT"
  printf '  %-10s localhost:%s  (mandimate / mandimate)\n' "Database" "$DB_PORT"
  if [ -n "$SHARE_URL" ]; then
    printf '  %-10s %s%s%s   (anyone with this link can open the app)\n' "Public" "$C_BOLD$C_GREEN" "$SHARE_URL" "$C_RESET"
  fi
  if [ "$mode" = "live" ]; then
    printf '  %-10s %sLIVE DeepSeek — AI calls cost money%s\n' "AI" "$C_YELLOW" "$C_RESET"
  else
    printf '  %-10s %s (free, rule-based; --live-ai or AI_MODE=auto in backend/.env for DeepSeek)\n' "AI" "${mode:-mock}"
  fi
  printf '  %-10s ravi@mandimate.demo (farmer) · procurement@freshbasket.demo (buyer)\n' "Sign in"
  printf '  %-10s coordinator@madanapallefpo.demo · dispatch@swiftagri.demo · admin@mandimate.demo\n' ""
  printf '  %-10s %s\n' "Password" "$DEMO_PASSWORD"
  printf '  %-10s .dev/logs/  ·  ./dev.sh status  ·  ./dev.sh logs\n' "Logs"
  if [ "$DETACH" = 1 ]; then
    printf '  %-10s ./dev.sh stop\n\n' "Stop"
  else
    printf '  %-10s Ctrl-C\n\n' "Stop"
  fi
}

open_browser() {
  [ "$OPEN_BROWSER" = 1 ] || return 0
  local url="http://localhost:$WEB_PORT"
  if [ "$OS" = "Darwin" ]; then open "$url" >/dev/null 2>&1 || true
  elif have xdg-open; then xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

cmd_start() {
  mkdir -p "$LOG_DIR"
  printf '%s%sMandiMate%s — local stack\n' "$C_BOLD" "$C_BRASS" "$C_RESET"
  preflight

  step "Previous runs and ports"
  stop_previous
  mkdir "$LOCK_DIR" 2>/dev/null || { rm -rf "$LOCK_DIR"; mkdir "$LOCK_DIR"; }
  echo "$$" >"$LOCK_DIR/pid"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  resolve_port API_PORT api "API"
  resolve_port WEB_PORT web "web app"
  [ "$API_PORT" = "$WEB_PORT" ] && fail "The API and web ports must differ."
  ok "Ports ready — API :$API_PORT · web :$WEB_PORT"

  ensure_env_files
  ensure_dependencies
  start_database
  export_database_urls
  run_migrations
  seed_database

  step "API and web"
  export MANDIMATE_API_PORT="$API_PORT" MANDIMATE_WEB_PORT="$WEB_PORT"
  export CORS_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT,http://localhost:4173,http://localhost:8080"
  if [ -n "$AI_OVERRIDE" ]; then
    if [ "$AI_OVERRIDE" = "live" ] && [ -z "${DEEPSEEK_API_KEY:-}" ] &&
      ! grep -qE '^DEEPSEEK_API_KEY=.+' "$BACKEND_DIR/.env" 2>/dev/null; then
      fail "--live-ai needs DEEPSEEK_API_KEY (in your shell or backend/.env)."
    fi
    export AI_MODE="$AI_OVERRIDE"
  elif [ -n "${AI_MODE:-}" ]; then
    warn "Ignoring AI_MODE=$AI_MODE from your shell; backend/.env decides (use --live-ai / --mock-ai)."
    unset AI_MODE
  fi

  start_service api "$C_CYAN" "$BACKEND_DIR" "$LOG_DIR/api.log" \
    uv run uvicorn app.main:app --reload --host 127.0.0.1 --port "$API_PORT"
  API_PID=$LAST_PID
  if [ "${SHARE:-0}" = 1 ] && [ "$SHARE_DEV" = 0 ]; then
    build_for_share
    start_service web "$C_MAGENTA" "$FRONTEND_DIR" "$LOG_DIR/web.log" \
      npm run --silent preview -- --port "$WEB_PORT" --strictPort
  else
    start_service web "$C_MAGENTA" "$FRONTEND_DIR" "$LOG_DIR/web.log" \
      npm run --silent dev -- --port "$WEB_PORT" --strictPort
  fi
  WEB_PID=$LAST_PID
  printf 'api %s\nweb %s\n' "$API_PID" "$WEB_PID" >"$PID_FILE"
  printf 'API_PORT=%s\nWEB_PORT=%s\nDB_PORT=%s\n' "$API_PORT" "$WEB_PORT" "$DB_PORT" >"$PORTS_FILE"

  if ! wait_until_ready; then
    DETACH=0
    fail "MandiMate did not start. Full logs: .dev/logs/api.log and .dev/logs/web.log"
  fi
  [ "${SHARE:-0}" = 1 ] && start_tunnel
  READY=1
  banner
  open_browser

  if [ "$DETACH" = 1 ]; then
    disown -a 2>/dev/null || true
    rm -rf "$LOCK_DIR"
    trap - EXIT INT TERM
    exit 0
  fi

  while :; do
    if ! group_alive "$API_PID"; then
      warn "The API stopped unexpectedly. Last lines of .dev/logs/api.log:"
      tail -20 "$LOG_DIR/api.log" | sed 's/^/      /' >&2
      exit 1
    fi
    if [ -n "$NGROK_PID" ] && ! group_alive "$NGROK_PID"; then
      warn "The public tunnel closed (see .dev/logs/); the app keeps running locally."
      NGROK_PID=""
    fi
    if ! group_alive "$WEB_PID"; then
      warn "The web app stopped unexpectedly. Last lines of .dev/logs/web.log:"
      tail -20 "$LOG_DIR/web.log" | sed 's/^/      /' >&2
      exit 1
    fi
    sleep 1
  done
}

cmd_stop() {
  mkdir -p "$STATE_DIR"
  stop_previous
  if [ -f "$PORTS_FILE" ]; then
    # shellcheck disable=SC1090
    . "$PORTS_FILE"
  fi
  ok "API and web are stopped"
  if [ "$STOP_ALL" = 1 ]; then
    if have docker && docker_running && detect_compose; then
      "${COMPOSE[@]}" stop db >/dev/null 2>&1 || true
      ok "Database container stopped (data is kept)"
    fi
  else
    say "The database keeps running (./dev.sh stop --all stops it too)."
  fi
}

cmd_status() {
  [ -f "$PORTS_FILE" ] && . "$PORTS_FILE"
  printf '%s%sMandiMate status%s\n' "$C_BOLD" "$C_BRASS" "$C_RESET"
  if have docker && docker_running; then
    printf '  %-9s %s (health: %s, port %s)\n' "Database" "$(container_state)" "$(container_health)" "$(container_host_port || echo '-')"
  else
    printf '  %-9s Docker is not running\n' "Database"
  fi
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$API_PORT/health" 2>/dev/null; then
    printf '  %-9s %srunning%s on :%s (AI %s)\n' "API" "$C_GREEN" "$C_RESET" "$API_PORT" "$(ai_mode_now)"
  else
    printf '  %-9s %sstopped%s (port %s)\n' "API" "$C_DIM" "$C_RESET" "$API_PORT"
  fi
  if curl -fsS -o /dev/null --max-time 2 "http://localhost:$WEB_PORT/" 2>/dev/null; then
    printf '  %-9s %srunning%s on http://localhost:%s\n' "Web" "$C_GREEN" "$C_RESET" "$WEB_PORT"
  else
    printf '  %-9s %sstopped%s (port %s)\n' "Web" "$C_DIM" "$C_RESET" "$WEB_PORT"
  fi
  local port pid
  for port in "$API_PORT" "$WEB_PORT" "$DB_PORT"; do
    for pid in $(listening_pids "$port"); do
      printf '  %-9s :%s ← %s (pid %s)\n' "Port" "$port" "$(proc_name "$pid")" "$pid"
    done
  done
}

cmd_logs() {
  mkdir -p "$LOG_DIR"
  case "${LOG_TARGET:-all}" in
    api) tail -n 100 -F "$LOG_DIR/api.log" ;;
    web) tail -n 100 -F "$LOG_DIR/web.log" ;;
    db) docker logs -f --tail 100 "$DB_CONTAINER" ;;
    *) tail -n 50 -F "$LOG_DIR/api.log" "$LOG_DIR/web.log" ;;
  esac
}

cmd_doctor() {
  step "Prerequisites"
  local t
  for t in curl uv node npm docker; do if have "$t"; then ok "$t found"; else warn "$t missing"; fi; done
  if have node; then if node_version_ok; then ok "node $(node -v)"; else warn "node $(node -v) is too old (need 20.19+ or 22.12+)"; fi; fi
  if have docker && docker_running; then ok "Docker is running"; detect_compose && ok "Docker Compose found" || warn "Docker Compose missing"; else warn "Docker is not running (./dev.sh starts it on macOS)"; fi
  step "Ports"
  local port role
  for pair in "$API_PORT:API" "$WEB_PORT:web" "$DB_PORT:database"; do
    port="${pair%%:*}"
    role="${pair#*:}"
    if port_busy "$port"; then
      local who=""
      for pid in $(listening_pids "$port"); do who="$who $(proc_name "$pid")($pid)"; done
      [ -n "$who" ] || who=" a process owned by another user"
      say "Port $port ($role) is in use:$who"
    else
      ok "Port $port ($role) is free"
    fi
  done
  step "Files"
  [ -f "$BACKEND_DIR/.env" ] && ok "backend/.env exists" || say "backend/.env will be created from the example"
  [ -x "$FRONTEND_DIR/node_modules/.bin/vite" ] && ok "frontend dependencies installed" || say "frontend dependencies will be installed"
  [ -x "$BACKEND_DIR/.venv/bin/python" ] && ok "backend virtualenv exists" || say "backend dependencies will be installed"
  if have docker && docker_running; then printf '  %-9s %s\n' "Database" "$(container_state) (health: $(container_health))"; fi
}

cmd_reset() {
  if [ "$HARD_RESET" = 1 ]; then
    if [ "$ASSUME_YES" != 1 ]; then
      printf 'This deletes the local MandiMate database volume and uploaded media. Continue? [y/N] '
      local answer
      read -r answer || answer=""
      case "$answer" in y | Y | yes | YES) ;; *) say "Cancelled."; exit 0 ;; esac
    fi
    ensure_docker
    stop_previous 1
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    ok "Removed the database volume; it will be recreated empty and reseeded."
  fi
  SEED_MODE="always"
  cmd_start
}

case "$COMMAND" in
  help) usage ;;
  start) cmd_start ;;
  share) SHARE=1; cmd_start ;;
  stop) cmd_stop ;;
  restart) stop_previous; cmd_start ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  reset) cmd_reset ;;
  doctor) cmd_doctor ;;
esac
