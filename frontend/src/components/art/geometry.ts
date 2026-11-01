/** Small deterministic geometry helpers for the SVG art (identical output on server and client). */

export type Point = readonly [number, number];

const round = (value: number) => Math.round(value * 10) / 10;

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
export function smoothPath(points: readonly Point[], closed = false): string {
  const count = points.length;
  if (count < 2) return '';
  const at = (index: number): Point => {
    if (closed) return points[(index + count) % count];
    return points[Math.min(Math.max(index, 0), count - 1)];
  };
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  const segments = closed ? count : count - 1;
  for (let i = 0; i < segments; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(p2[0])} ${round(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Seeded pseudo-random generator (mulberry32) so artwork is stable across renders. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { round };
