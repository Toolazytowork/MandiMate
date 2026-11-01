/**
 * MandiMate API contract — the single source of truth for every JSON shape exchanged
 * between the web client and the API.
 *
 * Rules
 *  - JSON keys are snake_case on both sides. The backend Pydantic schemas in
 *    backend/app/schemas mirror these interfaces field-for-field.
 *  - Money is INR as a JSON number rounded to 2 decimals. Quantities are kilograms.
 *  - `ISODate` is 'YYYY-MM-DD'; `ISODateTime` is ISO-8601 with timezone (UTC).
 *  - A field typed `X | null` is always present in responses (never omitted).
 *  - Request fields marked optional (`?`) may be omitted.
 *
 * Endpoints are documented in docs/API_CONTRACT.md; business rules in docs/DOMAIN_RULES.md.
 */

export type UUID = string;
export type ISODate = string;
export type ISODateTime = string;

/* ────────────────────────────── Enums ────────────────────────────── */

export type Role = 'farmer' | 'buyer' | 'transporter' | 'coordinator' | 'admin';
export type SignupRole = Exclude<Role, 'admin'>;
export type Language = 'en' | 'hi' | 'te' | 'kn' | 'ur';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type Grade = 'A' | 'B' | 'C' | 'ungraded';
export type CropCategory = 'vegetable' | 'fruit' | 'grain' | 'pulse' | 'spice' | 'oilseed';
/** How sure we are about a number shown to a farmer. */
export type Certainty = 'confirmed' | 'estimated' | 'unresolved';

export type HarvestStatus =
  | 'draft'
  | 'listed'
  | 'pooled'
  | 'committed'
  | 'picked_up'
  | 'delivered'
  | 'settled'
  | 'cancelled'
  | 'expired';
export type QualityStatus = 'self_reported' | 'pending_inspection' | 'inspected';
export type ListingSource = 'manual' | 'voice' | 'assisted';

export type DemandStatus = 'open' | 'matched' | 'fulfilled' | 'cancelled' | 'expired';

export type LotStatus =
  | 'forming'
  | 'awaiting_consent'
  | 'open_for_offers'
  | 'offer_accepted'
  | 'transport_booked'
  | 'in_transit'
  | 'delivered'
  | 'settled'
  | 'cancelled';
export type ConsentDecision = 'pending' | 'accepted' | 'declined';

export type OfferStatus =
  | 'pending'
  | 'countered'
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'expired';
export type OfferTargetType = 'lot' | 'harvest';
/** Who must act next on an offer. `farmers` = lot members must give consent. */
export type Awaiting = 'buyer' | 'seller' | 'farmers';
/** buyer_pickup: buyer collects from the collection point and pays transport.
 *  mandimate_delivery: MandiMate coordinates delivery to the buyer; transport is shared by the farmers' pool. */
export type PickupTerms = 'buyer_pickup' | 'mandimate_delivery';
export type NegotiationAction = 'offer' | 'counter' | 'accept' | 'reject' | 'withdraw' | 'propose' | 'consent' | 'note';

export type VehicleType = 'mini_truck' | 'pickup' | 'light_truck' | 'medium_truck' | 'reefer_truck';
export type TransportRequestStatus = 'open' | 'quoted' | 'booked' | 'in_progress' | 'completed' | 'cancelled';
export type QuoteStatus = 'submitted' | 'accepted' | 'rejected' | 'withdrawn';
export type StopStatus = 'pending' | 'picked_up' | 'skipped';

export type PaymentStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'disputed';
export type PayoutStatus = 'pending' | 'paid';

export type DisputeCategory = 'quantity' | 'quality' | 'payment' | 'transport' | 'other';
export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';

export type NotificationType =
  | 'offer'
  | 'consent'
  | 'lot'
  | 'pickup'
  | 'delivery'
  | 'payment'
  | 'harvest_deadline'
  | 'dispute'
  | 'verification'
  | 'system';

export type JourneyKey =
  | 'listed'
  | 'grouped'
  | 'offers'
  | 'compared'
  | 'consent'
  | 'transport'
  | 'delivered'
  | 'settled';
export type JourneyStepStatus = 'complete' | 'current' | 'upcoming' | 'skipped';

export type AiSource = 'ai' | 'rules';

/* ────────────────────────────── Errors ───────────────────────────── */

export interface ValidationIssue {
  loc: (string | number)[];
  msg: string;
  type: string;
}
/** Every non-2xx response body. `detail` is a string for domain errors, an array for 422s. */
export interface ApiErrorBody {
  detail: string | ValidationIssue[];
  code?: string;
}

/* ─────────────────────────── Auth & users ────────────────────────── */

export interface User {
  id: UUID;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: Role;
  preferred_language: Language;
  organization_name: string | null;
  village: string | null;
  district: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  verification_status: VerificationStatus;
  verification_note: string | null;
  fpo_id: UUID | null;
  fpo_name: string | null;
  created_at: ISODateTime;
}

export interface SignupRequest {
  full_name: string;
  /** At least one of email / phone is required. */
  email?: string | null;
  phone?: string | null;
  password: string;
  role: SignupRole;
  preferred_language?: Language;
  /** Business name (buyer / transporter) or FPO name (coordinator). Required for those roles. */
  organization_name?: string | null;
  village?: string | null;
  district?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface LoginRequest {
  /** Email address or phone number. */
  identifier: string;
  password: string;
}

export interface AuthResponse {
  user: User;
}

export interface UpdateProfileRequest {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  preferred_language?: Language;
  organization_name?: string | null;
  village?: string | null;
  district?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface VerificationRequest {
  /** Free-text description of documents provided (GSTIN, FSSAI, RC book, etc.). */
  documents_note: string;
}

/* ───────────────────────── Catalog & market ──────────────────────── */

export interface Crop {
  id: UUID;
  code: string;
  name: string;
  name_hi: string;
  name_te: string;
  name_kn: string;
  name_ur: string;
  category: CropCategory;
  perishability_days: number;
  grades: Grade[];
  default_rejection_pct: number;
  requires_refrigeration: boolean;
}

export interface MarketPrice {
  id: UUID;
  crop_id: UUID;
  crop_name: string;
  market_name: string;
  district: string;
  state: string;
  price_date: ISODate;
  min_price_per_kg: number;
  modal_price_per_kg: number;
  max_price_per_kg: number;
  source: string;
  /** Seeded / demo data that must be labelled as illustrative in the UI. */
  is_illustrative: boolean;
}

/* ───────────────────────────── Harvests ──────────────────────────── */

export interface PhotoAnalysis {
  dominant_color_hex: string;
  red_ratio: number;
  green_ratio: number;
  brightness: number;
  uniformity: number;
  observations: string[];
  disclaimer: string;
}

export interface HarvestPhoto {
  id: UUID;
  url: string;
  analysis: PhotoAnalysis | null;
  created_at: ISODateTime;
}

export interface Harvest {
  id: UUID;
  farmer_id: UUID;
  /** Masked (e.g. "Ravi K.") for viewers who are not the owner, a coordinator or an admin. */
  farmer_name: string;
  crop_id: UUID;
  crop_name: string;
  variety: string | null;
  quantity_kg: number;
  /** quantity_kg minus quantity committed to lots that are not cancelled. */
  available_kg: number;
  grade: Grade;
  quality_notes: string | null;
  quality_status: QualityStatus;
  harvest_date: ISODate;
  available_from: ISODate;
  sell_by: ISODate;
  village: string | null;
  district: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Private: only the owner farmer, coordinators and admins see it; null for everyone else. */
  min_price_per_kg: number | null;
  status: HarvestStatus;
  source: ListingSource;
  photos: HarvestPhoto[];
  lot_ids: UUID[];
  open_offers_count: number;
  best_offer_price_per_kg: number | null;
  created_by_id: UUID;
  verified_by_name: string | null;
  verified_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface HarvestCreateRequest {
  crop_id: UUID;
  variety?: string | null;
  quantity_kg: number;
  grade?: Grade;
  quality_notes?: string | null;
  harvest_date: ISODate;
  available_from: ISODate;
  sell_by: ISODate;
  /** Defaults to the farmer's profile location when omitted. */
  village?: string | null;
  district?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  min_price_per_kg?: number | null;
  source?: ListingSource;
  /** 'draft' or 'listed' (default 'listed'). */
  status?: 'draft' | 'listed';
  /** Coordinator-assisted listing on behalf of a farmer. Required when the caller is a coordinator/admin. */
  farmer_id?: UUID | null;
}

export type HarvestUpdateRequest = Partial<Omit<HarvestCreateRequest, 'farmer_id' | 'source'>>;

export interface HarvestVerifyRequest {
  grade: Grade;
  quality_notes?: string | null;
}

/* ───────────────────────────── Demands ───────────────────────────── */

export interface Demand {
  id: UUID;
  buyer_id: UUID;
  buyer_name: string;
  buyer_verified: boolean;
  crop_id: UUID;
  crop_name: string;
  grade_required: Grade;
  quantity_kg: number;
  min_quantity_kg: number;
  target_price_per_kg: number | null;
  delivery_location: string;
  delivery_district: string | null;
  delivery_state: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  needed_by: ISODate;
  payment_terms_days: number;
  max_rejection_pct: number;
  quality_spec: string | null;
  notes: string | null;
  status: DemandStatus;
  lot_ids: UUID[];
  created_at: ISODateTime;
}

export interface DemandCreateRequest {
  crop_id: UUID;
  grade_required: Grade;
  quantity_kg: number;
  min_quantity_kg?: number;
  target_price_per_kg?: number | null;
  delivery_location: string;
  delivery_district?: string | null;
  delivery_state?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  needed_by: ISODate;
  payment_terms_days: number;
  max_rejection_pct?: number;
  quality_spec?: string | null;
  notes?: string | null;
}

export type DemandUpdateRequest = Partial<DemandCreateRequest>;

/* ───────────────────────────── Supply ────────────────────────────── */

export interface SupplyItem {
  kind: 'lot' | 'harvest';
  id: UUID;
  code: string | null;
  crop_id: UUID;
  crop_name: string;
  grade: Grade;
  quantity_kg: number;
  member_count: number;
  village: string | null;
  district: string | null;
  quality_status: QualityStatus;
  available_from: ISODate;
  sell_by: ISODate;
  pickup_date: ISODate | null;
  /** Distance from the viewer's profile location, when both are known. */
  distance_km: number | null;
  offers_count: number;
  my_offer_status: OfferStatus | null;
}

/* ─────────────────────── Net proceeds engine ─────────────────────── */

export type BreakdownKey = 'gross' | 'transport' | 'handling' | 'commission' | 'rejection' | 'payment_wait' | 'platform_fee';

export interface BreakdownLine {
  key: BreakdownKey;
  label: string;
  /** Signed: positive for income (gross), negative for deductions, 0 for informational lines. */
  amount: number;
  per_kg: number;
  certainty: Certainty;
  note: string | null;
}

export interface NetProceeds {
  label: string;
  quantity_kg: number;
  expected_accepted_kg: number;
  gross_price_per_kg: number;
  gross_amount: number;
  lines: BreakdownLine[];
  /** Positive number: sum of all deductions. */
  total_deductions: number;
  net_amount: number;
  net_per_kg: number;
  payment_terms_days: number;
  /** 'confirmed' only when every line is confirmed; 'unresolved' if any line is unresolved. */
  confidence: Certainty;
  /** Human-readable open conditions, e.g. "Transport quote pending". */
  unresolved: string[];
}

export interface NetProceedsCalcRequest {
  quantity_kg: number;
  price_per_kg: number;
  transport_cost_total?: number | null;
  distance_km?: number | null;
  handling_charge_per_kg?: number | null;
  commission_pct?: number | null;
  expected_rejection_pct?: number | null;
  payment_terms_days?: number | null;
}

export type SellingOptionSource = 'direct_offer' | 'pooled_offer' | 'baseline';

export interface SellingOption extends NetProceeds {
  /** Offer id, or the literal 'baseline'. */
  option_id: string;
  source: SellingOptionSource;
  title: string;
  buyer_name: string | null;
  buyer_verified: boolean | null;
  offer_status: OfferStatus | null;
  awaiting: Awaiting | null;
  lot_id: UUID | null;
  valid_until: ISODateTime | null;
  /** null when the farmer set no minimum price. */
  meets_min_price: boolean | null;
  is_best: boolean;
}

export interface SellingOptions {
  harvest_id: UUID;
  crop_name: string;
  quantity_kg: number;
  min_price_per_kg: number | null;
  /** Sorted by net_amount descending; the baseline is always included when it can be computed. */
  options: SellingOption[];
  best_option_id: string | null;
  uplift_vs_baseline_per_kg: number | null;
  generated_at: ISODateTime;
}

/* ───────────────────────────── Matching ──────────────────────────── */

export interface MatchPreviewRequest {
  crop_id: UUID;
  grade: Grade;
  target_quantity_kg: number;
  collection_latitude: number;
  collection_longitude: number;
  pickup_date: ISODate;
  radius_km?: number;
  demand_id?: UUID | null;
  /** Also consider 'ungraded' listings (flagged: inspection required before pickup). Default false. */
  include_ungraded?: boolean;
}

export interface MatchCandidate {
  harvest_id: UUID;
  farmer_id: UUID;
  farmer_name: string;
  village: string | null;
  grade: Grade;
  quality_status: QualityStatus;
  available_kg: number;
  /** 0 when the candidate is compatible but not needed to reach the target. */
  proposed_kg: number;
  distance_km: number;
  sell_by: ISODate;
  score: number;
  reasons: string[];
}

export interface MatchExclusion {
  harvest_id: UUID;
  farmer_name: string;
  reason: string;
}

export interface MatchProposal {
  crop_id: UUID;
  crop_name: string;
  grade: Grade;
  target_quantity_kg: number;
  selected_total_kg: number;
  shortfall_kg: number;
  feasible: boolean;
  candidates: MatchCandidate[];
  excluded: MatchExclusion[];
  rules_applied: string[];
  explanation: string;
  collection_latitude: number;
  collection_longitude: number;
  pickup_date: ISODate;
  demand_id: UUID | null;
}

/* ─────────────────────────────── Lots ────────────────────────────── */

export interface LotMember {
  id: UUID;
  lot_id: UUID;
  harvest_id: UUID;
  farmer_id: UUID;
  farmer_name: string;
  village: string | null;
  quantity_kg: number;
  distance_km: number | null;
  harvest_quality_status: QualityStatus;
  consent_status: ConsentDecision;
  consented_at: ISODateTime | null;
  delivered_kg: number | null;
  accepted_kg: number | null;
  rejected_kg: number | null;
  rejection_reason: string | null;
  /** True when the member belongs to the requesting farmer. */
  is_mine: boolean;
}

export interface Lot {
  id: UUID;
  code: string;
  crop_id: UUID;
  crop_name: string;
  grade: Grade;
  demand_id: UUID | null;
  target_quantity_kg: number;
  /** Sum of members whose consent is not 'declined'. */
  total_quantity_kg: number;
  collection_point_name: string;
  collection_latitude: number;
  collection_longitude: number;
  district: string | null;
  state: string | null;
  pickup_date: ISODate;
  status: LotStatus;
  /** 1..8 — see JourneyKey order. */
  journey_step: number;
  is_solo: boolean;
  coordinator_id: UUID | null;
  coordinator_name: string | null;
  members: LotMember[];
  member_count: number;
  offers_count: number;
  accepted_offer_id: UUID | null;
  buyer_name: string | null;
  price_per_kg: number | null;
  pickup_terms: PickupTerms | null;
  transport_request_id: UUID | null;
  settlement_id: UUID | null;
  match_explanation: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface LotSummary {
  id: UUID;
  code: string;
  crop_name: string;
  grade: Grade;
  total_quantity_kg: number;
  member_count: number;
  status: LotStatus;
  journey_step: number;
  pickup_date: ISODate;
  buyer_name: string | null;
  price_per_kg: number | null;
}

export interface LotMemberInput {
  harvest_id: UUID;
  quantity_kg: number;
}

export interface LotCreateRequest {
  crop_id: UUID;
  grade: Grade;
  demand_id?: UUID | null;
  target_quantity_kg: number;
  collection_point_name: string;
  collection_latitude: number;
  collection_longitude: number;
  district?: string | null;
  state?: string | null;
  pickup_date: ISODate;
  members: LotMemberInput[];
  match_explanation?: string | null;
}

export type JoinLotRequest = LotMemberInput;

export interface ConsentRequest {
  decision: 'accepted' | 'declined';
  note?: string | null;
}

/* ────────────────────────────── Offers ───────────────────────────── */

export interface NegotiationEntry {
  id: UUID;
  author_id: UUID | null;
  author_name: string;
  author_role: Role | 'system';
  action: NegotiationAction;
  price_per_kg: number | null;
  quantity_kg: number | null;
  payment_terms_days: number | null;
  message: string | null;
  created_at: ISODateTime;
}

export interface OfferConsent {
  member_id: UUID;
  farmer_id: UUID;
  farmer_name: string;
  quantity_kg: number;
  decision: ConsentDecision;
  decided_at: ISODateTime | null;
  is_mine: boolean;
}

export interface Offer {
  id: UUID;
  code: string;
  buyer_id: UUID;
  buyer_name: string;
  buyer_verified: boolean;
  /** 0..100 from settlement history; null when there is no history yet. */
  buyer_reliability_pct: number | null;
  target_type: OfferTargetType;
  lot_id: UUID | null;
  lot_code: string | null;
  harvest_id: UUID | null;
  demand_id: UUID | null;
  crop_id: UUID;
  crop_name: string;
  grade: Grade;
  price_per_kg: number;
  quantity_kg: number;
  pickup_terms: PickupTerms;
  delivery_location: string;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  payment_terms_days: number;
  max_rejection_pct: number;
  quality_spec: string | null;
  handling_charge_per_kg: number;
  commission_pct: number;
  valid_until: ISODateTime;
  status: OfferStatus;
  awaiting: Awaiting | null;
  notes: string | null;
  negotiation: NegotiationEntry[];
  consents: OfferConsent[];
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface OfferCreateRequest {
  target_type: OfferTargetType;
  lot_id?: UUID | null;
  harvest_id?: UUID | null;
  demand_id?: UUID | null;
  price_per_kg: number;
  quantity_kg: number;
  pickup_terms: PickupTerms;
  delivery_location: string;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  payment_terms_days: number;
  max_rejection_pct: number;
  quality_spec?: string | null;
  handling_charge_per_kg?: number;
  valid_until: ISODateTime;
  notes?: string | null;
}

export interface CounterRequest {
  price_per_kg: number;
  quantity_kg?: number | null;
  payment_terms_days?: number | null;
  message?: string | null;
}

export interface OfferActionRequest {
  message?: string | null;
}

/* ──────────────────────── Transport & delivery ───────────────────── */

export interface Vehicle {
  id: UUID;
  transporter_id: UUID;
  vehicle_type: VehicleType;
  registration_number: string;
  capacity_kg: number;
  has_refrigeration: boolean;
  base_charge: number;
  per_km_rate: number;
  is_active: boolean;
  created_at: ISODateTime;
}

export interface VehicleCreateRequest {
  vehicle_type: VehicleType;
  registration_number: string;
  capacity_kg: number;
  has_refrigeration?: boolean;
  base_charge: number;
  per_km_rate: number;
}

export type VehicleUpdateRequest = Partial<VehicleCreateRequest> & { is_active?: boolean };

export interface PickupStop {
  id: UUID;
  sequence: number;
  member_id: UUID;
  farmer_name: string;
  village: string | null;
  latitude: number;
  longitude: number;
  quantity_kg: number;
  status: StopStatus;
  picked_kg: number | null;
  picked_up_at: ISODateTime | null;
}

/** A preview that is not persisted. Stop ids are member ids in a plan preview. */
export interface TransportPlan {
  lot_id: UUID;
  stops: PickupStop[];
  destination_name: string;
  destination_latitude: number;
  destination_longitude: number;
  total_distance_km: number;
  suggested_vehicle_type: VehicleType;
  vehicle_capacity_kg: number;
  trips_needed: number;
  utilization_pct: number;
  estimated_cost: number;
  cost_per_kg: number;
  /** Ordered [lat, lng] points: collection stops then destination. */
  route: [number, number][];
}

export interface TransportQuote {
  id: UUID;
  request_id: UUID;
  transporter_id: UUID;
  transporter_name: string;
  transporter_verified: boolean;
  vehicle_id: UUID | null;
  vehicle_type: VehicleType;
  capacity_kg: number;
  price_total: number;
  price_per_kg: number;
  eta_hours: number;
  notes: string | null;
  status: QuoteStatus;
  created_at: ISODateTime;
}

export interface TransportRequest {
  id: UUID;
  lot_id: UUID;
  lot_code: string;
  crop_name: string;
  total_quantity_kg: number;
  pickup_date: ISODate;
  requires_refrigeration: boolean;
  stops: PickupStop[];
  destination_name: string;
  destination_latitude: number;
  destination_longitude: number;
  estimated_distance_km: number;
  suggested_vehicle_type: VehicleType;
  estimated_cost: number;
  status: TransportRequestStatus;
  quotes: TransportQuote[];
  booked_quote_id: UUID | null;
  transporter_name: string | null;
  notes: string | null;
  created_at: ISODateTime;
}

export interface TransportRequestCreateRequest {
  lot_id: UUID;
  notes?: string | null;
}

export interface QuoteCreateRequest {
  vehicle_id?: UUID | null;
  vehicle_type: VehicleType;
  capacity_kg: number;
  price_total: number;
  eta_hours: number;
  notes?: string | null;
}

export interface PickupConfirmRequest {
  picked_kg: number;
  note?: string | null;
}

export interface TripCompleteRequest {
  note?: string | null;
}

export interface DeliveryItemInput {
  member_id: UUID;
  delivered_kg: number;
  accepted_kg: number;
  rejection_reason?: string | null;
}

export interface DeliveryRecordRequest {
  items: DeliveryItemInput[];
  inspector_name?: string | null;
  notes?: string | null;
}

export interface DeliveryItem {
  member_id: UUID;
  farmer_name: string;
  dispatched_kg: number;
  delivered_kg: number;
  accepted_kg: number;
  rejected_kg: number;
  shortage_kg: number;
  rejection_reason: string | null;
}

export interface DeliveryRecord {
  lot_id: UUID;
  lot_code: string;
  recorded_by_name: string;
  inspector_name: string | null;
  recorded_at: ISODateTime;
  notes: string | null;
  items: DeliveryItem[];
  total_dispatched_kg: number;
  total_delivered_kg: number;
  total_accepted_kg: number;
  total_rejected_kg: number;
  total_shortage_kg: number;
  settlement_id: UUID | null;
}

/* ───────────────────────────── Settlement ────────────────────────── */

export interface FarmerPayout {
  id: UUID;
  settlement_id: UUID;
  farmer_id: UUID;
  farmer_name: string;
  accepted_kg: number;
  rejected_kg: number;
  gross_amount: number;
  transport_share: number;
  handling_share: number;
  commission_share: number;
  net_amount: number;
  net_per_kg: number;
  baseline_net_per_kg: number | null;
  uplift_per_kg: number | null;
  status: PayoutStatus;
  reference: string | null;
  paid_at: ISODateTime | null;
}

export interface PaymentRecord {
  id: UUID;
  amount: number;
  reference: string | null;
  paid_at: ISODateTime;
  recorded_by_name: string;
}

export interface Settlement {
  id: UUID;
  code: string;
  lot_id: UUID;
  lot_code: string;
  offer_id: UUID;
  buyer_id: UUID;
  buyer_name: string;
  crop_name: string;
  price_per_kg: number;
  total_accepted_kg: number;
  /** What the buyer owes: price × accepted kg. */
  gross_amount: number;
  transport_cost: number;
  handling_cost: number;
  commission_amount: number;
  net_to_farmers: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  due_date: ISODate;
  paid_at: ISODateTime | null;
  /** For farmers this contains only their own payout. */
  payouts: FarmerPayout[];
  payments: PaymentRecord[];
  created_at: ISODateTime;
}

export interface RecordPaymentRequest {
  amount: number;
  reference?: string | null;
  paid_at?: ISODateTime | null;
}

export interface MarkPayoutPaidRequest {
  reference?: string | null;
}

/* ───────────────────────────── Disputes ──────────────────────────── */

export interface Dispute {
  id: UUID;
  code: string;
  lot_id: UUID;
  lot_code: string;
  settlement_id: UUID | null;
  raised_by_id: UUID;
  raised_by_name: string;
  raised_by_role: Role;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  resolution: string | null;
  resolved_by_name: string | null;
  created_at: ISODateTime;
  resolved_at: ISODateTime | null;
}

export interface DisputeCreateRequest {
  lot_id: UUID;
  settlement_id?: UUID | null;
  category: DisputeCategory;
  description: string;
}

export interface DisputeUpdateRequest {
  status: 'under_review' | 'resolved' | 'rejected';
  resolution?: string | null;
}

/* ─────────────────────────── Notifications ───────────────────────── */

export interface Notification {
  id: UUID;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app path, e.g. "/app/farmer/offers". */
  link: string | null;
  read_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface UnreadCount {
  count: number;
}

/* ────────────────────────── Journey tracking ─────────────────────── */

export interface JourneyStep {
  step: number;
  key: JourneyKey;
  label: string;
  status: JourneyStepStatus;
  at: ISODateTime | null;
  detail: string | null;
}

/* ───────────────────────────── Dashboards ────────────────────────── */

export type ActionKind =
  | 'consent'
  | 'offer'
  | 'pickup'
  | 'payment'
  | 'deadline'
  | 'verification'
  | 'quote'
  | 'delivery'
  | 'dispute'
  | 'lot';

export interface ActionItem {
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  link: string;
  due_at: ISODateTime | null;
  priority: 'high' | 'normal';
}

export interface ActivityItem {
  id: string;
  title: string;
  description: string;
  at: ISODateTime;
  link: string | null;
  kind: NotificationType;
}

export interface PilotMetrics {
  /** Average farmer net ₹/kg above the baseline alternative across settled payouts. */
  net_uplift_per_kg: number | null;
  /** % of listed kg that ended in a settled sale. */
  completion_rate_pct: number | null;
  avg_hours_listing_to_buyer: number | null;
  transport_cost_per_kg: number | null;
  avg_payment_delay_days: number | null;
  rejection_rate_pct: number | null;
  failed_transactions: number;
  repeat_farmers_pct: number | null;
  repeat_buyers_pct: number | null;
}

export interface FarmerDashboard {
  stats: {
    active_harvests: number;
    listed_kg: number;
    open_offers: number;
    pending_consents: number;
    upcoming_pickups: number;
    season_net_earnings: number;
    avg_uplift_per_kg: number | null;
    pending_payments: number;
  };
  current_harvest: Harvest | null;
  selling_options: SellingOptions | null;
  action_items: ActionItem[];
  recent_activity: ActivityItem[];
}

export interface BuyerDashboard {
  stats: {
    open_demands: number;
    active_offers: number;
    orders_in_progress: number;
    kg_sourced: number;
    amount_due: number;
    avg_price_per_kg: number | null;
    on_time_delivery_pct: number | null;
  };
  verification_status: VerificationStatus;
  recommended_supply: SupplyItem[];
  action_items: ActionItem[];
  recent_activity: ActivityItem[];
}

export interface TransporterDashboard {
  stats: {
    open_requests: number;
    quotes_submitted: number;
    active_trips: number;
    completed_trips: number;
    kg_moved: number;
    earnings_total: number;
    avg_utilization_pct: number | null;
  };
  verification_status: VerificationStatus;
  open_requests: TransportRequest[];
  active_trips: TransportRequest[];
  action_items: ActionItem[];
  recent_activity: ActivityItem[];
}

export interface PipelineColumn {
  step: number;
  key: JourneyKey;
  label: string;
  lots: LotSummary[];
}

export interface CoordinatorDashboard {
  stats: {
    farmers: number;
    listed_kg: number;
    lots_forming: number;
    lots_active: number;
    offers_pending: number;
    deliveries_pending: number;
    settlements_pending_amount: number;
    open_disputes: number;
  };
  pipeline: PipelineColumn[];
  pilot_metrics: PilotMetrics;
  action_items: ActionItem[];
  recent_activity: ActivityItem[];
}

export interface AdminOverview {
  users_by_role: Record<Role, number>;
  pending_verifications: number;
  total_kg_traded: number;
  total_gmv: number;
  lots_by_status: Partial<Record<LotStatus, number>>;
  pilot_metrics: PilotMetrics;
}

/* ───────────────────────────── Earnings ──────────────────────────── */

export interface FarmerSale {
  payout_id: UUID;
  settlement_id: UUID;
  lot_id: UUID;
  lot_code: string;
  crop_name: string;
  buyer_name: string;
  accepted_kg: number;
  rejected_kg: number;
  price_per_kg: number;
  gross_amount: number;
  transport_share: number;
  handling_share: number;
  commission_share: number;
  net_amount: number;
  net_per_kg: number;
  baseline_net_per_kg: number | null;
  uplift_per_kg: number | null;
  status: PayoutStatus;
  settled_at: ISODateTime | null;
}

export interface MonthlyEarnings {
  /** 'YYYY-MM' */
  month: string;
  gross_amount: number;
  net_amount: number;
  baseline_net_amount: number;
  kg_sold: number;
}

export interface FarmerEarnings {
  totals: {
    gross_amount: number;
    total_deductions: number;
    net_amount: number;
    kg_sold: number;
    avg_net_per_kg: number | null;
    avg_uplift_per_kg: number | null;
    sales_count: number;
    pending_amount: number;
  };
  by_month: MonthlyEarnings[];
  sales: FarmerSale[];
}

/* ───────────────────────────── Insights ──────────────────────────── */

export interface CropBalance {
  crop_id: UUID;
  crop_name: string;
  listed_kg: number;
  demanded_kg: number;
  /** demanded_kg − listed_kg */
  gap_kg: number;
  avg_offer_price_per_kg: number | null;
  market_modal_price_per_kg: number | null;
  signal: 'surplus' | 'balanced' | 'shortage';
}

export interface SupplyForecastPoint {
  date: ISODate;
  crop_name: string;
  quantity_kg: number;
}

export interface SupplyDemandInsights {
  by_crop: CropBalance[];
  upcoming_supply: SupplyForecastPoint[];
  pilot_metrics: PilotMetrics;
  summary: AiText;
}

/* ─────────────────────────── Coordinator ─────────────────────────── */

export interface RegisterFarmerRequest {
  full_name: string;
  phone: string;
  email?: string | null;
  village: string;
  district: string;
  state: string;
  preferred_language: Language;
  latitude?: number | null;
  longitude?: number | null;
}

export interface RegisteredFarmer {
  user: User;
  /** Shown once to the coordinator so they can hand it to the farmer. */
  temporary_password: string;
}

export interface FarmerSummary {
  user: User;
  active_harvests: number;
  listed_kg: number;
  lifetime_net: number;
  last_activity_at: ISODateTime | null;
}

/* ─────────────────────────────── Admin ───────────────────────────── */

export interface VerifyUserRequest {
  status: 'verified' | 'rejected';
  note?: string | null;
}

export interface AuditEntry {
  id: UUID;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: ISODateTime;
}

/* ──────────────────────────────── AI ─────────────────────────────── */

export interface AiStatus {
  /** 'mock' = no API key configured; deterministic rule-based responses only. */
  mode: 'live' | 'mock';
  provider: 'deepseek';
  model: string;
  features: string[];
}

export interface AiText {
  text: string;
  source: AiSource;
  model: string | null;
  generated_at: ISODateTime;
  disclaimer: string;
}

export interface VoiceListingRequest {
  transcript: string;
  language: Language;
}

export interface HarvestDraft {
  crop_id: UUID | null;
  crop_name: string | null;
  variety: string | null;
  quantity_kg: number | null;
  grade: Grade | null;
  harvest_date: ISODate | null;
  available_from: ISODate | null;
  sell_by: ISODate | null;
  quality_notes: string | null;
  min_price_per_kg: number | null;
}

export interface VoiceDraft {
  transcript: string;
  language: Language;
  draft: HarvestDraft;
  /** Keys of HarvestDraft that still need the farmer's confirmation. */
  missing_fields: (keyof HarvestDraft)[];
  follow_up_question: string;
  confidence: number;
  source: AiSource;
}

export interface DealAdviceRequest {
  harvest_id: UUID;
}

export interface CounterSuggestion {
  offer_id: UUID;
  current_price_per_kg: number;
  suggested_price_per_kg: number;
  floor_price_per_kg: number | null;
  market_reference_per_kg: number | null;
  rationale: string;
  source: AiSource;
}

export interface DealAdvice {
  harvest_id: UUID;
  options: SellingOption[];
  recommended_option_id: string | null;
  explanation: AiText;
  counteroffer: CounterSuggestion | null;
}

export interface MatchExplanationRequest {
  proposal: MatchProposal;
}

/* ───────────────────────────── Public ────────────────────────────── */

export interface PublicStats {
  farmers: number;
  buyers: number;
  transporters: number;
  kg_traded: number;
  lots_completed: number;
  avg_uplift_per_kg: number | null;
  is_demo_data: boolean;
}

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  ai_mode: 'live' | 'mock';
  version: string;
}

export interface ContactRequest {
  name: string;
  email: string;
  organization?: string | null;
  role?: string | null;
  message: string;
}
