import type { MultiPolygon2D, OrientedRect, Point2D, Polygon2D, Ring2D } from './types';
import { bbox, pointInRing, pointStrictlyInRing, polygonArea, rectCorners } from './polygon';

/**
 * A planar region (polygons, possibly with holes) prepared for very many
 * repeated rectangle-containment queries.
 *
 * The layout search asks "does this panel fit?" tens of thousands of times
 * against one unchanging region, so the region is indexed once. Boundary edges
 * go into a uniform grid; a query only tests the edges in the cells the
 * candidate rectangle overlaps, which is O(1) for panel-sized rectangles
 * regardless of how complex the roof is.
 *
 * We do this ourselves rather than via JSTS `PreparedGeometry`: JSTS 2.12.1's
 * `PreparedPolygon` calls `super()` with no arguments and throws (see
 * docs/open-issues.md). Owning the hot path also lets us keep it allocation-light.
 */
export class Region {
  readonly polygons: MultiPolygon2D;
  readonly area: number;
  private readonly edgesX1: Float64Array;
  private readonly edgesY1: Float64Array;
  private readonly edgesX2: Float64Array;
  private readonly edgesY2: Float64Array;
  private readonly edgeCount: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  /** cellIndex -> edge indices overlapping that cell. */
  private readonly grid: Int32Array[];

  constructor(polygons: MultiPolygon2D, targetCell = 2) {
    this.polygons = polygons;
    this.area = polygons.reduce((s, p) => s + polygonArea(p), 0);

    const rings: Ring2D[] = [];
    for (const poly of polygons) {
      rings.push(poly.outer);
      for (const h of poly.holes) rings.push(h);
    }

    let n = 0;
    for (const r of rings) n += r.length;
    this.edgeCount = n;
    this.edgesX1 = new Float64Array(n);
    this.edgesY1 = new Float64Array(n);
    this.edgesX2 = new Float64Array(n);
    this.edgesY2 = new Float64Array(n);

    let k = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rings) {
      const len = r.length;
      for (let i = 0; i < len; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % len]!;
        this.edgesX1[k] = a.x;
        this.edgesY1[k] = a.y;
        this.edgesX2[k] = b.x;
        this.edgesY2[k] = b.y;
        k++;
        if (a.x < minX) minX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.x > maxX) maxX = a.x;
        if (a.y > maxY) maxY = a.y;
      }
    }

    if (n === 0) {
      this.minX = 0;
      this.minY = 0;
      this.cell = 1;
      this.cols = 1;
      this.rows = 1;
      this.grid = [new Int32Array(0)];
      return;
    }

    this.minX = minX;
    this.minY = minY;
    const w = Math.max(maxX - minX, 1e-6);
    const h = Math.max(maxY - minY, 1e-6);
    // Keep the grid between 1 and ~250k cells whatever the roof size.
    const cell = Math.max(targetCell, Math.sqrt((w * h) / 65536) || targetCell);
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(w / cell));
    this.rows = Math.max(1, Math.ceil(h / cell));

    const buckets: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    for (let e = 0; e < n; e++) {
      const c0 = this.colOf(Math.min(this.edgesX1[e]!, this.edgesX2[e]!));
      const c1 = this.colOf(Math.max(this.edgesX1[e]!, this.edgesX2[e]!));
      const r0 = this.rowOf(Math.min(this.edgesY1[e]!, this.edgesY2[e]!));
      const r1 = this.rowOf(Math.max(this.edgesY1[e]!, this.edgesY2[e]!));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) buckets[r * this.cols + c]!.push(e);
      }
    }
    this.grid = buckets.map((b) => Int32Array.from(b));
  }

  get isEmpty(): boolean {
    return this.polygons.length === 0 || this.area <= 0;
  }

  private colOf(x: number): number {
    const c = Math.floor((x - this.minX) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private rowOf(y: number): number {
    const r = Math.floor((y - this.minY) / this.cell);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  /**
   * True when the point lies inside the region. Boundary points count as
   * inside — including the boundary of a hole, since a panel may sit flush
   * against a skylight cut-out.
   */
  containsPoint(p: Point2D, epsilon = 1e-9): boolean {
    for (const poly of this.polygons) {
      if (!pointInRing(p, poly.outer, epsilon)) continue;
      let inHole = false;
      for (const h of poly.holes) {
        if (pointStrictlyInRing(p, h, epsilon)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }

  /**
   * Exact containment test for a convex quadrilateral.
   *
   * Three conditions together are necessary and sufficient:
   *  1. every corner lies in the region,
   *  2. no region boundary edge properly crosses a rectangle edge,
   *  3. no region boundary vertex lies strictly inside the rectangle
   *     (this is what catches a hole swallowed whole by the rectangle).
   */
  containsRect(corners: readonly Point2D[], epsilon = 1e-9): boolean {
    if (this.isEmpty || corners.length < 3) return false;

    for (const c of corners) {
      if (!this.containsPoint(c, epsilon)) return false;
    }

    const rb = bbox(corners);
    const c0 = this.colOf(rb.minX);
    const c1 = this.colOf(rb.maxX);
    const r0 = this.rowOf(rb.minY);
    const r1 = this.rowOf(rb.maxY);

    const m = corners.length;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const bucket = this.grid[r * this.cols + c];
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const e = bucket[bi]!;
          const ax = this.edgesX1[e]!;
          const ay = this.edgesY1[e]!;
          const bx = this.edgesX2[e]!;
          const by = this.edgesY2[e]!;

          // (3) region vertex strictly inside the rectangle.
          if (
            ax > rb.minX - epsilon &&
            ax < rb.maxX + epsilon &&
            ay > rb.minY - epsilon &&
            ay < rb.maxY + epsilon &&
            pointStrictlyInConvex({ x: ax, y: ay }, corners, epsilon)
          ) {
            return false;
          }

          // (2) proper crossing with any rectangle edge.
          for (let i = 0; i < m; i++) {
            const p = corners[i]!;
            const q = corners[(i + 1) % m]!;
            if (segmentsProperlyCross(ax, ay, bx, by, p.x, p.y, q.x, q.y, epsilon)) return false;
          }
        }
      }
    }
    return true;
  }

  containsOrientedRect(rect: OrientedRect, epsilon = 1e-9): boolean {
    return this.containsRect(rectCorners(rect), epsilon);
  }

  containsPolygon(poly: Polygon2D, epsilon = 1e-9): boolean {
    return poly.holes.length === 0 && this.containsRect(poly.outer, epsilon);
  }
}

/**
 * Proper crossing test: true only when the two open segments cross at an
 * interior point of both. Shared endpoints and collinear overlap are NOT
 * crossings — a panel edge lying exactly along a roof edge is legal.
 */
export function segmentsProperlyCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  epsilon = 1e-9,
): boolean {
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  // Scale the tolerance by segment length so `epsilon` stays a distance.
  const s1 = Math.hypot(bx - ax, by - ay) || 1;
  const s2 = Math.hypot(dx - cx, dy - cy) || 1;
  const e1 = epsilon * s1;
  const e2 = epsilon * s2;
  return (
    ((d1 > e1 && d2 < -e1) || (d1 < -e1 && d2 > e1)) &&
    ((d3 > e2 && d4 < -e2) || (d3 < -e2 && d4 > e2))
  );
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/** True when `p` is strictly inside a convex, counter-clockwise polygon. */
export function pointStrictlyInConvex(
  p: Point2D,
  convex: readonly Point2D[],
  epsilon = 1e-9,
): boolean {
  const n = convex.length;
  for (let i = 0; i < n; i++) {
    const a = convex[i]!;
    const b = convex[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (cross(a.x, a.y, b.x, b.y, p.x, p.y) <= epsilon * len) return false;
  }
  return true;
}

/**
 * Separating-axis overlap test for two oriented rectangles.
 * Touching edges do not count as overlap — panels may sit flush.
 */
export function orientedRectsOverlap(a: OrientedRect, b: OrientedRect, epsilon = 1e-9): boolean {
  // Cheap reject: bounding circles.
  const ra = Math.hypot(a.width, a.height) / 2;
  const rb = Math.hypot(b.width, b.height) / 2;
  if (Math.hypot(a.cx - b.cx, a.cy - b.cy) > ra + rb) return false;

  const ca = rectCorners(a);
  const cb = rectCorners(b);
  const axes = [a.rotation, a.rotation + Math.PI / 2, b.rotation, b.rotation + Math.PI / 2];
  for (const angle of axes) {
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    let aMin = Infinity;
    let aMax = -Infinity;
    let bMin = Infinity;
    let bMax = -Infinity;
    for (const p of ca) {
      const d = p.x * nx + p.y * ny;
      if (d < aMin) aMin = d;
      if (d > aMax) aMax = d;
    }
    for (const p of cb) {
      const d = p.x * nx + p.y * ny;
      if (d < bMin) bMin = d;
      if (d > bMax) bMax = d;
    }
    if (aMax <= bMin + epsilon || bMax <= aMin + epsilon) return false;
  }
  return true;
}
