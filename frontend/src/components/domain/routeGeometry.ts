/**
 * Pure geometry for `RouteMap`: an equirectangular projection fitted to the route's bounds (north up,
 * equal kilometres in both directions), a "nice" scale bar and greedy label placement.
 * No map library and no network tiles — every output is deterministic for SSR.
 */

/** `[latitude, longitude]` in degrees, the order used by `TransportPlan.route`. */
export type LatLng = readonly [number, number];
export type ScreenPoint = readonly [number, number];

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitOptions {
  /** Viewport width in px. */
  width: number;
  /** Margin kept free around the outermost points, px — one value or per side. */
  padding?: number | Insets;
  /** Height bounds as a fraction of the width; the route's own shape picks a value in between. */
  minAspect?: number;
  maxAspect?: number;
  /** Smallest span shown in each direction, km — keeps a single stop from filling the map. */
  minSpanKm?: number;
}

export interface MapProjection {
  width: number;
  height: number;
  /** Pixels per kilometre (identical horizontally and vertically). */
  pxPerKm: number;
  project: (point: LatLng) => ScreenPoint;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Fits every point into a `width`-wide viewport. Longitudes are scaled by cos(mean latitude), so a
 * kilometre is the same length on both axes; the result is centred inside the padding.
 */
export function fitProjection(
  points: readonly LatLng[],
  { width, padding = 40, minAspect = 0.5, maxAspect = 0.8, minSpanKm = 3 }: FitOptions,
): MapProjection {
  const inset: Insets = typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : padding;
  const safeWidth = Math.max(width, inset.left + inset.right + 1);
  if (points.length === 0) {
    const height = Math.round(safeWidth * maxAspect);
    return { width: safeWidth, height, pxPerKm: 1, project: () => [safeWidth / 2, height / 2] };
  }

  const meanLat = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const toKm = ([lat, lng]: LatLng): ScreenPoint => [lng * cosLat * KM_PER_DEGREE, -lat * KM_PER_DEGREE];

  const projected = points.map(toKm);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, minSpanKm);
  const spanY = Math.max(maxY - minY, minSpanKm);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  const aspect = Math.min(maxAspect, Math.max(minAspect, spanY / spanX));
  const height = Math.round(safeWidth * aspect);
  const innerWidth = safeWidth - inset.left - inset.right;
  const innerHeight = Math.max(height - inset.top - inset.bottom, 1);
  const pxPerKm = Math.min(innerWidth / spanX, innerHeight / spanY);
  const originX = inset.left + innerWidth / 2;
  const originY = inset.top + innerHeight / 2;

  return {
    width: safeWidth,
    height,
    pxPerKm,
    project: (point) => {
      const [x, y] = toKm(point);
      return [round1(originX + (x - centreX) * pxPerKm), round1(originY + (y - centreY) * pxPerKm)];
    },
  };
}

const NICE_KM = [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500] as const;

/** The longest round distance whose bar fits in `maxPx` (falls back to the shortest step). */
export function niceScale(pxPerKm: number, maxPx: number): { km: number; px: number } {
  let chosen: number = NICE_KM[0];
  for (const km of NICE_KM) {
    if (km * pxPerKm <= maxPx) chosen = km;
  }
  return { km: chosen, px: round1(chosen * pxPerKm) };
}

/** "M x y L x y …" through the given screen points. */
export function polylinePath(points: readonly ScreenPoint[]): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
}

export interface LabelRequest {
  /** Anchor (the pin tip) in screen px. */
  anchor: ScreenPoint;
  /** Estimated label box size in px. */
  width: number;
  height: number;
}

export interface LabelPlacement {
  /** Top-left corner of the label box. */
  x: number;
  y: number;
  side: 'left' | 'right';
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Greedy label placement: beside its pin (right unless that would leave the viewport), shifted down
 * then up in steps until it no longer overlaps an earlier label or pin. Labels stay inside the viewport.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  { width, height, gap = 14, pinRadius = 12 }: { width: number; height: number; gap?: number; pinRadius?: number },
): LabelPlacement[] {
  const pins: Box[] = requests.map(({ anchor: [x, y] }) => ({
    x: x - pinRadius,
    y: y - pinRadius * 2.4,
    width: pinRadius * 2,
    height: pinRadius * 2.4,
  }));
  const placed: Box[] = [];
  const clampY = (value: number, boxHeight: number) => Math.min(Math.max(value, 2), Math.max(height - boxHeight - 2, 2));
  const offsets = [0, 1, -1, 2, -2, 3, -3];

  return requests.map((request) => {
    const [ax, ay] = request.anchor;
    const preferRight = ax + gap + request.width <= width - 2;
    const sides: ('left' | 'right')[] = preferRight ? ['right', 'left'] : ['left', 'right'];
    const centreY = ay - pinRadius * 1.4 - request.height / 2;

    let best: (Box & { side: 'left' | 'right' }) | null = null;
    search: for (const side of sides) {
      const x = side === 'right' ? ax + gap : ax - gap - request.width;
      const clampedX = Math.min(Math.max(x, 2), Math.max(width - request.width - 2, 2));
      for (const step of offsets) {
        const box = {
          x: clampedX,
          y: clampY(centreY + step * (request.height + 4), request.height),
          width: request.width,
          height: request.height,
        };
        const collides = placed.some((other) => overlaps(box, other)) || pins.some((pin) => overlaps(box, pin));
        if (!collides) {
          best = { ...box, side };
          break search;
        }
        best ??= { ...box, side };
      }
    }

    const result = best ?? { x: ax + gap, y: clampY(centreY, request.height), width: request.width, height: request.height, side: 'right' as const };
    placed.push(result);
    return { x: round1(result.x), y: round1(result.y), side: result.side };
  });
}
