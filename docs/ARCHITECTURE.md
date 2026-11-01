# MandiMate Architecture

```
MandiMate/
├── backend/                 FastAPI · SQLAlchemy 2 (async) · Alembic · deepagents · DeepSeek
│   ├── app/
│   │   ├── main.py          App factory, middleware, routers, /media static mount
│   │   ├── core/            config, database, security, deps, errors, time, logging, ratelimit
│   │   ├── models/          SQLAlchemy ORM models (one module per aggregate)
│   │   ├── schemas/         Pydantic v2 models mirroring frontend/src/types/api.ts
│   │   ├── services/        Domain logic (pure engines + DB services)
│   │   ├── api/v1/          router.py + routes/<area>.py
│   │   ├── ai/              LLM factory, deepagents deal agent, voice parser, prompts, mock
│   │   └── seed/            Demo data (Madanapalle tomato cluster, Andhra Pradesh)
│   ├── alembic/             Migrations
│   └── tests/               pytest (unit + API), never calls the network
├── frontend/                Vite · React 19 · TypeScript · Tailwind v4 · TanStack Query · motion
│   ├── src/
│   │   ├── main.tsx / entry-client.tsx / entry-server.tsx
│   │   ├── app/             App.tsx, routes.tsx, guards, providers
│   │   ├── styles/          theme.css (tokens), globals.css
│   │   ├── components/ui/   Design-system primitives
│   │   ├── components/domain/  MandiMate-specific building blocks
│   │   ├── components/layout/  MarketingLayout, AppShell, Sidebar, Topbar
│   │   ├── components/marketing/ Sections & SVG art for public pages
│   │   ├── features/<area>/ Area-specific components & hooks
│   │   ├── pages/           marketing/, auth/, app/<role>/, NotFoundPage
│   │   ├── lib/             api client + endpoints, auth, format, seo, query, i18n, hooks
│   │   ├── i18n/locales/<lng>/<namespace>.json
│   │   └── types/api.ts     THE API contract
│   └── scripts/prerender.mjs  SSG for public routes + sitemap
├── docs/                    Architecture, API contract, domain rules, design system, AI, ops
├── infra/                   DB init scripts, nginx config
├── docker-compose.yml       Postgres (always) + optional api/web/adminer profiles
└── Makefile                 One-command developer workflow
```

## Runtime topology
```
Browser ──► Vite dev server :5173 ──/api,/media──► FastAPI :8000 ──► PostgreSQL :5432 (Docker)
                                                        └──► DeepSeek API (only when AI_MODE=live)
```
Production-like (`docker compose --profile full up`): nginx (:8080) serves the prerendered SPA and proxies
`/api` and `/media` to the API container.

## Backend conventions
- Python 3.12, managed by `uv`. Run from `backend/`: `uv run uvicorn app.main:app --reload`.
- **Imports**: ORM via `from app.models import Harvest`; schemas **always** via the module namespace
  `from app import schemas` → `schemas.Harvest` (names identical to the TS interfaces, so ORM and schema
  names never clash).
- `app/core/database.py`: `engine`, `SessionLocal`, `get_db()`.
- `app/core/deps.py`: `DbSession`, `CurrentUser`, `OptionalUser`, `require_roles(*roles)` (admin passes coordinator checks).
- `app/core/errors.py`: `DomainError(status_code, detail, code=None)` + helpers `not_found()`, `forbidden()`, `conflict()`, `bad_request()`.
- `app/core/time.py`: `utcnow()`, `today_ist()`.
- Money/quantities are `Numeric(12,2)` → `Decimal` in Python → `float` in schemas (round 2 dp).
- Enums are stored as strings (`native_enum=False`) so migrations stay simple.
- Each request uses one session; services `flush()`, the route commits (via `get_db` commit-on-success).
- Routers live in `app/api/v1/routes/<area>.py`, each exporting `router = APIRouter(...)`, all included by `app/api/v1/router.py`.

### Shared service API (signatures are binding — several modules call each other)
| Module | Functions |
|---|---|
| `services/pricing.py` | constants, `VEHICLE_CLASSES`, `VehicleClass`, `TransportEstimate`, `haversine_km`, `road_km`, `estimate_transport_cost(total_kg, distance_km, refrigerated=False)`, `compute_net_proceeds(...) -> schemas.NetProceeds`, `baseline_net_proceeds(...) -> schemas.NetProceeds | None`, `floor_price_for_min_net(...)`, `suggest_counter_price(...)` |
| `services/matching.py` | `CandidateInput`, `MatchParams`, `MatchResult`, `select_candidates(candidates, params) -> MatchResult` (pure) |
| `services/routing.py` | `RouteStop`, `RoutePlan`, `plan_route(stops, destination) -> RoutePlan` (pure) |
| `services/presenters.py` | `user_out(user) -> schemas.User`, `mask_name(full_name)`, `farmer_display_name(farmer, viewer, *, reveal=False)` |
| `services/audit.py` | `audit(db, actor, action, entity_type, entity_id, summary, payload=None)` |
| `services/notify.py` | `notify(db, user_ids, type, title, body, link=None, dedupe_key=None)`, `coordinator_ids_for(db, farmer_ids)` |
| `services/codes.py` | `next_code(db, kind, crop_code=None) -> str` |
| `services/market_service.py` | `latest_market_price(db, crop_id, district=None)` |
| `services/harvest_service.py` | `get_available_kg(db, harvest_id)`, `harvest_out(db, harvest, viewer)`, `harvests_out(db, harvests, viewer)`, `get_harvest_for_viewer(db, harvest_id, viewer)` |
| `services/lot_service.py` | `lot_out(db, lot, viewer)`, `lot_summary(db, lot)`, `get_lot_for_viewer(db, lot_id, viewer)`, `sync_harvest_status(db, harvest_id)`, `refresh_lot_status(db, lot)` |
| `services/offer_service.py` | `offer_out(db, offer, viewer)`, `expire_stale_offers(db)` |
| `services/selling_options.py` | `build_selling_options(db, harvest, viewer)`, `offer_breakdown(db, offer, viewer, harvest_id=None)` |
| `services/journey.py` | `lot_timeline(db, lot)`, `harvest_timeline(db, harvest)`, `compute_journey_step(db, lot)` |
| `services/transport_service.py` | `build_transport_plan(db, lot)`, `transport_request_out(db, req, viewer)` |
| `services/settlement_service.py` | `create_settlement_from_delivery(db, lot, actor)`, `settlement_out(db, s, viewer)`, `refresh_settlement_status(db, s)` |
| `services/metrics.py` | `pilot_metrics(db) -> schemas.PilotMetrics` |
| `ai/service.py` | `ai_status()`, `parse_voice_listing(db, req, user)`, `advise_deal(db, harvest, viewer)`, `suggest_counteroffer(db, offer, viewer, harvest_id=None)`, `explain_match(db, proposal, user)`, `summarize_insights(db, insights, user)` |

## Frontend conventions
- React 19 + TypeScript (strict). Router: `react-router` v7 in declarative mode (`<Routes>`), `BrowserRouter`
  on the client and `StaticRouter` in `entry-server.tsx`.
- Public pages are imported eagerly and prerendered; `/app/**` pages are `React.lazy` chunks.
- Data: TanStack Query. Raw calls live in `src/lib/api/*.ts` (typed with `src/types/api.ts`);
  feature hooks live in `src/features/<area>/hooks.ts`. Query keys come from `src/lib/api/keys.ts`.
- Forms: `react-hook-form` + `zod` v4 (`@hookform/resolvers/zod`).
- i18n: `i18next` namespaces per area (`common`, `marketing`, `auth`, `farmer`, `buyer`, `transporter`,
  `coordinator`, `admin`). Farmer + common strings are fully translated to `hi` and `te`.
- `<Seo>` writes into a head collector during SSR and updates `document.head` on the client. Never render
  `<title>` elements directly.
- Path alias `@/` → `src/`.

### Route map
| Path | Page file (`src/pages/…`) | Access |
|---|---|---|
| `/` | `marketing/HomePage.tsx` | public, prerendered |
| `/how-it-works` | `marketing/HowItWorksPage.tsx` | public |
| `/farmers` | `marketing/ForFarmersPage.tsx` | public |
| `/buyers` | `marketing/ForBuyersPage.tsx` | public |
| `/transporters` | `marketing/ForTransportersPage.tsx` | public |
| `/fpos` | `marketing/ForFposPage.tsx` | public |
| `/calculator` | `marketing/CalculatorPage.tsx` | public |
| `/pricing` | `marketing/PricingPage.tsx` | public |
| `/impact` | `marketing/ImpactPage.tsx` | public |
| `/about` | `marketing/AboutPage.tsx` | public |
| `/faq` | `marketing/FaqPage.tsx` | public |
| `/contact` | `marketing/ContactPage.tsx` | public |
| `/privacy` | `marketing/PrivacyPage.tsx` | public |
| `/terms` | `marketing/TermsPage.tsx` | public |
| `/login` | `auth/LoginPage.tsx` | public |
| `/signup` | `auth/SignupPage.tsx` | public |
| `/forgot-password` | `auth/ForgotPasswordPage.tsx` | public |
| `*` | `NotFoundPage.tsx` | public (`404.html`) |
| `/app` | `app/AppIndexPage.tsx` (redirects to role home) | signed in |
| `/app/notifications` | `app/shared/NotificationsPage.tsx` | any |
| `/app/settings` | `app/shared/SettingsPage.tsx` | any |
| `/app/disputes` | `app/shared/DisputesPage.tsx` | any |
| `/app/verification` | `app/shared/VerificationPage.tsx` | buyer, transporter |
| `/app/farmer` | `app/farmer/FarmerHomePage.tsx` | farmer |
| `/app/farmer/harvests` | `app/farmer/HarvestsPage.tsx` | farmer |
| `/app/farmer/harvests/new` | `app/farmer/NewHarvestPage.tsx` | farmer |
| `/app/farmer/harvests/:harvestId` | `app/farmer/HarvestDetailPage.tsx` | farmer |
| `/app/farmer/offers` | `app/farmer/OffersPage.tsx` | farmer |
| `/app/farmer/offers/:offerId` | `app/farmer/OfferDetailPage.tsx` | farmer |
| `/app/farmer/lots` | `app/farmer/LotsPage.tsx` | farmer |
| `/app/farmer/lots/:lotId` | `app/farmer/LotDetailPage.tsx` | farmer |
| `/app/farmer/sales` | `app/farmer/SalesPage.tsx` | farmer |
| `/app/farmer/earnings` | `app/farmer/EarningsPage.tsx` | farmer |
| `/app/farmer/demand` | `app/farmer/BuyerDemandPage.tsx` | farmer |
| `/app/buyer` | `app/buyer/BuyerHomePage.tsx` | buyer |
| `/app/buyer/demands` | `app/buyer/DemandsPage.tsx` | buyer |
| `/app/buyer/demands/new` | `app/buyer/NewDemandPage.tsx` | buyer |
| `/app/buyer/demands/:demandId` | `app/buyer/DemandDetailPage.tsx` | buyer |
| `/app/buyer/supply` | `app/buyer/SupplyPage.tsx` | buyer |
| `/app/buyer/offers` | `app/buyer/OffersPage.tsx` | buyer |
| `/app/buyer/offers/new` | `app/buyer/NewOfferPage.tsx` (`?lot_id=` or `?harvest_id=`) | buyer |
| `/app/buyer/offers/:offerId` | `app/buyer/OfferDetailPage.tsx` | buyer |
| `/app/buyer/orders` | `app/buyer/OrdersPage.tsx` | buyer |
| `/app/buyer/orders/:lotId` | `app/buyer/OrderDetailPage.tsx` | buyer |
| `/app/buyer/payments` | `app/buyer/PaymentsPage.tsx` | buyer |
| `/app/transporter` | `app/transporter/TransporterHomePage.tsx` | transporter |
| `/app/transporter/requests` | `app/transporter/RequestsPage.tsx` | transporter |
| `/app/transporter/requests/:requestId` | `app/transporter/RequestDetailPage.tsx` | transporter |
| `/app/transporter/trips` | `app/transporter/TripsPage.tsx` | transporter |
| `/app/transporter/trips/:requestId` | `app/transporter/TripDetailPage.tsx` | transporter |
| `/app/transporter/vehicles` | `app/transporter/VehiclesPage.tsx` | transporter |
| `/app/coordinator` | `app/coordinator/CoordinatorHomePage.tsx` | coordinator |
| `/app/coordinator/farmers` | `app/coordinator/FarmersPage.tsx` | coordinator |
| `/app/coordinator/farmers/new` | `app/coordinator/RegisterFarmerPage.tsx` | coordinator |
| `/app/coordinator/harvests` | `app/coordinator/HarvestsPage.tsx` | coordinator |
| `/app/coordinator/harvests/new` | `app/coordinator/AssistedListingPage.tsx` | coordinator |
| `/app/coordinator/lot-builder` | `app/coordinator/LotBuilderPage.tsx` | coordinator |
| `/app/coordinator/lots` | `app/coordinator/LotsPage.tsx` | coordinator |
| `/app/coordinator/lots/:lotId` | `app/coordinator/LotCockpitPage.tsx` | coordinator |
| `/app/coordinator/offers/:offerId` | `app/coordinator/OfferDetailPage.tsx` | coordinator |
| `/app/coordinator/transport` | `app/coordinator/TransportPage.tsx` | coordinator |
| `/app/coordinator/settlements` | `app/coordinator/SettlementsPage.tsx` | coordinator |
| `/app/coordinator/settlements/:settlementId` | `app/coordinator/SettlementDetailPage.tsx` | coordinator |
| `/app/coordinator/disputes` | `app/coordinator/DisputesPage.tsx` | coordinator |
| `/app/coordinator/insights` | `app/coordinator/InsightsPage.tsx` | coordinator |
| `/app/coordinator/verifications` | `app/coordinator/VerificationsPage.tsx` | coordinator |
| `/app/admin` | `app/admin/AdminHomePage.tsx` | admin |
| `/app/admin/users` | `app/admin/UsersPage.tsx` | admin |
| `/app/admin/audit` | `app/admin/AuditLogPage.tsx` | admin |

Admins can open every coordinator route; their sidebar shows an "Operations" group with them.
