import { describe, expect, it } from 'vitest';
import {
  bufferMulti,
  bufferPolygon,
  difference,
  intersection,
  intersectionArea,
  isValidPolygon,
  makeValid,
  union,
} from '@core/geo/jsts-adapter';
import { polygonArea } from '@core/geo/polygon';
import type { Polygon2D } from '@core/geo/types';

const square = (x: number, y: number, size: number): Polygon2D => ({
  outer: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
  holes: [],
});

const SQ10 = square(0, 0, 10);

describe('bufferPolygon', () => {
  it('shrinks by an exact setback with mitre joins', () => {
    const out = bufferPolygon(SQ10, -1);
    expect(out).toHaveLength(1);
    expect(polygonArea(out[0]!)).toBeCloseTo(64, 6);
  });

  it('grows by an exact clearance with mitre joins', () => {
    const out = bufferPolygon(SQ10, 1);
    expect(out).toHaveLength(1);
    expect(polygonArea(out[0]!)).toBeCloseTo(144, 6);
  });

  it('returns nothing when the setback consumes the polygon', () => {
    expect(bufferPolygon(SQ10, -6)).toHaveLength(0);
    expect(bufferPolygon(SQ10, -5)).toHaveLength(0);
  });

  it('is a no-op for zero distance', () => {
    expect(bufferPolygon(SQ10, 0)).toEqual([SQ10]);
  });

  it('can split a concave shape into several pieces when eroded', () => {
    // Dumbbell: two 10x10 pads joined by a 1 m wide neck.
    const dumbbell: Polygon2D = {
      outer: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4.5 },
        { x: 20, y: 4.5 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 5.5 },
        { x: 10, y: 5.5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      holes: [],
    };
    const eroded = bufferPolygon(dumbbell, -1);
    expect(eroded.length).toBe(2);
  });

  it('rounds corners when asked to', () => {
    const mitre = polygonArea(bufferPolygon(SQ10, 1, 'mitre')[0]!);
    const round = polygonArea(bufferPolygon(SQ10, 1, 'round')[0]!);
    // Rounded corners cut the four square corner squares down to quarter-discs.
    expect(round).toBeLessThan(mitre);
    // 16 segments per quadrant slightly under-fills each arc.
    expect(round).toBeCloseTo(100 + 4 * 10 * 1 + Math.PI, 1);
  });

  it('buffers a multipolygon element-wise', () => {
    const out = bufferMulti([square(0, 0, 10), square(20, 0, 10)], -1);
    expect(out).toHaveLength(2);
    for (const p of out) expect(polygonArea(p)).toBeCloseTo(64, 6);
  });
});

describe('boolean overlay', () => {
  it('unions overlapping squares', () => {
    const u = union([SQ10, square(5, 0, 10)]);
    expect(u).toHaveLength(1);
    expect(polygonArea(u[0]!)).toBeCloseTo(150, 6);
  });

  it('subtracts an exclusion zone', () => {
    const d = difference([SQ10], [square(2, 2, 3)]);
    expect(polygonArea(d[0]!)).toBeCloseTo(91, 6);
  });

  it('creates a hole when the cutter is fully interior', () => {
    const d = difference([SQ10], [square(3, 3, 2)]);
    expect(d).toHaveLength(1);
    expect(d[0]!.holes).toHaveLength(1);
  });

  it('returns nothing when the cutter swallows the subject', () => {
    expect(difference([SQ10], [square(-5, -5, 30)])).toHaveLength(0);
  });

  it('passes the subject through when there is nothing to cut', () => {
    expect(difference([SQ10], [])).toEqual([SQ10]);
    expect(difference([], [SQ10])).toEqual([]);
  });

  it('intersects', () => {
    expect(intersectionArea([SQ10], [square(5, 5, 10)])).toBeCloseTo(25, 6);
    expect(intersectionArea([SQ10], [square(50, 50, 10)])).toBe(0);
    expect(intersection([], [SQ10])).toEqual([]);
  });
});

describe('validity', () => {
  it('repairs a self-intersecting bowtie without losing either lobe', () => {
    const bowtie: Polygon2D = {
      outer: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      holes: [],
    };
    expect(isValidPolygon(bowtie)).toBe(false);
    const fixed = makeValid(bowtie);
    expect(fixed.length).toBeGreaterThan(0);
    for (const p of fixed) expect(isValidPolygon(p)).toBe(true);
    // Both triangles must survive: buffer(0) would have kept only one (25 m^2).
    expect(fixed).toHaveLength(2);
    expect(fixed.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(50, 6);
  });

  it('repairs a ring that doubles back on itself', () => {
    const spiky: Polygon2D = {
      outer: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 5, y: -5 },
        { x: 0, y: 10 },
      ],
      holes: [],
    };
    const fixed = makeValid(spiky);
    expect(fixed.length).toBeGreaterThan(0);
    for (const p of fixed) expect(isValidPolygon(p)).toBe(true);
  });

  it('leaves a valid polygon alone', () => {
    expect(isValidPolygon(SQ10)).toBe(true);
    expect(polygonArea(makeValid(SQ10)[0]!)).toBeCloseTo(100, 9);
  });

  it('accepts input rings wound either way', () => {
    const cw: Polygon2D = { outer: [...SQ10.outer].reverse(), holes: [] };
    expect(polygonArea(bufferPolygon(cw, -1)[0]!)).toBeCloseTo(64, 6);
  });
});
