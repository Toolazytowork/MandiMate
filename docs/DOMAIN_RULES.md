# MandiMate Domain Rules

These rules are the "calculations and rules for decisions" layer. AI never decides any of this;
it only explains results produced here. Shapes referenced below are in `frontend/src/types/api.ts`.

---

## 1. Roles, scope and visibility

| Role | Can |
|---|---|
| farmer | Own harvests, join lots, consent to pooling and deals, respond to direct offers, view own sales/earnings, raise disputes on own lots. |
| buyer | Post demands, browse supply, make/counter/withdraw offers, record delivery & quality check for own orders, record payments, raise disputes. Unverified buyers can act but are flagged everywhere (`buyer_verified=false`). |
| transporter | Manage vehicles, quote on open transport requests, run booked trips (confirm pickups, complete trip). |
| coordinator | Everything operational: assisted farmer registration, assisted listing, harvest verification, lot building, seller-side negotiation for lots, booking transport, recording delivery, settlement & payouts, disputes, user verification. In the pilot a coordinator has global read scope; `fpo_id` is used for display and notification routing. |
| admin | Superset of coordinator + audit log + admin overview. |

**Masking.** `farmer_name` is shown in full to: the farmer themself, coordinators, admins, and the
booked transporter of that lot. Everyone else sees `"<First name> <Last initial>."` (e.g. `Ravi K.`).
`min_price_per_kg` is visible only to the owner farmer, coordinators and admins.

**Not visible ⇒ 404**, wrong role for an action ⇒ 403, invalid state ⇒ 409.

**Lot participants:** member farmers (consent ≠ declined), buyer of the accepted offer, buyers with an
offer on the lot (read-only), booked transporter, coordinators, admins.

---

## 2. Status machines

### Harvest
```
draft → listed → pooled → committed → picked_up → delivered → settled
            ↘ cancelled (owner/coordinator while draft/listed, or pooled in lots with no accepted offer —
              the harvest is withdrawn from those pools first; never once committed)
listed → expired (lazily, when sell_by < today and still listed)
```
`available_kg = quantity_kg − Σ member.quantity_kg` over members in non-cancelled lots with consent ≠ declined.
The harvest `status` mirrors the most advanced active lot it belongs to; it returns to `listed`
when all its lots are cancelled or it declined every lot.

### Lot
```
forming ──(join / members added)──► awaiting_consent ──(no pending, ≥1 accepted)──► open_for_offers
   └──────────────(coordinator POST /open)─────────────────────────────────────────►┘
open_for_offers ──(offer accepted)──► offer_accepted
offer_accepted ──(quote accepted)──► transport_booked ──(first pickup)──► in_transit
offer_accepted|transport_booked|in_transit ──(delivery recorded)──► delivered
delivered ──(settlement paid AND every payout paid)──► settled
forming|awaiting_consent|open_for_offers|offer_accepted ──(coordinator cancel)──► cancelled
```
- `POST /lots` with members → `awaiting_consent` (members `pending`); with no members → `forming`.
- `POST /lots/{id}/join` (farmer) adds a member with consent `accepted`.
- When no member is `pending` and ≥ 1 is `accepted` the lot auto-advances to `open_for_offers`.
- `POST /lots/{id}/open` converts remaining `pending` members to `declined` (note "Did not respond").
- `buyer_pickup` lots skip transport: delivery may be recorded directly from `offer_accepted`.
- Solo lots (`is_solo=true`) are auto-created when a **direct harvest offer** is accepted so that every
  deal follows the same transport → delivery → settlement path.

### Offer
| Status | Awaiting | Allowed actions |
|---|---|---|
| `pending` | seller | seller: counter → `countered`; accept → (`harvest`: `accepted`) / (`lot`: `proposed`); reject → `rejected`. Buyer: withdraw. |
| `countered` | buyer | buyer: accept counter (adopt countered terms) → (`harvest`: `accepted`) / (`lot`: `proposed`); counter back → `pending`; withdraw; reject. |
| `proposed` | farmers | Each lot member farmer consents. Declining removes that member from the lot. When no consent is pending: ≥ 1 accepted ⇒ `accepted`; none ⇒ `rejected`. Coordinator may record consent on a farmer's behalf (audit-logged "assisted consent"). |
| `accepted` | — | terminal for negotiation |
| `rejected`, `withdrawn`, `expired` | — | terminal |

- Seller side: owner farmer for `harvest` offers; coordinator/admin for `lot` offers.
- Offers can only target lots in `open_for_offers` or harvests in `listed`. One open offer per buyer per target.
- `valid_until` passed while `pending`/`countered` ⇒ `expired` (lazily on read).
- On **accept**: accepted quantity = `min(offer.quantity_kg, lot.total_quantity_kg)`; if the offer is
  smaller than the lot, member quantities are scaled down pro-rata (1 decimal). All other open offers on
  the same lot/harvest become `rejected` with a system negotiation entry. Linked demand → `matched`.
- Every action appends a `NegotiationEntry` (`author_role='system'` for automatic ones).

### Transport request
`open → quoted (≥1 quote) → booked (coordinator accepts a quote; other quotes rejected) → in_progress (first pickup) → completed`.
Only for lots with `pickup_terms='mandimate_delivery'` in `offer_accepted`.

### Settlement
`pending → partially_paid → paid`; `overdue` (lazily, `due_date < today` and not paid); `disputed` while a
dispute linked to the lot is `open`/`under_review`. Payouts can be marked paid only once the
settlement is `paid`. When the settlement is paid and every payout is paid ⇒ lot `settled`, harvests
`settled`, demand `fulfilled`.

### Dispute
`open → under_review → resolved | rejected`.

---

## 3. Net proceeds engine (`backend/app/services/pricing.py`)

Constants (overridable in settings):

| Name | Value | Meaning |
|---|---|---|
| `LOADING_PER_KG` | ₹0.25 | Loading & crates at the collection point (estimate) |
| `MANDI_HANDLING_PER_KG` | ₹0.50 | Hamali / unloading at a mandi (baseline) |
| `MANDI_COMMISSION_PCT` | 8.0 | Commission agent fee at a mandi (baseline) |
| `CAPITAL_COST_ANNUAL_PCT` | 18.0 | Informal credit rate used to price payment delay |
| `BASELINE_DISTANCE_KM` | 25 | Farm → nearest mandi when unknown |
| `BASELINE_PAYMENT_DAYS` | 1 | Mandi pays next day |
| `ROAD_FACTOR` | 1.3 | Haversine → road distance |
| `DEFAULT_RADIUS_KM` | 40 | Matching radius |

Vehicle classes (`VEHICLE_CLASSES`):

| type | capacity kg | base ₹ | ₹/km | refrigerated |
|---|---|---|---|---|
| mini_truck | 750 | 600 | 18 | no |
| pickup | 1500 | 900 | 24 | no |
| light_truck | 3500 | 1500 | 32 | no |
| medium_truck | 9000 | 2500 | 45 | no |
| reefer_truck | 5000 | 3500 | 55 | yes |

`estimate_transport_cost(total_kg, distance_km, refrigerated=False)` picks the smallest eligible
class with capacity ≥ total_kg; if none, the largest eligible class with
`trips = ceil(total_kg / capacity)`. `cost_total = trips × (base + per_km × distance_km)`,
`utilization_pct = total_kg / (capacity × trips) × 100`.

### Formula (`compute_net_proceeds`)
```
q          = quantity_kg
r          = expected_rejection_pct / 100
rejected   = q × r                      expected_accepted_kg = q − rejected
gross      = price × q                                   (line gross, +)
rejection  = − price × rejected                          (line rejection)
accepted_value = gross + rejection
transport  = − transport_share                           (line transport)
handling   = − handling_per_kg × q                       (line handling)
commission = − commission_pct/100 × accepted_value       (line commission)
payment_wait = − accepted_value × CAPITAL_COST_ANNUAL_PCT/100 × days/365   (line payment_wait)
platform_fee = 0                                          (line platform_fee, note "MandiMate charges buyers, not farmers")
net        = gross + Σ deductions ;  net_per_kg = net / q ;  total_deductions = gross − net
```
All amounts rounded to 2 decimals at the end (compute in `Decimal`). Lines always appear in the
order: gross, rejection, transport, handling, commission, payment_wait, platform_fee.

### Certainty per line
| Line | confirmed | estimated | unresolved |
|---|---|---|---|
| gross | price from an offer (buyer's written quote) | baseline / calculator | — |
| rejection | after delivery (actuals) | harvest `inspected` | quality `self_reported` / `pending_inspection` → also adds "Quality inspection pending" |
| transport | `buyer_pickup` (0) or booked quote share | route-plan estimate | location data missing → "Transport cost unknown: location missing" |
| handling | — (always includes loading estimate) | always | — |
| commission | offer terms (usually 0 %) | baseline mandi % | — |
| payment_wait | — | always | — |
| platform_fee | always | — | — |

`confidence` = `unresolved` if any line unresolved, else `estimated` if any estimated, else `confirmed`.
Additional `unresolved` strings: "Transport quote pending" (mandimate_delivery without a booked quote),
"Buyer not yet verified", "Awaiting farmer consent" (offer `proposed`), "Awaiting buyer response"
(offer `countered`).

### Inputs for an offer option
- `expected_rejection_pct = min(offer.max_rejection_pct, crop.default_rejection_pct × (0.5 if harvest inspected and grade A else 1))`
- `handling_per_kg = offer.handling_charge_per_kg + LOADING_PER_KG`
- `commission_pct = offer.commission_pct` (0 for MandiMate deals)
- transport share for a member = lot transport cost × member_kg / lot_total_kg (note: "Shared by weight across N farmers").
  Lot transport cost = booked quote total, else route-plan estimate from the members' farms to the offer's
  delivery point (fallback: demand delivery point, fallback: collection point + `BASELINE_DISTANCE_KM`).
  For a direct harvest offer the "lot" is the harvest alone.

### Baseline ("credible alternative": sell alone at the local mandi)
`baseline_net_proceeds(quantity_kg, market_price_per_kg, distance_km, default_rejection_pct)`:
price = latest `modal_price_per_kg` for the crop (prefer the harvest's district); if no market price, no
baseline (`None`). Transport = `estimate_transport_cost(q, distance)` for the farmer alone; handling =
`MANDI_HANDLING_PER_KG`; commission = `MANDI_COMMISSION_PCT`; rejection = crop default; payment days =
`BASELINE_PAYMENT_DAYS`. Every line `estimated`. Label "Sell alone at local mandi". If the market price
is illustrative the gross note says so.

### Selling options (`GET /harvests/{id}/options`)
- Direct offers on the harvest in `pending|countered|accepted` → `direct_offer`, quantity =
  `min(offer qty, harvest quantity − kg committed to lots that already have an accepted offer)`. Kg that sit in a pool
  **without** an accepted deal still count, so the farmer can compare "sell directly" against "stay in the pool".
- Accepting a direct offer when the harvest's free kg are short automatically withdraws the needed kg from the farmer's pools that have
  no accepted offer yet (member consent → `declined`, note "Sold directly to <buyer>"; pending offer consents for that member are declined;
  lot status refreshed; coordinator notified). A pool with an accepted offer is never touched.
- Offers on lots containing the harvest (member consent ≠ declined) in `pending|countered|proposed|accepted` → `pooled_offer` with the member's quantity.
- Baseline (when computable) → `baseline`, `option_id='baseline'`.
- `meets_min_price = net_per_kg ≥ min_price_per_kg` (null if no minimum). The minimum is a **net** floor.
- Sorted by `net_amount` desc. `is_best`/`best_option_id` = highest net among non-baseline options;
  `uplift_vs_baseline_per_kg = best.net_per_kg − baseline.net_per_kg`.

### Counter-offer suggestion (rules; AI only words the rationale)
- Net is linear in price: `net(p) = a·p − b`. `floor_price_per_kg` = smallest `p` with `net(p)/q ≥ min_price` (null if no min).
- `market_reference_per_kg` = latest modal price.
- If `current ≥ max(floor, market_ref × 1.05)` → suggested = current (advise accepting).
- Else suggested = `max(floor, min(current + max(0.5, (market_ref − current)/2), market_ref × 1.05))`
  (without market reference: `max(floor, current × 1.05)`), rounded **up** to the nearest ₹0.50.

---

## 4. Matching engine (`backend/app/services/matching.py`, pure functions)

A harvest is **compatible** when all hold (otherwise it is listed in `excluded` with the reason):
1. same crop;
2. status `listed` or `pooled` and `available_kg > 0`;
3. grade **exactly** equals the requested grade (`ungraded` only when `include_ungraded`, flagged
   "inspection required before pickup"). Produce of different grades is never mixed;
4. `available_from ≤ pickup_date ≤ sell_by`;
5. has coordinates and `haversine × ROAD_FACTOR ≤ radius_km` from the collection point;
6. `pickup_date − harvest_date ≤ crop.perishability_days`.

Score (0–100) = distance `40 × (1 − d/radius)` + urgency `30 × (1 − clamp(days_to_sell_by, 0, 7)/7)` +
quality (`inspected` 20, `pending_inspection` 10, `self_reported` 5) + size `10 × min(available/target, 1)`.

Selection: sort by score desc (tie: distance asc), allocate `proposed_kg = min(available, remaining)`
until the target is reached. Never exceed `available_kg`; never invent supply.
`feasible = selected_total ≥ (demand.min_quantity_kg if demand else 0.9 × target)`.
`rules_applied` lists rules 1–6 in plain language. `explanation` is a deterministic sentence summary.

## 5. Route planning (`backend/app/services/routing.py`, pure)
Start at the stop farthest from the destination, then nearest-neighbour among remaining stops, then the
destination. Leg distance = haversine × `ROAD_FACTOR`. Returns ordered stops, legs, total km (1 dp) and
`route` points. The transport plan = route + `estimate_transport_cost(total_kg, total_km, crop.requires_refrigeration)`.

## 6. Delivery & settlement (`settlement_service.py`)
For each member: `dispatched_kg` = picked_kg if a pickup was confirmed else member quantity;
`rejected_kg = delivered_kg − accepted_kg`; `shortage_kg = dispatched_kg − delivered_kg`
(validation: `0 ≤ accepted ≤ delivered ≤ dispatched × 1.02`).

Per farmer payout:
```
gross            = price × accepted_kg
transport_share  = transport_total × dispatched_kg / Σ dispatched_kg     (transport_total = booked quote or 0 for buyer_pickup)
handling_share   = offer.handling_charge_per_kg × accepted_kg + LOADING_PER_KG × dispatched_kg
commission_share = commission_pct/100 × gross
net              = gross − transport_share − handling_share − commission_share
net_per_kg       = net / dispatched_kg
baseline_net_per_kg = baseline_net_proceeds(dispatched_kg, …).net_per_kg (null if no market price)
uplift_per_kg    = net_per_kg − baseline_net_per_kg
```
Settlement: `gross_amount = Σ gross` (what the buyer owes), cost totals, `net_to_farmers = Σ net`,
`due_date = delivery date + payment_terms_days`. Payments accumulate into `amount_paid`;
`paid` when `amount_paid ≥ gross_amount − 0.01`. In the pilot MandiMate pays the transporter out of the
buyer's payment and remits each farmer's net (recorded as payout `mark-paid`).

**Buyer reliability %** = share of the buyer's settlements past due date that were fully paid on or
before the due date (null if none).

## 7. Journey (8 steps) — `journey.py`
| # | key | complete when |
|---|---|---|
| 1 | listed | harvest exists (lot: always) |
| 2 | grouped | lot has ≥ 1 accepted member and status ≥ `open_for_offers` (solo lots: on creation) |
| 3 | offers | ≥ 1 offer received |
| 4 | compared | any offer countered, proposed or accepted (current while offers exist) |
| 5 | consent | an offer is accepted |
| 6 | transport | first pickup confirmed (status `skipped` for `buyer_pickup`) |
| 7 | delivered | delivery recorded |
| 8 | settled | lot settled |

`journey_step` = number of the first step that is not complete/skipped (8 when settled).
A harvest timeline follows its most advanced active lot; with no lot only step 1 is complete.

## 8. Notifications (in-app; `services/notify.py`)
| Event | Recipients | type |
|---|---|---|
| Lot created with members | member farmers ("Consent to join pooled sale") | consent |
| Offer created | harvest owner, or lot member farmers + coordinators | offer |
| Counter / accept / reject / withdraw | the other side | offer |
| Offer proposed | each member farmer ("Review the deal and consent") | consent |
| Offer accepted | buyer, member farmers | offer |
| Transport request created | all transporters | pickup |
| Quote submitted | coordinators | pickup |
| Quote accepted | transporter, member farmers ("Pickup on <date>") | pickup |
| Pickup confirmed | that farmer | pickup |
| Delivery recorded | member farmers, coordinators, buyer | delivery |
| Payment recorded / payout paid | coordinators / that farmer | payment |
| Harvest `sell_by` within 2 days and still listed | owner farmer (dedupe per harvest per day) | harvest_deadline |
| Dispute created / updated | coordinators / raiser | dispute |
| Verification decided | the user | verification |

"Coordinators" = coordinators with the same `fpo_id` as the farmer, or all coordinators if none match.

## 9. Codes
Lot `MM-<CROP CODE>-<0001>`, offer `OF-<00001>`, settlement `ST-<00001>`, dispute `DP-<0001>`
(PostgreSQL sequences).

## 10. Auth & security
- Passwords: Argon2id; min 8 chars with ≥ 1 letter and ≥ 1 digit.
- Login identifier: email (case-insensitive) or phone (digits only, Indian numbers normalised to `+91XXXXXXXXXX`).
- Signup: `email` or `phone` required; `organization_name` required for buyer/transporter/coordinator.
  Coordinator signup creates an FPO with that name. Buyers/transporters start `unverified`.
- JWT HS256 with `sub`, `role`, `type` (`access`/`refresh`), `jti`, `exp`. Refresh rotation on `/auth/refresh`.
- Login throttling: 5 failures per (identifier, IP) per 5 minutes → `429`.
- Security headers middleware; CORS only for configured origins with credentials.
- Uploads: content-type sniffed by Pillow, re-encoded to WebP (max 1600 px), random file names.
- `JWT_SECRET` must be changed when `APP_ENV=production` (startup check).

## 11. AI (`backend/app/ai`)
- `AI_MODE=auto|live|mock` (`auto` ⇒ live iff `DEEPSEEK_API_KEY` set). Mock returns deterministic rule-based
  results (`source: "rules"`). Live failures fall back to rules transparently.
- Live model: `langchain_deepseek.ChatDeepSeek` (`deepseek-flash`). The deal-negotiation assistant is a
  **deepagents** agent (`create_deep_agent`) whose tools only return numbers computed by the engines above,
  with a `logistics-analyst` sub-agent for transport trade-offs.
- Voice listing: transcript (browser Web Speech API, `en-IN`/`hi-IN`/`te-IN`) → draft. Rules parser
  handles digits, English number words, units (kg/kilo/quintal=100 kg/tonne=1000 kg, किलो/क्विंटल,
  కిలో/క్వింటాల్), crop names in all three languages, relative dates (today/tomorrow/day after;
  आज/कल/परसों; ఈరోజు/రేపు/ఎల్లుండి), prices ("₹15 per kilo"). Unknown fields are reported in
  `missing_fields`; never guessed.
- Every AI call is recorded in `ai_interactions` (feature, source, model, latency, success).
- Tests never call the network: the test-suite forces `AI_MODE=mock` and uses fake chat models.
