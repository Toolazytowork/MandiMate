# MandiMate API Contract (v1)

Base path: `/api/v1`. All shapes are defined in [`frontend/src/types/api.ts`](../frontend/src/types/api.ts)
and mirrored by Pydantic models in `backend/app/schemas/`. Business rules live in
[`DOMAIN_RULES.md`](DOMAIN_RULES.md).

## Conventions

| Topic | Rule |
|---|---|
| Auth | httpOnly cookies. `mandimate_access` (JWT, 30 min, `Path=/`) and `mandimate_refresh` (JWT, 14 days, `Path=/api/v1/auth`). `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true`. |
| Client | Every request uses `credentials: 'include'`. On a `401` the client calls `POST /auth/refresh` once, then retries the original request; if refresh fails it routes to `/login`. |
| Errors | Non-2xx bodies are `ApiErrorBody`. Domain errors use `detail: string` and optionally `code`. `401` unauthenticated, `403` wrong role / not owner, `404` missing **or not visible to caller**, `409` invalid state transition, `422` validation. |
| Lists | Return plain JSON arrays, newest first, capped by `limit` (default 100, max 500). |
| Empty | `204 No Content` for logout and deletes. |
| Time | All timestamps UTC. "Today" for business rules = `Asia/Kolkata` date. |
| Roles | `admin` passes every `coordinator` check. "Participant" = farmer member of the lot, the buyer of the lot's accepted offer, the booked transporter, coordinator, admin. |

Legend for the **Who** column: `public` (no auth), `any` (any signed-in user), or role names.

---

## Health & public

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/health` (also mounted at `/health` root) | public | — | `HealthStatus` |
| GET | `/public/stats` | public | — | `PublicStats` |
| POST | `/public/contact` | public | `ContactRequest` | `{ "ok": true }` (stored, audit-logged) |
| POST | `/calculator/net-proceeds` | public | `NetProceedsCalcRequest` | `NetProceeds` |
| GET | `/crops` | public | — | `Crop[]` |

## Auth & profile

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | public | `SignupRequest` | `201 AuthResponse` + cookies |
| POST | `/auth/login` | public | `LoginRequest` | `AuthResponse` + cookies (`401` on bad credentials; `429` after 5 failures / 5 min per identifier+IP) |
| POST | `/auth/refresh` | refresh cookie | — | `AuthResponse` + rotated cookies |
| POST | `/auth/logout` | any | — | `204`, cookies cleared |
| GET | `/auth/me` | any | — | `User` |
| PATCH | `/users/me` | any | `UpdateProfileRequest` | `User` |
| POST | `/users/me/password` | any | `ChangePasswordRequest` | `204` |
| POST | `/users/me/verification-request` | buyer, transporter | `VerificationRequest` | `User` (status → `pending`) |

## Market

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/market-prices?crop_id=&district=&limit=` | any | — | `MarketPrice[]` (latest first) |

## Harvests

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/harvests?status=&crop_id=&farmer_id=` | farmer (own only), coordinator, admin | — | `Harvest[]` |
| POST | `/harvests` | farmer, coordinator (`farmer_id` required) | `HarvestCreateRequest` | `201 Harvest` |
| GET | `/harvests/{id}` | owner, coordinator, admin, buyers when status is `listed`/`pooled` | — | `Harvest` |
| PATCH | `/harvests/{id}` | owner, coordinator | `HarvestUpdateRequest` | `Harvest` (`409` unless `draft`/`listed`) |
| POST | `/harvests/{id}/cancel` | owner, coordinator | — | `Harvest` (`409` once committed) |
| POST | `/harvests/{id}/verify` | coordinator | `HarvestVerifyRequest` | `Harvest` (`quality_status` → `inspected`) |
| POST | `/harvests/{id}/photos` | owner, coordinator | multipart `file` (jpeg/png/webp, ≤ 8 MB) | `201 HarvestPhoto` |
| DELETE | `/harvests/{id}/photos/{photo_id}` | owner, coordinator | — | `204` |
| GET | `/harvests/{id}/options` | owner, coordinator | — | `SellingOptions` |
| GET | `/harvests/{id}/timeline` | owner, coordinator | — | `JourneyStep[]` |

## Demands (buyer requirements)

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/demands?status=&crop_id=` | buyer (own), farmer (open only, read-only), coordinator, admin | — | `Demand[]` |
| POST | `/demands` | buyer | `DemandCreateRequest` | `201 Demand` |
| GET | `/demands/{id}` | owner buyer, farmer (if open), coordinator, admin | — | `Demand` |
| PATCH | `/demands/{id}` | owner buyer | `DemandUpdateRequest` | `Demand` (`409` unless `open`) |
| POST | `/demands/{id}/cancel` | owner buyer, coordinator | — | `Demand` |

## Supply (buyer browsing)

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/supply?crop_id=&grade=&district=` | buyer, coordinator, admin | — | `SupplyItem[]` — lots in `open_for_offers` and harvests in `listed` |

## Lots & matching

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| POST | `/lots/match-preview` | coordinator | `MatchPreviewRequest` | `MatchProposal` |
| GET | `/lots?status=&crop_id=&mine=` | farmer (lots containing own harvests **plus** `forming`/`awaiting_consent` lots for crops they have listed), buyer (lots `open_for_offers` + lots with own offers), transporter (lots of requests they quoted/booked), coordinator, admin | — | `Lot[]` |
| POST | `/lots` | coordinator | `LotCreateRequest` | `201 Lot` (status `awaiting_consent`) |
| GET | `/lots/{id}` | participants, buyers when `open_for_offers` | — | `Lot` |
| POST | `/lots/{id}/join` | farmer | `JoinLotRequest` | `Lot` (member consent auto `accepted`) |
| POST | `/lots/{id}/members/{member_id}/consent` | the member's farmer, coordinator (assisted consent, audit-logged) | `ConsentRequest` | `Lot` |
| POST | `/lots/{id}/open` | coordinator | — | `Lot` (`forming`/`awaiting_consent` → `open_for_offers`; `409` if no accepted members) |
| POST | `/lots/{id}/cancel` | coordinator | — | `Lot` |
| GET | `/lots/{id}/timeline` | participants | — | `JourneyStep[]` |
| POST | `/lots/{id}/transport-plan` | participants | — | `TransportPlan` |

## Offers & negotiation

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/offers?status=&lot_id=&harvest_id=` | buyer (own), farmer (offers on own harvests / lots they are a member of), coordinator, admin | — | `Offer[]` |
| POST | `/offers` | buyer (verified **or** unverified; unverified flagged) | `OfferCreateRequest` | `201 Offer` |
| GET | `/offers/{id}` | buyer owner, seller side, coordinator, admin | — | `Offer` |
| POST | `/offers/{id}/counter` | side that is `awaiting` | `CounterRequest` | `Offer` |
| POST | `/offers/{id}/accept` | side that is `awaiting` (`seller` or `buyer`) | `OfferActionRequest` | `Offer` |
| POST | `/offers/{id}/reject` | seller side (or buyer when awaiting buyer) | `OfferActionRequest` | `Offer` |
| POST | `/offers/{id}/withdraw` | buyer owner (before `accepted`) | `OfferActionRequest` | `Offer` |
| POST | `/offers/{id}/consent?member_id=` | farmer member while `proposed`; coordinator may pass `member_id` to record an assisted consent (audit-logged) | `ConsentRequest` | `Offer` |
| GET | `/offers/{id}/breakdown?harvest_id=` | farmer (own share), coordinator (whole lot or a member via `harvest_id`) | — | `NetProceeds` |

"Seller side" = owner farmer for `harvest` offers; coordinator/admin for `lot` offers.

## Transport

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/vehicles` | transporter (own) | — | `Vehicle[]` |
| POST | `/vehicles` | transporter | `VehicleCreateRequest` | `201 Vehicle` |
| PATCH | `/vehicles/{id}` | owner transporter | `VehicleUpdateRequest` | `Vehicle` |
| DELETE | `/vehicles/{id}` | owner transporter | — | `204` |
| GET | `/transport-requests?status=&mine=` | transporter (open + own quoted/booked; `mine=true` → only own), coordinator, admin, farmer/buyer (their lots) | — | `TransportRequest[]` |
| POST | `/transport-requests` | coordinator | `TransportRequestCreateRequest` | `201 TransportRequest` (`409` if lot not `offer_accepted` or pickup terms are `buyer_pickup`) |
| GET | `/transport-requests/{id}` | transporter, participants | — | `TransportRequest` |
| POST | `/transport-requests/{id}/quotes` | transporter (one active quote each) | `QuoteCreateRequest` | `201 TransportQuote` |
| POST | `/transport-quotes/{id}/accept` | coordinator | — | `TransportRequest` (booked) |
| POST | `/transport-quotes/{id}/withdraw` | quoting transporter | — | `TransportQuote` |
| POST | `/transport-requests/{id}/stops/{stop_id}/pickup` | booked transporter | `PickupConfirmRequest` | `TransportRequest` |
| POST | `/transport-requests/{id}/complete` | booked transporter | `TripCompleteRequest` | `TransportRequest` |

## Delivery, settlement, disputes

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/lots/{id}/delivery` | participants | — | `DeliveryRecord` (`404` if not recorded) |
| POST | `/lots/{id}/delivery` | buyer of accepted offer, coordinator | `DeliveryRecordRequest` | `201 DeliveryRecord` (creates the `Settlement`) |
| GET | `/settlements?payment_status=` | buyer (own), farmer (with own payout only), coordinator, admin | — | `Settlement[]` |
| GET | `/settlements/{id}` | same as above | — | `Settlement` |
| POST | `/settlements/{id}/payments` | buyer owner, coordinator | `RecordPaymentRequest` | `Settlement` |
| POST | `/settlements/{id}/payouts/{payout_id}/mark-paid` | coordinator | `MarkPayoutPaidRequest` | `Settlement` |
| GET | `/disputes?status=` | any (own raised + own lots); coordinator/admin all | — | `Dispute[]` |
| POST | `/disputes` | lot participants | `DisputeCreateRequest` | `201 Dispute` (settlement → `disputed`) |
| PATCH | `/disputes/{id}` | coordinator | `DisputeUpdateRequest` | `Dispute` |

## Dashboards, earnings, insights

| Method | Path | Who | Response |
|---|---|---|---|
| GET | `/dashboard/farmer` | farmer | `FarmerDashboard` |
| GET | `/dashboard/buyer` | buyer | `BuyerDashboard` |
| GET | `/dashboard/transporter` | transporter | `TransporterDashboard` |
| GET | `/dashboard/coordinator` | coordinator | `CoordinatorDashboard` |
| GET | `/dashboard/admin` | admin | `AdminOverview` |
| GET | `/earnings` | farmer | `FarmerEarnings` |
| GET | `/insights/supply-demand` | coordinator | `SupplyDemandInsights` |

## Notifications

| Method | Path | Who | Response |
|---|---|---|---|
| GET | `/notifications?unread_only=` | any | `Notification[]` |
| GET | `/notifications/unread-count` | any | `UnreadCount` |
| POST | `/notifications/{id}/read` | owner | `Notification` |
| POST | `/notifications/read-all` | any | `204` |

## Coordinator & admin

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/coordinator/farmers` | coordinator | — | `FarmerSummary[]` (admin: all farmers; coordinator: own FPO) |
| POST | `/coordinator/farmers` | coordinator | `RegisterFarmerRequest` | `201 RegisteredFarmer` |
| GET | `/admin/users?role=&verification_status=&q=` | admin, coordinator (read-only) | — | `User[]` |
| POST | `/admin/users/{id}/verification` | admin, coordinator | `VerifyUserRequest` | `User` |
| GET | `/admin/audit-log?limit=` | admin | — | `AuditEntry[]` |

## AI assistants

All AI endpoints work with **no API key** (`AI_MODE=mock`) by returning deterministic, rule-based
results with `source: "rules"`. Numbers in AI responses always come from the calculation engine.

| Method | Path | Who | Request | Response |
|---|---|---|---|---|
| GET | `/ai/status` | any | — | `AiStatus` |
| POST | `/ai/voice-listing` | farmer, coordinator | `VoiceListingRequest` | `VoiceDraft` |
| POST | `/ai/deal-advice` | farmer (own harvest), coordinator | `DealAdviceRequest` | `DealAdvice` |
| POST | `/ai/offers/{id}/counter-suggestion?harvest_id=` | seller side | — | `CounterSuggestion` |
| POST | `/ai/match-explanation` | coordinator | `MatchExplanationRequest` | `AiText` |

## Media

Uploaded photos are served from `/media/<path>` (static mount on the API; proxied by Vite in dev
and by nginx in the container build).
