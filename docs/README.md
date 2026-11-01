# MandiMate documentation

Start with the [project README](../README.md) for the pitch, the quick start and the demo
accounts. The documents below go deeper; the four marked **binding** are the specification the
code is held to.

## Product

| Document | Read it for |
|---|---|
| [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) | The vision: the problem, users, the eight-step journey, where AI helps, positioning |
| [BUSINESS_MODEL.md](BUSINESS_MODEL.md) | How MandiMate earns without charging farmers; illustrative unit economics |
| [PILOT_PLAYBOOK.md](PILOT_PLAYBOOK.md) | Launch plan, pilot metrics, field-coordinator SOPs for each step, risk register |

## Specification (binding)

| Document | Read it for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Repository layout, runtime topology, backend and frontend conventions, shared service API, route map |
| [API_CONTRACT.md](API_CONTRACT.md) | Every endpoint, who may call it, request and response types (`frontend/src/types/api.ts`) |
| [DOMAIN_RULES.md](DOMAIN_RULES.md) | Roles and masking, status machines, the net-proceeds, matching and routing engines, settlement, journey, notifications |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Visual language, tokens, components, motion, accessibility, SEO |

## Engineering & operations

| Document | Read it for |
|---|---|
| [SETUP.md](SETUP.md) | Local setup step by step, and troubleshooting |
| [TESTING.md](TESTING.md) | Test strategy, running suites, the manual end-to-end walkthrough, CI |
| [AI.md](AI.md) | Where AI is and is not used, the deal agent, voice parsing, modes, fallbacks, cost and prompt safety |
| [SECURITY.md](SECURITY.md) | Authentication, authorization and masking, uploads, headers, secrets, privacy, threat model |
| [DEPLOYMENT.md](DEPLOYMENT.md) | The container stack, configuration reference, TLS, backups, updates, scaling |

## Where things live

| You want to change | Look in |
|---|---|
| An API shape | `frontend/src/types/api.ts` first, then `backend/app/schemas/` (the contract test enforces the match) |
| A business rule or formula | `docs/DOMAIN_RULES.md`, then `backend/app/services/` |
| A page or component | `frontend/src/pages/`, `frontend/src/components/` |
| Copy or translations | `frontend/src/i18n/locales/{en,hi,te}/` |
| Local tooling | `dev.sh`, `Makefile`, `docker-compose.yml` |
| Container serving | `infra/nginx/`, `backend/Dockerfile`, `frontend/Dockerfile` |
