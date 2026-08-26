import { describe, expect, it } from 'vitest';
import {
  bbox,
  centroid,
  dominantEdgeAngles,
  edges,
  ensureCCW,
  isCounterClockwise,
  perimeter,
  pointInPolygon,
  pointInRing,
  polygon,
  polygonArea,
  rectCorners,
  ringArea,
  rotateRing,
  signedArea,
  translateRing,
  normalizeHalfTurn,
  angularDistance,
} from '@core/geo/polygon';
import type { Point2D, Ring2D } from '@core/geo/types';

const SQUARE: Ring2D = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('area', () => {
  it('computes signed area with CCW positive', () => {
    expect(signedArea(SQUARE)).toBeCloseTo(100, 9);
    expect(signedArea([...SQUARE].reverse())).toBeCloseTo(-100, 9);
    expect(ringArea([...SQUARE].reverse())).toBeCloseTo(100, 9);
  });

  it('returns zero for degenerate rings', () => {
    expect(signedArea([])).toBe(0);
    expect(
      signedArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0);
  });

  it('subtracts holes', () => {
    const withHole = polygon(SQUARE, [
      [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 },
      ],
    ]);
    expect(polygonArea(withHole)).toBeCloseTo(96, 9);
  });

  it('never reports negative area', () => {
    const overCut = polygon(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      [SQUARE],
    );
    expect(polygonArea(overCut)).toBe(0);
  });

  it('computes the area of a triangle', () => {
    expect(
      ringArea([
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 0, y: 4 },
      ]),
    ).toBeCloseTo(12, 9);
  });
});

describe('winding', () => {
  it('detects and normalises orientation', () => {
    expect(isCounterClockwise(SQUARE)).toBe(true);
    const cw = [...SQUARE].reverse();
    expect(isCounterClockwise(cw)).toBe(false);
    expect(isCounterClockwise(ensureCCW(cw))).toBe(true);
    expect(ensureCCW(SQUARE)).toEqual([...SQUARE]);
  });
});

describe('centroid', () => {
  it('finds the centre of a square', () => {
    const c = centroid(SQUARE);
    expect(c.x).toBeCloseTo(5, 9);
    expect(c.y).toBeCloseTo(5, 9);
  });

  it('is invariant to winding order', () => {
    const a = centroid(SQUARE);
    const b = centroid([...SQUARE].reverse());
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });

  it('falls back to the vertex mean for zero-area rings', () => {
    const c = centroid([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(c.x).toBeCloseTo(2, 9);
    expect(c.y).toBeCloseTo(0, 9);
  });

  it('handles a two-point ring', () => {
    const c = centroid([
      { x: 0, y: 0 },
      { x: 4, y: 2 },
    ]);
    expect(c).toEqual({ x: 2, y: 1 });
  });

  it('throws on an empty ring', () => {
    expect(() => centroid([])).toThrow(RangeError);
    expect(() => bbox([])).toThrow(RangeError);
  });
});

describe('bbox / perimeter', () => {
  it('bounds a square', () => {
    expect(bbox(SQUARE)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('measures perimeter around a closed ring', () => {
    expect(perimeter(SQUARE)).toBeCloseTo(40, 9);
  });
});

describe('transforms', () => {
  it('rotation preserves area', () => {
    const rotated = rotateRing(SQUARE, Math.PI / 7, { x: 3, y: -4 });
    expect(ringArea(rotated)).toBeCloseTo(100, 9);
  });

  it('rotating by 90 degrees about the origin maps (1,0) to (0,1)', () => {
    const r = rotateRing([{ x: 1, y: 0 }], Math.PI / 2, { x: 0, y: 0 })[0]!;
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
  });

  it('translation preserves area and shifts the bbox', () => {
    const t = translateRing(SQUARE, 5, -3);
    expect(ringArea(t)).toBeCloseTo(100, 9);
    expect(bbox(t)).toEqual({ minX: 5, minY: -3, maxX: 15, maxY: 7 });
  });
});

describe('edges and dominant angles', () => {
  it('drops zero-length edges', () => {
    const e = edges([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ]);
    expect(e).toHaveLength(3);
  });

  it('reports axis-aligned angles for an axis-aligned square', () => {
    const angles = dominantEdgeAngles(SQUARE);
    expect(angles).toHaveLength(2);
    for (const a of angles) {
      const nearAxis = Math.min(angularDistance(a, 0), angularDistance(a, Math.PI / 2));
      expect(nearAxis).toBeLessThan(1e-9);
    }
  });

  it('ranks the longest edge direction first', () => {
    // 30 m x 5 m rectangle: the long edges run along x.
    const rect: Ring2D = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 5 },
      { x: 0, y: 5 },
    ];
    expect(angularDistance(dominantEdgeAngles(rect)[0]!, 0)).toBeLessThan(1e-9);
  });

  it('recovers the tilt of a rotated rectangle', () => {
    const theta = 0.4;
    const rotated = rotateRing(SQUARE, theta, { x: 0, y: 0 });
    const top = dominantEdgeAngles(rotated)[0]!;
    expect(angularDistance(top, theta)).toBeLessThan(1e-6);
  });

  it('normalises undirected angles into [0, pi)', () => {
    expect(normalizeHalfTurn(Math.PI)).toBeCloseTo(0, 12);
    expect(normalizeHalfTurn(-Math.PI / 4)).toBeCloseTo((3 * Math.PI) / 4, 12);
    expect(angularDistance(0.05, Math.PI - 0.05)).toBeCloseTo(0.1, 12);
  });
});

describe('point in polygon', () => {
  const withHole = polygon(SQUARE, [
    [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ],
  ]);

  it('classifies interior, exterior and hole points', () => {
    expect(pointInPolygon({ x: 1, y: 1 }, withHole)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 5 }, withHole)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 5 }, withHole)).toBe(false);
  });

  it('treats boundary points as inside', () => {
    expect(pointInRing({ x: 0, y: 5 }, SQUARE)).toBe(true);
    expect(pointInRing({ x: 10, y: 10 }, SQUARE)).toBe(true);
    expect(pointInRing({ x: 5, y: 0 }, SQUARE)).toBe(true);
  });
});

describe('rectCorners', () => {
  it('produces an axis-aligned rectangle when unrotated', () => {
    const corners = rectCorners({ cx: 5, cy: 5, width: 4, height: 2, rotation: 0 });
    expect(corners).toEqual([
      { x: 3, y: 4 },
      { x: 7, y: 4 },
      { x: 7, y: 6 },
      { x: 3, y: 6 },
    ]);
  });

  it('preserves area under rotation', () => {
    const corners: Point2D[] = rectCorners({
      cx: 0,
      cy: 0,
      width: 1.722,
      height: 1.134,
      rotation: 0.9,
    });
    expect(ringArea(corners)).toBeCloseTo(1.722 * 1.134, 9);
  });

  it('is wound counter-clockwise', () => {
    expect(
      isCounterClockwise(rectCorners({ cx: 0, cy: 0, width: 2, height: 1, rotation: 0.3 })),
    ).toBe(true);
  });
});

describe('polygon()', () => {
  it('rejects rings with fewer than three vertices', () => {
    expect(() =>
      polygon([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it('copies its input so later mutation cannot corrupt the polygon', () => {
    const src = [...SQUARE];
    const p = polygon(src);
    src.push({ x: 99, y: 99 });
    expect(p.outer).toHaveLength(4);
  });
});
