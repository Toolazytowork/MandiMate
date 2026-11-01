import type { LucideIcon } from 'lucide-react';
import {
  BadgeIndianRupee,
  ClipboardCheck,
  Combine,
  HandCoins,
  ScanSearch,
  Sprout,
  Truck,
  Vote,
} from 'lucide-react';

export interface JourneyStep {
  /** 1-based position in the journey. */
  n: number;
  /** Anchor id on the How it works page. */
  slug: string;
  title: string;
  /** One line for the home page. */
  short: string;
  /** A paragraph for the How it works page (also the HowTo JSON-LD text). */
  detail: string;
  /** Who acts at this step. */
  who: string;
  /** What each party sees or gets. */
  sees: readonly string[];
  /** The rule that protects the farmer at this step. */
  safeguard: string;
  icon: LucideIcon;
}

/** The eight-step journey from the product brief, shared by the home page and How it works. */
export const JOURNEY_STEPS: readonly JourneyStep[] = [
  {
    n: 1,
    slug: 'register-harvest',
    title: 'Register a harvest',
    short: 'Crop, quantity, quality, location and sell-by date — typed, spoken or photographed.',
    detail:
      'A farmer lists what is ready: crop, quantity, expected quality, location, harvest date and the last day it can be sold. They can type it, speak it in their own language, add a photo, or ask a field coordinator to list it for them. A private minimum net price stays visible only to the farmer.',
    who: 'Farmer, or a field coordinator on their behalf',
    sees: ['A draft listing built from a voice note, checked before saving', 'A private minimum net price only they can see'],
    safeguard: 'The assistant asks for missing details instead of guessing them.',
    icon: Sprout,
  },
  {
    n: 2,
    slug: 'group-harvests',
    title: 'Check and group harvests',
    short: 'Compatible harvests are pooled by crop, grade, place, quantity and timing.',
    detail:
      'MandiMate looks across neighbouring farms for harvests that belong together: the same crop and grade, close enough to share a vehicle, ready inside the same window, and together large enough for a real buyer order. Explicit rules decide what can be pooled, so incompatible produce is never mixed.',
    who: 'MandiMate matching rules, reviewed by coordinators',
    sees: ['Why a group of harvests is a promising match', 'What information is still missing before a lot is buyer-ready'],
    safeguard: 'AI explains a match; it never silently combines incompatible produce or invents supply.',
    icon: Combine,
  },
  {
    n: 3,
    slug: 'buyer-offers',
    title: 'Buyers submit offers',
    short: 'Price, quantity, quality standards, pickup terms and payment conditions — in writing.',
    detail:
      'Verified retailers, wholesalers, processors, hotels and institutional kitchens make written offers on pooled lots: price per kilogram, quantity, quality specification, pickup terms and when they will pay. Offers can be countered and negotiated inside a single thread.',
    who: 'Verified buyers',
    sees: ['Every term in one written offer', 'Counter-offers and replies in one thread'],
    safeguard: 'Only verified buyers can make offers on a lot.',
    icon: HandCoins,
  },
  {
    n: 4,
    slug: 'compare-earnings',
    title: 'Compare real earnings',
    short: 'Each offer becomes net money per farmer — after transport, handling, commission and waiting.',
    detail:
      'For every farmer in the lot, MandiMate turns each offer into estimated net proceeds: gross value minus expected rejection, their share of transport, handling, commission and the cost of waiting for payment. It sets that beside what they would net selling alone at the local mandi.',
    who: 'MandiMate net-proceeds engine',
    sees: ['Net beside gross, per kilogram and in total', 'Which figures are confirmed, estimated or still unresolved'],
    safeguard: 'Prices and costs come from offers, quotes and published rates — never from an AI guess.',
    icon: BadgeIndianRupee,
  },
  {
    n: 5,
    slug: 'farmer-consent',
    title: 'Farmers review and decide',
    short: 'Each farmer sees the best feasible deal and accepts or declines. No sale without consent.',
    detail:
      'Every farmer in the pool reviews the proposed deal in plain language — what they would take home, what is confirmed and what is still an estimate — and accepts or declines. A farmer who declines simply leaves the lot; nobody can sell their produce for them.',
    who: 'Each farmer, individually',
    sees: ['A plain-language deal explanation', 'Accept or decline, with the reason recorded'],
    safeguard: 'No sale goes ahead without each farmer’s explicit consent.',
    icon: Vote,
  },
  {
    n: 6,
    slug: 'transport-pickup',
    title: 'Coordinate transport and pickup',
    short: 'One vehicle, a planned route and a pickup sequence across the pooled farms.',
    detail:
      'MandiMate plans collection points, picks a vehicle that fits the lot, orders the pickups along one route and invites transporters to quote. Transport is shared by weight, so a 200 kg harvest pays for 200 kg of the truck — not the whole trip.',
    who: 'Transporters and field coordinators',
    sees: ['Pickup time and collection point', 'Your share of transport, split by weight'],
    safeguard: 'Logistics are costed before a deal is recommended, so transport cannot quietly eat the margin.',
    icon: Truck,
  },
  {
    n: 7,
    slug: 'delivery-quality',
    title: 'Deliver and check quality',
    short: 'Delivered weight, grade, shortages and rejections are recorded against each farmer.',
    detail:
      'At delivery the buyer records what arrived: weight, quality and grade, any shortage and any rejection — attributed to the farmer whose produce it was. Discrepancies are raised there and then, with photos and notes, rather than discovered at payment time.',
    who: 'Buyer, with the coordinator and transporter',
    sees: ['Accepted and rejected quantity for your share', 'Any discrepancy, with evidence'],
    safeguard: 'Final acceptance follows physical inspection, not a photo.',
    icon: ClipboardCheck,
  },
  {
    n: 8,
    slug: 'settlement-results',
    title: 'Settle and track results',
    short: 'Payment status, deductions and earnings versus selling alone — recorded for every sale.',
    detail:
      'MandiMate tracks the settlement to each farmer: sale amount, every deduction, payment status and date. It then records what the farmer actually earned against what selling alone would have paid, so every harvest adds evidence about what really works.',
    who: 'Buyer, coordinators and MandiMate',
    sees: ['Payment status until the money arrives', 'Actual earnings versus the alternative'],
    safeguard: 'Every fee and deduction is shown; disputes have a clear, recorded process.',
    icon: ScanSearch,
  },
];
