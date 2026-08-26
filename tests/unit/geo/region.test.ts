import { describe, expect, it } from 'vitest';
import {
  Region,
  orientedRectsOverlap,
  pointStrictlyInConvex,
  segmentsProperlyCross,
} from '@core/geo/region';
import { difference } from '@core/geo/jsts-adapter';
import { rectCorners, rotateRing } from '@core/geo/polygon';
import type { OrientedRect, Polygon2D } from '@core/geo/types';

const square = (x: number, y: number, size: number): Polygon2D => ({
  outer: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
  holes: [],
});

const rect = (cx: number, cy: number, w: number, h: number, rot = 0): OrientedRect => ({
  cx,
  cy,
  width: w,
  height: h,
  rotation: rot,
});

describe('Region', () => {
  const plain = new Region([square(0, 0, 10)]);

  it('reports area and emptiness', () => {
    expect(plain.area).toBeCloseTo(100, 9);
    expect(plain.isEmpty).toBe(false);
    const empty = new Region([]);
    expect(empty.isEmpty).toBe(true);
    expect(empty.containsRect(rectCorners(rect(1, 1, 1, 1)))).toBe(false);
    expect(empty.containsPoint({ x: 0, y: 0 })).toBe(false);
  });

  it('accepts rectangles wholly inside', () => {
    expect(plain.containsOrientedRect(rect(5, 5, 2, 1))).toBe(true);
    expect(plain.containsOrientedRect(rect(5, 5, 2, 1, 0.7))).toBe(true);
  });

  it('rejects rectangles that stick out', () => {
    expect(plain.containsOrientedRect(rect(9.9, 5, 2, 1))).toBe(false);
    expect(plain.containsOrientedRect(rect(-1, 5, 2, 1))).toBe(false);
    expect(plain.containsOrientedRect(rect(5, 5, 20, 1))).toBe(false);
  });

  it('rejects a rectangle entirely outside', () => {
    expect(plain.containsOrientedRect(rect(50, 50, 2, 1))).toBe(false);
  });

  it('accepts a rectangle flush against the boundary', () => {
    expect(plain.containsOrientedRect(rect(1, 0.5, 2, 1))).toBe(true);
    expect(plain.containsOrientedRect(rect(5, 5, 10, 10))).toBe(true);
  });

  it('rejects a rectangle a hair too large', () => {
    expect(plain.containsOrientedRect(rect(5, 5, 10.0001, 10))).toBe(false);
  });

  describe('with a hole', () => {
    const holed = new Region(difference([square(0, 0, 20)], [square(8, 8, 4)]));

    it('rejects a rectangle overlapping the hole edge', () => {
      expect(holed.containsOrientedRect(rect(8, 10, 3, 2))).toBe(false);
    });

    it('rejects a rectangle sitting entirely inside the hole', () => {
      expect(holed.containsOrientedRect(rect(10, 10, 2, 2))).toBe(false);
    });

    it('rejects a rectangle that swallows the whole hole', () => {
      // No edge crossing at all here — only condition (3) catches this.
      expect(holed.containsOrientedRect(rect(10, 10, 8, 8))).toBe(false);
    });

    it('accepts a rectangle clear of the hole', () => {
      expect(holed.containsOrientedRect(rect(3, 3, 4, 4))).toBe(true);
    });

    it('accepts a rectangle flush with the hole edge', () => {
      expect(holed.containsOrientedRect(rect(6, 10, 4, 4))).toBe(true);
    });
  });

  describe('with several disjoint pieces', () => {
    const split = new Region([square(0, 0, 10), square(20, 0, 10)]);

    it('accepts rectangles in either piece', () => {
      expect(split.containsOrientedRect(rect(5, 5, 2, 2))).toBe(true);
      expect(split.containsOrientedRect(rect(25, 5, 2, 2))).toBe(true);
    });

    it('rejects a rectangle spanning the gap', () => {
      expect(split.containsOrientedRect(rect(15, 5, 20, 2))).toBe(false);
    });
  });

  it('agrees with a brute-force reference on a rotated L-shape', () => {
    const lshape: Polygon2D = {
      outer: rotateRing(
        [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 5 },
          { x: 5, y: 5 },
          { x: 5, y: 11 },
          { x: 0, y: 11 },
        ],
        0.37,
        { x: 0, y: 0 },
      ),
      holes: [],
    };
    const region = new Region([lshape]);
    const reference = new Region([lshape], 1e6); // one grid cell: no indexing at all
    let agreements = 0;
    for (let x = -2; x <= 14; x += 0.5) {
      for (let y = -2; y <= 14; y += 0.5) {
        const r = rect(x, y, 1.7, 1.1, 0.37);
        expect(region.containsOrientedRect(r)).toBe(reference.containsOrientedRect(r));
        agreements++;
      }
    }
    expect(agreements).toBeGreaterThan(1000);
  });

  it('containsPolygon refuses polygons with holes', () => {
    const withHole: Polygon2D = {
      outer: square(1, 1, 3).outer,
      holes: [square(1.5, 1.5, 1).outer],
    };
    expect(plain.containsPolygon(withHole)).toBe(false);
    expect(plain.containsPolygon(square(1, 1, 3))).toBe(true);
  });
});

describe('segmentsProperlyCross', () => {
  it('detects a genuine X crossing', () => {
    expect(segmentsProperlyCross(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
  });

  it('ignores a shared endpoint', () => {
    expect(segmentsProperlyCross(0, 0, 10, 0, 10, 0, 10, 10)).toBe(false);
  });

  it('ignores a T junction', () => {
    expect(segmentsProperlyCross(0, 0, 10, 0, 5, 0, 5, 10)).toBe(false);
  });

  it('ignores collinear overlap (panels flush against a roof edge)', () => {
    expect(segmentsProperlyCross(0, 0, 10, 0, 3, 0, 7, 0)).toBe(false);
  });

  it('ignores disjoint segments', () => {
    expect(segmentsProperlyCross(0, 0, 1, 0, 5, 5, 6, 5)).toBe(false);
  });
});

describe('pointStrictlyInConvex', () => {
  const sq = rectCorners(rect(0, 0, 2, 2));
  it('is true strictly inside', () => {
    expect(pointStrictlyInConvex({ x: 0, y: 0 }, sq)).toBe(true);
  });
  it('is false on the boundary and outside', () => {
    expect(pointStrictlyInConvex({ x: 1, y: 0 }, sq)).toBe(false);
    expect(pointStrictlyInConvex({ x: 2, y: 0 }, sq)).toBe(false);
  });
});

describe('orientedRectsOverlap', () => {
  it('detects overlap', () => {
    expect(orientedRectsOverlap(rect(0, 0, 2, 1), rect(1, 0, 2, 1))).toBe(true);
  });

  it('allows flush neighbours', () => {
    expect(orientedRectsOverlap(rect(0, 0, 2, 1), rect(2, 0, 2, 1))).toBe(false);
  });

  it('separates distant rectangles cheaply', () => {
    expect(orientedRectsOverlap(rect(0, 0, 2, 1), rect(50, 50, 2, 1))).toBe(false);
  });

  it('handles rotation (a rotated rectangle can clear an axis-aligned one)', () => {
    // Two 2x1 rectangles, centres 1.4 m apart, one turned 90 degrees.
    expect(orientedRectsOverlap(rect(0, 0, 2, 1), rect(1.4, 0, 2, 1, Math.PI / 2))).toBe(true);
    expect(orientedRectsOverlap(rect(0, 0, 2, 1), rect(0, 1.6, 2, 1, Math.PI / 2))).toBe(false);
    // Rotated, its long side runs along y, so 1.2 m of separation is not enough.
    expect(orientedRectsOverlap(rect(0, 0, 2, 1), rect(0, 1.2, 2, 1, Math.PI / 2))).toBe(true);
  });

  it('is symmetric', () => {
    const a = rect(0, 0, 1.722, 1.134, 0.3);
    const b = rect(1.5, 0.5, 1.722, 1.134, 1.1);
    expect(orientedRectsOverlap(a, b)).toBe(orientedRectsOverlap(b, a));
  });
});

describe('floating-point tolerance at the boundary', () => {
  /**
   * Regression: rotating a layout back from the search frame leaves ~1e-15 m of
   * drift, so a module flush with the eaves can land a hair outside the index's
   * bounding box. The bbox guards must not reject it before the epsilon-tolerant
   * boundary test gets a chance to run.
   */
  const region = new Region([square(1, 1, 58)]);

  it('accepts a point one part in 1e15 outside the extent', () => {
    expect(region.containsPoint({ x: 30, y: 1 - 1.8e-15 })).toBe(true);
    expect(region.containsPoint({ x: 1 - 1.8e-15, y: 30 })).toBe(true);
    expect(region.containsPoint({ x: 59 + 1.8e-15, y: 30 })).toBe(true);
    expect(region.containsPoint({ x: 30, y: 59 + 1.8e-15 })).toBe(true);
  });

  it('accepts a rectangle flush with the boundary after rotation drift', () => {
    const corners = [
      { x: 58.666000000000004, y: 0.9999999999999982 },
      { x: 58.666000000000004, y: 1.9999999999999982 },
      { x: 57.016, y: 1.9999999999999982 },
      { x: 57.016, y: 0.9999999999999982 },
    ];
    expect(region.containsRect(corners)).toBe(true);
  });

  it('still rejects a point genuinely outside', () => {
    expect(region.containsPoint({ x: 30, y: 0.99 })).toBe(false);
    expect(region.containsPoint({ x: 59.01, y: 30 })).toBe(false);
  });
});
