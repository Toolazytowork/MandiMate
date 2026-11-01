# Pilot playbook

How to take MandiMate from a working product to evidence: one village cluster, one crop, one buyer
segment, one measurable problem, one complete workflow. The question the pilot must answer is
not "do farmers like the app?" but **"do farmers verifiably net more per kilogram, reliably, at
a cost of coordination that can be sustained?"**

Every number in this playbook marked *target* is a hypothesis to test, not a result or a claim.

## 1. Pilot design

| Dimension | Choice | Why |
|---|---|---|
| Location | A tomato-growing village cluster around Madanapalle, Andhra Pradesh, within a 40 km radius (the default matching radius) | Dense smallholder supply, a large reference mandi for an honest baseline, short pickup routes |
| Crop | Tomato | High volume, perishable (pooling and fast pickup matter), visible grading, volatile prices |
| Buyer segment | B2B buyers that need consistent graded volume: organised retail procurement and institutional kitchens | They value consistency and reliable delivery, and can pay a coordination fee |
| Problem measured | Net earnings per kg versus selling alone at the local mandi | The mission, measured the way the farmer experiences it |
| Workflow | All eight steps, listing to settlement, inside MandiMate | The innovation is the connected workflow, not any single screen |
| Scale (*target*) | 10–20 farmers, 2–4 verified buyers, 1–2 transport partners, one FPO | Small enough to coordinate by hand, large enough to form real lots |
| Duration (*target*) | 4 weeks of preparation, 8 weeks of operations, 2 weeks of evaluation | Covers several harvest cycles and payment terms |

## 2. Launch plan

### Weeks −4 to −1: validate demand before recruiting farmers

The first risk in the brief is *not enough buyers*. Recruit buyers first.

- [ ] Sign letters of intent with 2–4 buyers: weekly volume, grade specification, acceptable
      rejection %, pickup terms, payment terms. Verify each (GST, references, a site visit) and
      mark them verified in MandiMate.
- [ ] Agree rates with 1–2 transporters for the routes; register their vehicles.
- [ ] Partner with one FPO; create its coordinator account; agree the coordinator's working hours
      and phone availability.
- [ ] Collect four weeks of mandi modal prices for tomato and load them as market prices: they
      drive the baseline every comparison is made against.
- [ ] Interview prospective farmers about their last three sales: price, transport, commission,
      rejection, payment delay. This validates the baseline assumptions (25 km to the mandi,
      8 % commission, next-day payment; [DOMAIN_RULES §3](DOMAIN_RULES.md#3-net-proceeds-engine-backendappservicespricingpy))
      or shows which of them to adjust for this cluster.
- [ ] Deploy (see [DEPLOYMENT.md](DEPLOYMENT.md)) with TLS, backups and real accounts; do not
      load the demo seed.
- [ ] Rehearse the full journey end to end with staff playing every role
      ([TESTING.md](TESTING.md#manual-end-to-end-walkthrough)).

### Weeks 1–2: onboarding

- [ ] Village meeting: what MandiMate does, that farmers pay **no fee**, that **no sale happens
      without their consent**, and that every deduction is shown.
- [ ] Register farmers (coordinator assisted registration), hand over temporary passwords in
      person, set each farmer's preferred language, record farm coordinates at the field.
- [ ] Help each farmer set a private minimum net price per harvest and explain that it is a
      **net** floor (after transport and deductions).
- [ ] First listings together, by voice or typed, with the coordinator present.

### Weeks 3–10: operations

Run the eight-step SOPs below for every lot. Hold a weekly review of the metrics with the FPO and
buyers, and a fortnightly farmer meeting to show each farmer their own earnings versus the mandi.

### Weeks 11–12: evaluation

Compare the pilot metrics with the targets, interview farmers, buyers and transporters, compute
the coordination cost per completed sale, and decide (section 6).

## 3. Pilot metrics

All metrics are computed by the platform from recorded transactions (`PilotMetrics`, shown on the
coordinator and admin dashboards) so they are auditable rather than self-reported.

| Brief measure | `PilotMetrics` field | Meaning | *Target* |
|---|---|---|---|
| Additional net income per kg vs a credible alternative | `net_uplift_per_kg` | Average farmer net ₹/kg above the baseline (selling alone at the local mandi) across settled payouts | ≥ ₹1.50 / kg |
| % of listed produce sold | `completion_rate_pct` | Share of listed kilograms that ended in a settled sale | ≥ 60 % |
| Time from listing to confirmed buyer | `avg_hours_listing_to_buyer` | Average hours from listing to an accepted offer | ≤ 36 h (tomato is perishable) |
| Transport cost per kg | `transport_cost_per_kg` | Transport cost divided by kilograms moved | Below a farmer's solo cost to the mandi |
| Payment delays | `avg_payment_delay_days` | Average days settlements were paid after their due date | ≤ 2 days |
| Rejections | `rejection_rate_pct` | Rejected kg as a share of delivered kg | ≤ crop default rejection |
| Failed transactions | `failed_transactions` | Deals that broke after acceptance (cancelled, unpaid or disputed without resolution) | 0 unresolved by pilot end |
| Repeat usage, farmers | `repeat_farmers_pct` | Share of selling farmers who sold more than once | ≥ 50 % |
| Repeat usage, buyers | `repeat_buyers_pct` | Share of buyers who bought more than once | ≥ 50 % |

Track two operational numbers outside the product as well:

- **Coordination cost per completed sale**: coordinator hours × cost per hour, plus phone and
  travel, divided by settled lots. The business model only works if this falls over time.
- **Farmer trust signals**: consent declines with reasons, disputes raised, farmers who stop
  listing (and why).

## 4. Field-coordinator SOPs

The coordinator is the human layer of "people for trust". Each SOP lists the screens used, what
to do, what to check and when to escalate to the pilot lead.

### Step 1 · Harvest registered

*Screens: Coordinator → Farmers → Register farmer; Harvests → Assisted listing.*

- Register new farmers with name, phone, village, district, language and farm coordinates;
  hand the temporary password over in person and help them sign in once.
- For assisted listings, read every field back to the farmer in their language before saving:
  crop, quantity, grade, harvest date, available from, sell-by, minimum net price.
- Voice drafts: confirm each field listed as missing; never fill a missing field with a guess.
- **Check**: quantity is plausible for the plot; sell-by respects the crop's shelf life;
  location is set (without it transport cost stays *unresolved*).
- **Escalate**: a farmer listing far beyond their usual volume, or a listing made on someone
  else's behalf without them present.

### Step 2 · Harvests checked and grouped

*Screens: Harvests (verify); Lot builder; Lots.*

- Inspect produce at the farm when possible and record the grade and inspection notes
  (quality → *inspected*). Inspected grade A halves the expected rejection used in estimates, so
  inspection directly improves the farmer's numbers.
- In the lot builder, preview a match for the target quantity and pickup date; read the excluded
  harvests and their reasons before creating the lot. Never pool different grades.
- Create the lot, call each member to explain it, and record consent as it comes in.
- **Check**: members' consent recorded within 24 hours; the lot opens for offers only with
  accepted members.
- **Escalate**: not enough compatible supply for a committed buyer requirement.

### Step 3 · Buyers submit offers

*Screens: Verifications; Lot cockpit; Offer detail.*

- Verify buyers before the pilot and keep verification current; unverified buyers are flagged
  on every offer and appear as an unresolved condition for farmers.
- Make sure each offer states price, quantity, grade limits, maximum rejection, pickup terms,
  payment terms and validity.
- **Check**: payment terms match the buyer's letter of intent; validity leaves farmers time to
  consent.
- **Escalate**: offers far below the market reference, or a buyer pressing for consent on a
  short deadline.

### Step 4 · Real earnings compared

*Screens: Lot cockpit (per-member net proceeds); Offer detail (counter-suggestion).*

- Compare offers by **net per kg per member**, not by price. Check the baseline comparison.
- Use the counter-offer suggestion when an offer is below the farmers' floors or the market
  reference; explain the rationale to the buyer in their terms (consistent grade, one pickup).
- **Check**: every *unresolved* line (transport quote pending, inspection pending, buyer not
  verified) is known and explained to farmers before consent.
- **Escalate**: the best offer is below the baseline for most members (do not push the deal).

### Step 5 · Farmers review and consent

*Screens: Offer detail (proposed); farmer notifications.*

- Every member farmer gets a consent request. Call those who have not responded and walk them
  through their own breakdown: price, each deduction, net per kg, net total, payment date.
- **Assisted consent** (recording consent on a farmer's behalf) only with the farmer's explicit
  agreement in that call, never inferred from silence; note the time and how consent was given.
  Every assisted consent is audit-logged.
- Respect declines without argument and record the reason; declining removes only that farmer.
- **Escalate**: any sign of pressure on a farmer, from anyone.

### Step 6 · Transport and pickup coordinated

*Screens: Transport; transporter requests and trips.*

- For MandiMate-delivered lots, create the transport request from the accepted offer, compare
  quotes (price, vehicle, timing), accept one; farmers are notified of the pickup date.
- The day before: confirm each farmer's quantity, crates and pickup time, following the planned
  stop order.
- At pickup the transporter confirms each stop with the picked quantity; differences from the
  agreed quantity are noted on the spot.
- **Check**: the vehicle matches the planned class (refrigeration if required).
- **Escalate**: a missed pickup, a breakdown, or picked quantities that diverge by more than 5 %.

### Step 7 · Delivered and checked

*Screens: Lot cockpit → Delivery.*

- The buyer (or the coordinator present at delivery) records delivered and accepted kilograms
  per member and quality notes. Rejected produce is photographed.
- Explain shortages (picked versus delivered) and rejections (delivered versus accepted) to
  each farmer the same day.
- **Check**: accepted ≤ delivered ≤ dispatched (2 % tolerance); rejection within the offer's
  maximum.
- **Escalate**: rejection above the agreed maximum, or the buyer refusing to sign off. Open a
  dispute with evidence; the settlement shows *disputed* until it is resolved.

### Step 8 · Settlement tracked

*Screens: Settlements; Settlement detail; Disputes.*

- Record buyer payments as they arrive (with reference). Once the settlement is paid, pay each
  farmer's net and mark the payout paid with the reference; the farmer is notified.
- Show each farmer their result: net per kg against the mandi baseline.
- Follow up overdue settlements on the day they become overdue.
- **Check**: payout amounts equal the settlement breakdown; transport paid from the buyer's
  payment.
- **Escalate**: any settlement more than 7 days overdue; any dispute older than 7 days.

### Daily and weekly rhythm

| When | Coordinator does |
|---|---|
| Every morning | Clear action items on the coordinator home: pending consents, harvests near sell-by, offers awaiting the seller side, pickups today, overdue payments |
| Every evening | Confirm tomorrow's pickups with farmers and the transporter |
| Weekly | Metrics review with the pilot lead; buyer call on next week's requirements |
| Fortnightly | Farmer meeting: results per farmer, questions, feedback |

## 5. Risk register

From the product brief, with early-warning signals drawn from the pilot metrics.

| Risk | Likelihood | Impact | Early warning | Mitigation | Owner |
|---|---|---|---|---|---|
| Not enough buyers | Medium | High | Lots open for offers > 48 h without an offer; low `completion_rate_pct` | Buyer letters of intent before farmer recruitment; keep 2+ buyers per week; demand posted before lots are built | Pilot lead |
| Poor quality consistency | Medium | High | Rising `rejection_rate_pct`; quality disputes | Pool only exactly matching grades; coordinator inspection; maximum rejection in every offer; farmer feedback on rejected produce | Coordinator |
| Transport eats the margin | Medium | High | `transport_cost_per_kg` approaching the uplift; low vehicle utilisation | Transport priced into every comparison before recommending; lots sized to vehicle capacity; buyer pickup where cheaper | Coordinator |
| Farmers distrust the platform | Medium | High | Consent declines without reason; farmers stop listing; low `repeat_farmers_pct` | No farmer fee; full breakdown of every deduction; right to decline; results shown against the mandi; same-day explanations of shortages and rejections | Coordinator, pilot lead |
| Buyers don't pay | Low–Medium | High | `avg_payment_delay_days` rising; overdue settlements | Verified buyers only; payment terms recorded; overdue follow-up; disputes; stop offering lots to buyers with overdue settlements | Pilot lead |
| Too operationally expensive | High | Medium | Coordination cost per completed sale flat or rising | Assisted coordination first, measured per sale; automate the most frequent manual steps afterwards | Pilot lead |

## 6. Decision at the end of the pilot

| Outcome | Evidence | Next step |
|---|---|---|
| **Expand** | Uplift positive and stable across lots, most produce sold, payments on time, repeat use by farmers and buyers, coordination cost falling | Phase 3: second crop or second cluster, FPO subscription, repeat-order matching |
| **Iterate** | Uplift positive but fragile (one buyer, high rejection or transport share) | Fix the weak link (buyer base, inspection, routing) and run another cycle |
| **Stop or pivot** | No uplift over the mandi after transport and rejections, or payments unreliable | Re-examine the buyer segment or crop before any expansion |

Publish the result to farmers and partners either way; transparency is the product.
