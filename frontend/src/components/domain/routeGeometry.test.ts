import { describe, expect, it } from 'vitest';

import { fitProjection, niceScale, placeLabels, polylinePath, type LatLng } from './routeGeometry';

/* Madanapalle tomato cluster: three farms and the market yard. */
const FARMS: LatLng[] = [
  [13.5503, 78.5026],
  [13.5821, 78.4512],
  [13.6104, 78.5309],
];
const MARKET: LatLng = [13.5562, 78.5011];

describe('fitProjection', () => {
  it('keeps every point inside the padded viewport', () => {
    const padding = 40;
    const projection = fitProjection([...FARMS, MARKET], { width: 720, padding });
    for (const point of [...FARMS, MARKET]) {
      const [x, y] = projection.project(point);
      expect(x).toBeGreaterThanOrEqual(padding - 0.1);
      expect(x).toBeLessThanOrEqual(projection.width - padding + 0.1);
      expect(y).toBeGreaterThanOrEqual(padding - 0.1);
      expect(y).toBeLessThanOrEqual(projection.height - padding + 0.1);
    }
  });

  it('puts north at the top and east to the right', () => {
    const projection = fitProjection(FARMS, { width: 600 });
    const [, southY] = projection.project([13.5503, 78.5026]);
    const [, northY] = projection.project([13.6104, 78.5309]);
    const [westX] = projection.project([13.5821, 78.4512]);
    const [eastX] = projection.project([13.6104, 78.5309]);
    expect(northY).toBeLessThan(southY);
    expect(westX).toBeLessThan(eastX);
  });

  it('draws a kilometre the same length on both axes', () => {
    const origin: LatLng = [13.55, 78.5];
    const kmInLat = 1 / 111.195;
    const kmInLng = kmInLat / Math.cos((13.555 * Math.PI) / 180);
    const projection = fitProjection([origin, [13.56, 78.51]], { width: 800, padding: 20, minSpanKm: 0.1 });
    const [x0, y0] = projection.project(origin);
    const [, yNorth] = projection.project([origin[0] + kmInLat, origin[1]]);
    const [xEast] = projection.project([origin[0], origin[1] + kmInLng]);
    expect(Math.abs(y0 - yNorth)).toBeCloseTo(projection.pxPerKm, 0);
    expect(Math.abs(xEast - x0)).toBeCloseTo(projection.pxPerKm, 0);
  });

  it('centres a single point and keeps a sensible minimum span', () => {
    const projection = fitProjection([MARKET], { width: 500, padding: 50, minSpanKm: 4 });
    expect(projection.project(MARKET)).toEqual([250, projection.height / 2]);
    expect(projection.pxPerKm).toBeLessThanOrEqual((500 - 100) / 4);
  });

  it('clamps the height to the allowed aspect range', () => {
    const northSouth = fitProjection(
      [
        [13.0, 78.5],
        [14.0, 78.5],
      ],
      { width: 400, maxAspect: 0.8 },
    );
    expect(northSouth.height).toBe(320);
    const eastWest = fitProjection(
      [
        [13.5, 78.0],
        [13.5, 79.0],
      ],
      { width: 400, minAspect: 0.5 },
    );
    expect(eastWest.height).toBe(200);
  });

  it('honours per-side padding (e.g. a strip reserved for the scale bar)', () => {
    const inset = { top: 20, right: 20, bottom: 60, left: 20 };
    const projection = fitProjection([...FARMS, MARKET], { width: 600, padding: inset });
    for (const point of [...FARMS, MARKET]) {
      const [, y] = projection.project(point);
      expect(y).toBeLessThanOrEqual(projection.height - inset.bottom + 0.1);
      expect(y).toBeGreaterThanOrEqual(inset.top - 0.1);
    }
  });

  it('returns a centred, empty viewport without points', () => {
    const projection = fitProjection([], { width: 300, maxAspect: 0.6 });
    expect(projection.height).toBe(180);
    expect(projection.project(MARKET)).toEqual([150, 90]);
  });
});

describe('niceScale', () => {
  it('picks the longest round distance that fits', () => {
    expect(niceScale(10, 120)).toEqual({ km: 10, px: 100 });
    expect(niceScale(3, 140)).toEqual({ km: 25, px: 75 });
    expect(niceScale(200, 140)).toEqual({ km: 0.5, px: 100 });
  });

  it('falls back to the shortest step when nothing fits', () => {
    expect(niceScale(2000, 100).km).toBe(0.25);
  });
});

describe('polylinePath', () => {
  it('moves to the first point and draws lines through the rest', () => {
    expect(
      polylinePath([
        [0, 0],
        [10, 5],
        [20, 0],
      ]),
    ).toBe('M0 0 L10 5 L20 0');
    expect(polylinePath([])).toBe('');
  });
});

describe('placeLabels', () => {
  const box = (placement: { x: number; y: number }, width: number, height: number) => ({ ...placement, width, height });
  const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('keeps labels inside the viewport and flips them left near the right edge', () => {
    const [left, right] = placeLabels(
      [
        { anchor: [60, 100], width: 120, height: 34 },
        { anchor: [580, 100], width: 120, height: 34 },
      ],
      { width: 640, height: 300 },
    );
    expect(left!.side).toBe('right');
    expect(right!.side).toBe('left');
    expect(right!.x + 120).toBeLessThanOrEqual(640);
  });

  it('separates labels of pins that sit close together', () => {
    const requests = [
      { anchor: [200, 150] as const, width: 130, height: 34 },
      { anchor: [206, 158] as const, width: 130, height: 34 },
      { anchor: [212, 150] as const, width: 130, height: 34 },
    ];
    const placements = placeLabels(requests, { width: 640, height: 400 });
    const boxes = placements.map((placement, index) => box(placement, requests[index]!.width, requests[index]!.height));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
      }
    }
  });
});
