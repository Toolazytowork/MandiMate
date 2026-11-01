/**
 * Field reference data for the coordinator cockpit: the Madanapalle pilot cluster's collection
 * points and villages (Annamayya and Chittoor districts, Andhra Pradesh). Coordinates match the demo
 * seed so presets line up with seeded farms.
 */
import type { Grade, LotStatus } from '@/types/api';

export const STATE_AP = 'Andhra Pradesh';

export interface PlacePreset {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  district: string;
  state: string;
  kind: 'collection_point' | 'village';
}

export const COLLECTION_POINTS: readonly PlacePreset[] = [
  { id: 'madanapalle_yard', name: 'Madanapalle Market Yard', latitude: 13.556, longitude: 78.501, district: 'Annamayya', state: STATE_AP, kind: 'collection_point' },
  { id: 'kurabalakota_shed', name: 'Kurabalakota Collection Shed', latitude: 13.6512, longitude: 78.4795, district: 'Annamayya', state: STATE_AP, kind: 'collection_point' },
  { id: 'thamballapalle_shed', name: 'Thamballapalle Collection Shed', latitude: 13.716, longitude: 78.385, district: 'Annamayya', state: STATE_AP, kind: 'collection_point' },
  { id: 'punganur_centre', name: 'Punganur FPO Collection Centre', latitude: 13.3665, longitude: 78.5745, district: 'Chittoor', state: STATE_AP, kind: 'collection_point' },
  { id: 'ramasamudram_cross', name: 'Ramasamudram Cross Collection Point', latitude: 13.401, longitude: 78.4225, district: 'Annamayya', state: STATE_AP, kind: 'collection_point' },
];

export const VILLAGES: readonly PlacePreset[] = [
  { id: 'madanapalle', name: 'Madanapalle', latitude: 13.5503, longitude: 78.5029, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'punganur', name: 'Punganur', latitude: 13.365, longitude: 78.573, district: 'Chittoor', state: STATE_AP, kind: 'village' },
  { id: 'palamaner', name: 'Palamaner', latitude: 13.2, longitude: 78.75, district: 'Chittoor', state: STATE_AP, kind: 'village' },
  { id: 'b_kothakota', name: 'B. Kothakota', latitude: 13.6575, longitude: 78.2697, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'thamballapalle', name: 'Thamballapalle', latitude: 13.7167, longitude: 78.3833, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'kurabalakota', name: 'Kurabalakota', latitude: 13.65, longitude: 78.48, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'nimmanapalle', name: 'Nimmanapalle', latitude: 13.6, longitude: 78.63, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'ramasamudram', name: 'Ramasamudram', latitude: 13.4, longitude: 78.42, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'peddamandyam', name: 'Peddamandyam', latitude: 13.78, longitude: 78.52, district: 'Annamayya', state: STATE_AP, kind: 'village' },
  { id: 'mulakalacheruvu', name: 'Mulakalacheruvu', latitude: 13.8833, longitude: 78.4167, district: 'Annamayya', state: STATE_AP, kind: 'village' },
];

export const PLACE_PRESETS: readonly PlacePreset[] = [...COLLECTION_POINTS, ...VILLAGES];

export const MATCH_GRADES: readonly Exclude<Grade, 'ungraded'>[] = ['A', 'B', 'C'];

export const DEFAULT_RADIUS_KM = 40;
export const MIN_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 100;

/** Lots a coordinator may still open for offers (DOMAIN_RULES §2). */
export const OPENABLE_LOT_STATUSES: ReadonlySet<LotStatus> = new Set(['forming', 'awaiting_consent']);
/** Lots a coordinator may cancel. */
export const CANCELLABLE_LOT_STATUSES: ReadonlySet<LotStatus> = new Set([
  'forming',
  'awaiting_consent',
  'open_for_offers',
  'offer_accepted',
]);
/** Delivery can be recorded once a deal is agreed and before it is delivered. */
export const DELIVERABLE_LOT_STATUSES: ReadonlySet<LotStatus> = new Set(['offer_accepted', 'transport_booked', 'in_transit']);

export const LOT_STATUSES: readonly LotStatus[] = [
  'forming',
  'awaiting_consent',
  'open_for_offers',
  'offer_accepted',
  'transport_booked',
  'in_transit',
  'delivered',
  'settled',
  'cancelled',
];
