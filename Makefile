# MandiMate — developer workflow.
#
#   make            list every target
#   make setup      install dependencies, create .env files
#   make dev        database + migrations + demo data + API + web, one Ctrl-C to stop
#
# Works with the GNU Make 3.81 that ships with macOS. Python always runs through uv from
# backend/; Node through npm from frontend/.

.DEFAULT_GOAL := help

COMPOSE   := docker compose
BACKEND   := backend
FRONTEND  := frontend
# Named volume of the db service: <compose project name>_<volume name> (docker-compose.yml).
DB_VOLUME := mandimate_mandimate-db-data
# Seconds `make db` waits for PostgreSQL to report healthy.
DB_WAIT   ?= 90

# Extra arguments for the test runners, e.g. make test-api args="-k pricing -x".
args ?=

.PHONY: help setup db db-stop db-reset migrate revision seed dev api web \
        test test-api test-web lint format check build clean up down logs adminer

##@ General

help: ## Show this help
	@awk 'BEGIN { FS = ":.*## "; printf "\n\033[1mMandiMate\033[0m · make \033[36m<target>\033[0m\n" } \
	  /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } \
	  /^[a-zA-Z0-9_-]+:.*## / { printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf '\nFirst run: ./dev.sh (or make dev), then open http://localhost:5173\n\n'

setup: ## Install backend (uv) + frontend (npm) dependencies; create .env files from the examples
	@command -v uv >/dev/null 2>&1 || { echo "uv is required: https://docs.astral.sh/uv/getting-started/installation/"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "Node.js 20 and npm are required: https://nodejs.org/"; exit 1; }
	cd $(BACKEND) && uv sync
	cd $(FRONTEND) && npm install
	@for dir in $(BACKEND) $(FRONTEND); do \
	  if [ -f $$dir/.env ]; then \
	    echo "kept    $$dir/.env (already exists)"; \
	  elif [ -f $$dir/.env.example ]; then \
	    cp $$dir/.env.example $$dir/.env && echo "created $$dir/.env from $$dir/.env.example"; \
	  else \
	    echo "skipped $$dir/.env ($$dir/.env.example not found)"; \
	  fi; \
	done
	@printf '\nReady. Next: make dev\n'

##@ Database

db: ## Start PostgreSQL (container mandimate-db) and wait until it is healthy
	$(COMPOSE) up -d --wait --wait-timeout $(DB_WAIT) db

db-stop: ## Stop PostgreSQL (data is kept)
	$(COMPOSE) stop db

db-reset: ## DESTROYS local data: drop the database volume and recreate an empty database
	@echo "Removing container mandimate-db and volume $(DB_VOLUME) ..."
	$(COMPOSE) rm --stop --force db
	docker volume rm --force $(DB_VOLUME)
	@$(MAKE) --no-print-directory db
	@printf '\nEmpty database ready. Next: make migrate seed (or make dev, which does both).\n'

migrate: ## Apply database migrations (alembic upgrade head)
	cd $(BACKEND) && uv run alembic upgrade head

revision: ## Autogenerate a migration from model changes: make revision msg="add vehicle notes"
	@test -n "$(msg)" || { echo 'Usage: make revision msg="describe the change"'; exit 1; }
	cd $(BACKEND) && uv run alembic revision --autogenerate -m "$(msg)"

seed: ## Load the demo data (Madanapalle tomato cluster, 26 demo accounts)
	cd $(BACKEND) && uv run python -m app.seed

##@ Develop

dev: ## Everything at once (same as ./dev.sh): frees ports, db, migrate, seed when empty, API + web
	@./dev.sh

dev-stop: ## Stop the API and web started by ./dev.sh (add ARGS=--all to stop the database too)
	@./dev.sh stop $(ARGS)

dev-status: ## Show what is running, on which ports, and the AI mode
	@./dev.sh status

api: ## Run only the API with auto-reload on http://localhost:8000
	cd $(BACKEND) && uv run uvicorn app.main:app --reload --port 8000

web: ## Run only the Vite dev server on http://localhost:5173 (proxies /api to :8000)
	cd $(FRONTEND) && npm run dev

##@ Quality

test: test-api test-web ## Run every suite: backend pytest, frontend typecheck + vitest

test-api: ## Backend tests (pytest, database mandimate_test; needs make db)
	cd $(BACKEND) && uv run pytest $(args)

test-web: ## Frontend typecheck + unit tests (vitest)
	cd $(FRONTEND) && npm run typecheck && npm test -- $(args)

lint: ## Ruff lint + format check (backend) and TypeScript typecheck (frontend)
	cd $(BACKEND) && uv run ruff check . && uv run ruff format --check .
	cd $(FRONTEND) && npm run typecheck

format: ## Auto-format and auto-fix the backend with ruff
	cd $(BACKEND) && uv run ruff format . && uv run ruff check --fix .

check: lint test ## Everything CI runs: lint, then all tests

##@ Build & containers

build: ## Production frontend build (client + SSR bundle + prerendered pages) into frontend/dist
	cd $(FRONTEND) && npm run build

clean: ## Remove build output and tool caches (keeps dependencies, .env files and data)
	rm -rf $(FRONTEND)/dist $(FRONTEND)/coverage $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache $(BACKEND)/htmlcov
	find $(BACKEND) -path $(BACKEND)/.venv -prune -o -type d -name __pycache__ -exec rm -rf {} +

up: ## Build and start the production-like stack (db + api + nginx web) on http://localhost:8080
	$(COMPOSE) --profile full up -d --build
	@printf '\nMandiMate is up on http://localhost:%s\n' "$$($(COMPOSE) --profile full port web 80 | sed 's/.*://')"
	@printf 'Demo data on a fresh volume: docker compose exec api python -m app.seed\n\n'

down: ## Stop and remove all MandiMate containers (volumes and data are kept)
	$(COMPOSE) --profile full --profile tools down

logs: ## Follow the logs of all running MandiMate containers
	$(COMPOSE) --profile full --profile tools logs -f --tail=200

adminer: ## Start Adminer (database browser) on http://localhost:8081
	$(COMPOSE) --profile tools up -d adminer
	@printf '\nAdminer: http://localhost:%s  (server db · user, password and database: mandimate)\n\n' \
	  "$$($(COMPOSE) --profile tools port adminer 8080 | sed 's/.*://')"
