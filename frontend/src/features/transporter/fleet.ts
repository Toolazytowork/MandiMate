/**
 * Vehicle classes and fare arithmetic for the transporter workspace. The class table mirrors
 * `VEHICLE_CLASSES` in backend/app/services/pricing.py (docs/DOMAIN_RULES.md §3) so quote suggestions
 * and fleet defaults match what MandiMate itself estimates.
 */
import type { TransportPlan, TransportRequest, Vehicle, VehicleType } from '@/types/api';

export interface VehicleClass {
  capacityKg: number;
  baseCharge: number;
  perKm: number;
  refrigerated: boolean;
}

export const VEHICLE_TYPES: readonly VehicleType[] = ['mini_truck', 'pickup', 'light_truck', 'medium_truck', 'reefer_truck'];

export const VEHICLE_CLASSES: Record<VehicleType, VehicleClass> = {
  mini_truck: { capacityKg: 750, baseCharge: 600, perKm: 18, refrigerated: false },
  pickup: { capacityKg: 1500, baseCharge: 900, perKm: 24, refrigerated: false },
  light_truck: { capacityKg: 3500, baseCharge: 1500, perKm: 32, refrigerated: false },
  medium_truck: { capacityKg: 9000, baseCharge: 2500, perKm: 45, refrigerated: false },
  reefer_truck: { capacityKg: 5000, baseCharge: 3500, perKm: 55, refrigerated: true },
};

/** Backend limits for a registered vehicle. */
export const VEHICLE_CAPACITY_MIN_KG = 100;
export const VEHICLE_CAPACITY_MAX_KG = 40_000;
/** A pickup may record up to 5 % more than planned (scale differences at the farm gate). */
export const PICKUP_TOLERANCE = 1.05;
/** Distance used to show a comparable "sample fare" on every vehicle card. */
export const SAMPLE_TRIP_KM = 40;

export function tripsNeeded(loadKg: number, capacityKg: number): number {
  if (!(capacityKg > 0) || !(loadKg > 0)) return 1;
  return Math.max(1, Math.ceil(loadKg / capacityKg));
}

/** Load as a share of the capacity across every trip it takes. */
export function utilisationPct(loadKg: number, capacityKg: number): number {
  if (!(capacityKg > 0) || !(loadKg > 0)) return 0;
  return (loadKg / (capacityKg * tripsNeeded(loadKg, capacityKg))) * 100;
}

/** `trips × (base + per_km × distance)`, rounded to the rupee. */
export function fareFor(rates: { baseCharge: number; perKm: number }, distanceKm: number, trips = 1): number {
  return Math.round(trips * (rates.baseCharge + rates.perKm * Math.max(0, distanceKm)));
}

export function vehicleRates(vehicle: Pick<Vehicle, 'base_charge' | 'per_km_rate'>): { baseCharge: number; perKm: number } {
  return { baseCharge: vehicle.base_charge, perKm: vehicle.per_km_rate };
}

export function isRefrigerated(vehicle: Pick<Vehicle, 'vehicle_type' | 'has_refrigeration'>): boolean {
  return vehicle.has_refrigeration || vehicle.vehicle_type === 'reefer_truck';
}

/** True when one active vehicle can carry the whole load in a single run (and keep it cold if needed). */
export function fleetFits(vehicles: readonly Vehicle[] | undefined, request: Pick<TransportRequest, 'total_quantity_kg' | 'requires_refrigeration'>): boolean {
  if (!vehicles) return false;
  return vehicles.some(
    (vehicle) =>
      vehicle.is_active &&
      vehicle.capacity_kg >= request.total_quantity_kg &&
      (!request.requires_refrigeration || isRefrigerated(vehicle)),
  );
}

/** A rough driving time for the hint under the ETA field: 28 km/h on rural roads plus 25 min a stop. */
export function suggestedEtaHours(distanceKm: number, stops: number): number {
  const hours = Math.max(0, distanceKm) / 28 + Math.max(1, stops) * (25 / 60);
  return Math.max(1, Math.round(hours * 2) / 2);
}

/**
 * A `TransportPlan` view of a request so the shared `TransportPlanSummary` (gauge, facts, route)
 * can draw it: the suggested class's capacity, trips and utilisation, and the stops in order.
 */
export function planFromRequest(request: TransportRequest): TransportPlan {
  const vehicleClass = VEHICLE_CLASSES[request.suggested_vehicle_type];
  const trips = tripsNeeded(request.total_quantity_kg, vehicleClass.capacityKg);
  const ordered = [...request.stops].sort((a, b) => a.sequence - b.sequence);
  return {
    lot_id: request.lot_id,
    stops: ordered,
    destination_name: request.destination_name,
    destination_latitude: request.destination_latitude,
    destination_longitude: request.destination_longitude,
    total_distance_km: request.estimated_distance_km,
    suggested_vehicle_type: request.suggested_vehicle_type,
    vehicle_capacity_kg: vehicleClass.capacityKg,
    trips_needed: trips,
    utilization_pct: utilisationPct(request.total_quantity_kg, vehicleClass.capacityKg),
    estimated_cost: request.estimated_cost,
    cost_per_kg: request.total_quantity_kg > 0 ? request.estimated_cost / request.total_quantity_kg : 0,
    route: [
      ...ordered.map((stop): [number, number] => [stop.latitude, stop.longitude]),
      [request.destination_latitude, request.destination_longitude],
    ],
  };
}

/** Google Maps driving directions to a point — handy on the road, opens the phone's maps app. */
export function directionsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude.toFixed(5)},${longitude.toFixed(5)}&travelmode=driving`;
}
