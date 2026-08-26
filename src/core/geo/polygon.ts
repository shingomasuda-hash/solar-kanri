import type { BBox2D, OrientedRect, Point2D, Polygon2D, Ring2D } from './types';

/** Signed area of a ring (positive = counter-clockwise). Units: m². */
export function signedArea(ring: Ring2D): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Absolute area of a ring. Units: m². */
export function ringArea(ring: Ring2D): number {
  return Math.abs(signedArea(ring));
}

/** Area of a polygon with holes subtracted. Units: m². */
export function polygonArea(poly: Polygon2D): number {
  let a = ringArea(poly.outer);
  for (const h of poly.holes) a -= ringArea(h);
  return Math.max(0, a);
}

export function isCounterClockwise(ring: Ring2D): boolean {
  return signedArea(ring) > 0;
}

/** Return the ring wound counter-clockwise (does not mutate the input). */
export function ensureCCW(ring: Ring2D): Point2D[] {
  return isCounterClockwise(ring) ? [...ring] : [...ring].reverse();
}

export function centroid(ring: Ring2D): Point2D {
  const n = ring.length;
  if (n === 0) throw new RangeError('centroid of empty ring');
  if (n < 3) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-12) {
    // Degenerate (zero-area) ring: fall back to the vertex mean.
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

export function bbox(ring: Ring2D): BBox2D {
  if (ring.length === 0) throw new RangeError('bbox of empty ring');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOfPolygons(polys: readonly Polygon2D[]): BBox2D {
  const rings = polys.map((p) => p.outer).flat();
  return bbox(rings);
}

export function rotatePoint(p: Point2D, angleRad: number, about: Point2D): Point2D {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

export function rotateRing(ring: Ring2D, angleRad: number, about: Point2D): Point2D[] {
  return ring.map((p) => rotatePoint(p, angleRad, about));
}

export function translateRing(ring: Ring2D, dx: number, dy: number): Point2D[] {
  return ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Perimeter length of a closed ring. Units: m. */
export function perimeter(ring: Ring2D): number {
  const n = ring.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export interface Edge {
  readonly a: Point2D;
  readonly b: Point2D;
  readonly length: number;
  /** Direction of the edge, radians in [0, π) (undirected). */
  readonly angle: number;
}

export function edges(ring: Ring2D): Edge[] {
  const n = ring.length;
  const out: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    let angle = Math.atan2(dy, dx);
    // Collapse to an undirected orientation in [0, π).
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle -= Math.PI;
    out.push({ a, b, length, angle });
  }
  return out;
}

/**
 * Candidate layout angles derived from the polygon's own edges, weighted by
 * edge length. Longest edges first — a roof's dominant edge is nearly always
 * the direction installers actually align rows to.
 *
 * @param tolerance angular bucket width in radians (edges within this are merged)
 */
export function dominantEdgeAngles(ring: Ring2D, tolerance = 2 * (Math.PI / 180)): number[] {
  const buckets: { angle: number; weight: number }[] = [];
  for (const e of edges(ring)) {
    const found = buckets.find((b) => angularDistance(b.angle, e.angle) <= tolerance);
    if (found) {
      // Length-weighted mean keeps the bucket centred on the dominant edge.
      const total = found.weight + e.length;
      found.angle = found.angle + shortestSignedDelta(found.angle, e.angle) * (e.length / total);
      found.weight = total;
    } else {
      buckets.push({ angle: e.angle, weight: e.length });
    }
  }
  buckets.sort((p, q) => q.weight - p.weight);
  return buckets.map((b) => normalizeHalfTurn(b.angle));
}

/** Wrap an undirected angle into [0, π). */
export function normalizeHalfTurn(angle: number): number {
  const m = angle % Math.PI;
  return m < 0 ? m + Math.PI : m;
}

/** Smallest absolute difference between two undirected angles (mod π). */
export function angularDistance(a: number, b: number): number {
  return Math.abs(shortestSignedDelta(a, b));
}

function shortestSignedDelta(from: number, to: number): number {
  let d = (to - from) % Math.PI;
  if (d > Math.PI / 2) d -= Math.PI;
  if (d < -Math.PI / 2) d += Math.PI;
  return d;
}

/** Corner vertices of an oriented rectangle, counter-clockwise. */
export function rectCorners(rect: OrientedRect): Point2D[] {
  const hw = rect.width / 2;
  const hh = rect.height / 2;
  const c = Math.cos(rect.rotation);
  const s = Math.sin(rect.rotation);
  const local: readonly (readonly [number, number])[] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([lx, ly]) => ({
    x: rect.cx + lx * c - ly * s,
    y: rect.cy + lx * s + ly * c,
  }));
}

export function rectToPolygon(rect: OrientedRect): Polygon2D {
  return { outer: rectCorners(rect), holes: [] };
}

export function polygon(outer: Ring2D, holes: readonly Ring2D[] = []): Polygon2D {
  if (outer.length < 3) {
    throw new RangeError(`Polygon outer ring needs >= 3 vertices, got ${outer.length}`);
  }
  return { outer: [...outer], holes: holes.map((h) => [...h]) };
}

/** Ray-casting point-in-ring test. Points exactly on an edge are "inside". */
export function pointInRing(p: Point2D, ring: Ring2D, epsilon = 1e-9): boolean {
  const n = ring.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (pointOnSegment(p, a, b, epsilon)) return true;
    const intersects =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when `p` lies on the ring's boundary (within `epsilon` metres). */
export function pointOnRingBoundary(p: Point2D, ring: Ring2D, epsilon = 1e-9): boolean {
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (pointOnSegment(p, ring[i]!, ring[j]!, epsilon)) return true;
  }
  return false;
}

/** True when `p` is inside the ring and not on its boundary. */
export function pointStrictlyInRing(p: Point2D, ring: Ring2D, epsilon = 1e-9): boolean {
  return !pointOnRingBoundary(p, ring, epsilon) && pointInRing(p, ring, epsilon);
}

/**
 * Point-in-polygon with holes. Boundary points — of the outer ring AND of any
 * hole — count as inside: a panel edge flush against a skylight is legal, so
 * the hole's own boundary must belong to the usable region.
 */
export function pointInPolygon(p: Point2D, poly: Polygon2D, epsilon = 1e-9): boolean {
  if (!pointInRing(p, poly.outer, epsilon)) return false;
  for (const hole of poly.holes) {
    if (pointStrictlyInRing(p, hole, epsilon)) return false;
  }
  return true;
}

function pointOnSegment(p: Point2D, a: Point2D, b: Point2D, epsilon: number): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < epsilon) return Math.hypot(p.x - a.x, p.y - a.y) <= epsilon;
  if (Math.abs(cross) / len > epsilon) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= -epsilon && dot <= len * len + epsilon;
}
