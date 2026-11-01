# Testing

MandiMate's promise is that the numbers a farmer sees are right. The test strategy follows from
that: the engines that decide money, compatibility and feasibility are tested hardest, the API
is tested per role against a real PostgreSQL database, the contract between frontend and backend
is checked mechanically, and nothing in any suite touches the network.

## Running the suites

```bash
make db                      # once per session: the backend suite needs PostgreSQL
make test                    # backend pytest, then frontend typecheck + Vitest
make test-api                # backend only
make test-web                # frontend typecheck + Vitest
make lint                    # ruff check + ruff format --check + TypeScript typecheck
make check                   # lint, then every test: what CI runs
```

Pass extra arguments with `args`:

```bash
make test-api args="tests/test_contract.py -x"
make test-api args="-k net_proceeds -vv"
make test-web args="src/lib"
```

Or run the tools directly:

```bash
cd backend  && uv run pytest -x --lf          # rerun last failures, stop at the first
cd frontend && npx vitest                     # watch mode
cd frontend && npm run typecheck
```

## Backend (pytest)

Configuration lives in `backend/pyproject.toml`: tests under `backend/tests`, `asyncio_mode =
"auto"` with a session-scoped event loop, `--strict-markers`, and a summary of skips and failures
(`-ra`).

### What is tested where

| Layer | Focus | Style |
|---|---|---|
| **Engines** (`services/pricing.py`, `matching.py`, `routing.py`, settlement maths) | Every formula and rule in [DOMAIN_RULES.md](DOMAIN_RULES.md): deduction lines and their order, certainty per line, rounding, vehicle selection and multi-trip loads, compatibility rules 1 to 6, scoring and allocation never exceeding available kg, route ordering, counter-offer floor and rounding up to ₹0.50, payouts, shortages and rejections | Pure functions, plain inputs, exact `Decimal` expectations |
| **Contract** (`tests/test_contract.py`) | `app.schemas` mirrors `frontend/src/types/api.ts` exactly: every interface has a schema with the same fields, optionality, nullability and JSON shape; every string union has a `Literal` with the same values in the same order; request validation rules | Parses the TypeScript file; any unsupported construct fails loudly |
| **API** | Each endpoint per role: happy path, `401` without a session, `403` for the wrong role, `404` for records the caller may not see, `409` for invalid transitions, `422` for invalid input; masking of farmer names and minimum prices; status machines end to end (lot → offer → consent → transport → delivery → settlement) | `httpx.AsyncClient` over the ASGI app (lifespan managed by `asgi-lifespan`), cookies as a real browser would send them |
| **Auth & security** | Password policy, Argon2id verification, phone normalisation, token types and expiry, refresh rotation, login throttling (`429` after five failures), security headers, upload sniffing and re-encoding | Unit + API |
| **AI** | Voice parser in English, Hindi, Telugu, Kannada and Urdu (numbers, units, crops, relative dates, prices, `missing_fields`), rules explanations, mode resolution, fallback from failing or malformed live output | Mock mode + LangChain fake chat models |

### Database

API tests run against the dedicated `mandimate_test` database (`TEST_DATABASE_URL`, default
`postgresql+asyncpg://mandimate:mandimate@localhost:5432/mandimate_test`), created by
`infra/db/init/01-test-db.sql` when the database volume is first initialised. The development
database is never touched.

`tests/conftest.py` drops and recreates the schema from the ORM models once per session, and
every test that uses the `db`, `client`, `auth_client` or `make_user` fixtures starts from empty
tables (`TRUNCATE ... RESTART IDENTITY CASCADE`, code sequences restarted at 1), so tests are
independent and can run in any order. The login throttle is reset before each test.

Because the suite builds the schema from the models, migrations are verified separately:
`alembic upgrade head` on an empty database followed by `alembic check` (no drift between the
models and the migration history). The CI recipe below runs both.

If you changed the database port (see [SETUP.md](SETUP.md#port-5432-is-already-in-use)), set
`TEST_DATABASE_URL` in `backend/.env` accordingly.

### No network, ever

- An autouse fixture forces `AI_MODE=mock`, clears `DEEPSEEK_API_KEY` and makes constructing
  `ChatDeepSeek` raise, so no test can reach DeepSeek even by accident, and no key is needed.
- Live AI code paths are exercised by injecting LangChain fake chat models that return scripted
  messages, including malformed output, to prove the fallback to rules.
- Anything else that could reach out (market prices, notifications) is internal to MandiMate.

A test that needs the network is a bug in the test.

### Conventions

- Name tests after the rule they protect: `test_rejection_halved_for_inspected_grade_a`.
- Build data with small factory helpers rather than the demo seed, so each test shows exactly
  the state it depends on.
- Money assertions compare exact two-decimal values; never `pytest.approx` for rupees.
- Dates that depend on "today" use `today_ist()` from `app.core.time`, and tests pin it.

## Frontend (Vitest + TypeScript)

- `npm run typecheck` (`tsc -b --noEmit`) runs in strict mode across the app, the SSR entry and
  the build configuration. The API types come from `src/types/api.ts`, so a contract change
  surfaces as type errors everywhere it matters.
- `npm test` (`vitest run`) uses jsdom, `src/test/setup.ts` and matches `src/**/*.test.{ts,tsx}`.
- Focus areas: Indian number and money formatting (`12,40,000`, ₹), certainty badges (icon and
  word, never colour alone), the API client's single refresh-then-retry on `401`, zod form
  schemas mirroring backend validation, route guards per role, and translation parity: every
  translated namespace has the same keys and `{{placeholders}}` in `hi`, `te`, `kn` and `ur`
  (`src/i18n/parity.test.ts`), and Urdu is the one right-to-left language.
- Components are tested through what users see and do (Testing Library queries by role and
  label), not implementation details.

## Production build check

```bash
make build
```

Builds the client and SSR bundles and prerenders every public route, `404.html`, `app.html` and
`sitemap.xml`. The prerender step fails if any route renders empty markup, which catches SSR
regressions such as code that touches `window` during render.

## Manual end-to-end walkthrough

Before a demo or release, walk the eight-step journey with the seeded accounts (password
`MandiMate@2026`), ideally on a phone-sized viewport for the farmer steps:

1. **Farmer** `ravi@mandimate.demo` (Telugu UI): record a voice listing, confirm the draft, see
   which fields were missing.
2. **Coordinator** `coordinator@madanapallefpo.demo`: verify the harvest, open the lot builder,
   preview a match, read the explanation, create the lot.
3. **Farmer**: consent to join the lot; the lot opens for offers.
4. **Buyer** `procurement@freshbasket.demo`: browse supply, make an offer on the lot.
5. **Coordinator**: compare net proceeds per member, counter or accept; the offer goes to the
   farmers for consent.
6. **Farmer**: review the net breakdown (confirmed, estimated and unresolved lines) and consent.
7. **Coordinator**: create the transport request. **Transporter** `dispatch@swiftagri.demo`:
   quote. **Coordinator**: accept the quote. **Transporter**: confirm pickups, complete the trip.
8. **Buyer**: record delivery and quality, then the payment. **Coordinator**: mark payouts paid.
   **Farmer**: the sale appears in earnings with the uplift over the mandi.

Check along the way: notifications arrive for the right people, the journey timeline advances,
masked names appear to buyers, and the AI chip reads *AI · Demo mode* without a key.

## Continuous integration

A CI job needs PostgreSQL 17 with a `mandimate_test` database, uv and Node 20. For example, with
GitHub Actions:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: mandimate
          POSTGRES_PASSWORD: mandimate
          POSTGRES_DB: mandimate_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U mandimate" --health-interval 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: cd backend && uv sync --frozen
      - run: cd frontend && npm ci
      - run: make lint
      - name: Migrations apply cleanly and match the models
        working-directory: backend
        env:
          DATABASE_URL: postgresql+asyncpg://mandimate:mandimate@localhost:5432/mandimate_test
        run: uv run alembic upgrade head && uv run alembic check
      - run: make test
```

The suite needs no secrets: `AI_MODE` is forced to `mock`.
