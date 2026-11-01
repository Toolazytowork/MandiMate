# Business model

> **No barrier for farmers.** MandiMate earns from the parties that gain consistency, volume and
> reliability: buyers, FPOs and, later, logistics coordination. Farmers pay nothing.

This is visible in the product itself: every net-proceeds breakdown ends with a `platform_fee`
line of ₹0.00 and the note *"MandiMate charges buyers, not farmers"*.

## Revenue streams

| Stream | Who pays | For what | When it applies |
|---|---|---|---|
| **Buyer coordination fee** | Buyer | Sourcing a consistent, graded, consolidated lot from many smallholders, with quality records, one delivery and a dispute process | Per **successfully sourced** lot: charged only when a lot is delivered and settled, never for listings or offers |
| **FPO / cooperative subscription** | FPO or cooperative | The operating system for collective selling: assisted registration and listing, the lot builder, buyer management, settlement and payout records for members, pilot metrics | Monthly, per organisation, from phase 3 |
| **Logistics coordination fee** | Buyer (door delivery) | Route planning, transporter sourcing and booking, pickup confirmation and delivery tracking | Per booked trip on MandiMate-delivered lots, shown as its own line before acceptance; never folded into the farmers' transport share |

MandiMate does not buy and resell produce and takes no hidden spread: the price the buyer pays per
kilogram is the price the farmer's breakdown starts from. Farmer data is not sold.

## Why each side pays

**Buyers** today assemble volume from many small suppliers or pay intermediaries whose margins
and quality are opaque. MandiMate gives them graded lots sized to their requirement, verified
counterparties, recorded quality checks, one consolidated delivery, clear payment terms and a
history of on-time performance. The fee is small relative to the value of a lot (see below) and
replaces cost they already carry in procurement time and rejections.

**FPOs** already coordinate members' sales, often in notebooks and phone calls. MandiMate turns
that into a system with records members trust, a growing buyer network and evidence of the
uplift they deliver, which also strengthens their own funding and membership case.

**Farmers** pay nothing, so adoption is limited only by trust, which the product earns with
transparency, the right to decline and recorded results.

## Illustrative unit economics

> **Hypothetical illustration, not a forecast.** The figures below are assumptions chosen to
> show how the model works. They are not pilot results, prices MandiMate has committed to, or
> projections. The pilot exists to replace them with measured numbers
> ([PILOT_PLAYBOOK.md](PILOT_PLAYBOOK.md)).

### One consignment

Assumptions: a 1,000 kg tomato lot at ₹16 / kg, a ₹500 buyer coordination fee, and the uplift
from the worked example in the [README](../README.md#why-mandimate) (₹4.38 / kg over selling alone
at the mandi).

| Item | Pilot stage (assisted) | Steady state (partly automated) |
|---|---:|---:|
| Value of the lot (GMV) | ₹16,000 | ₹16,000 |
| Buyer coordination fee | ₹500 (3.1 % of GMV) | ₹500 |
| Field coordination | −₹450 (3 h × ₹150 / h) | −₹150 (1 h × ₹150 / h) |
| Phone and travel | −₹80 | −₹40 |
| Hosting and AI | −₹20 | −₹10 |
| **Contribution per consignment** | **−₹50** | **+₹300** |
| Farmers' combined uplift (value created) | ≈ ₹4,380 | ≈ ₹4,380 |

Two things follow. First, the value created for farmers is many times the fee, so the fee is not
what makes or breaks a deal. Second, at pilot stage the model is about break-even per
consignment: profitability depends on coordinator hours per completed sale falling with
density, repeat orders and automation. That is why the pilot measures coordination cost per
completed sale, and why the brief lists "too operationally expensive" as a core risk.

### A month

The brief's illustration: **100 consignments a month × ₹500 = ₹50,000 monthly gross revenue**,
before operating costs. Adding subscriptions from, say, five FPOs at ₹3,000 a month would add
₹15,000. Neither figure is a forecast; both show the shape of the revenue, not its size.

## What has to be true

| Assumption | How the pilot tests it |
|---|---|
| Buyers accept a per-lot coordination fee | Letters of intent before the pilot, fee charged on settled lots, `repeat_buyers_pct` |
| Farmers' net uplift is real and stable | `net_uplift_per_kg` from settled payouts against the mandi baseline |
| Coordination cost per sale falls with volume | Coordinator hours per settled lot, week over week |
| Payment reliability can be managed | `avg_payment_delay_days`, overdue settlements, disputes |
| FPOs value the tooling enough to pay | Willingness-to-pay interviews at the end of the pilot |

## Defensibility

Over time the advantage is not the software but what it accumulates: a verified buyer network,
reliable transaction and payment histories, local logistics knowledge (routes, vehicles,
timings), and evidence of what actually raises farmers' earnings. Each completed lot makes the
next match, quote and recommendation better.

## Pricing principles

- Farmers never pay.
- Fees are charged on outcomes (a settled lot, a completed trip), not on activity.
- Every fee is a visible line in the relevant breakdown before anyone commits.
- Prices are published (the public `/pricing` page) and identical for comparable customers.
