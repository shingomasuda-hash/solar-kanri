import { describe, expect, it } from 'vitest';
import { RoofPlane, pitchDegToSun, sunToPitchDeg, azimuthLabel } from '@core/geo/roof-plane';
import { polygonArea } from '@core/geo/polygon';
import type { Polygon2D } from '@core/geo/types';

/** A 10 m x 8 m projected roof footprint, axis aligned. */
const FOOTPRINT: Polygon2D = {
  outer: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 8 },
    { x: 0, y: 8 },
  ],
  holes: [],
};

describe('RoofPlane', () => {
  it('is the identity for a flat (0 degree) roof', () => {
    const plane = new RoofPlane({ pitchDeg: 0, azimuthDeg: 180, pitchSource: 'measured' });
    expect(plane.slopeFactor).toBeCloseTo(1, 12);
    const roofPoly = plane.polygonToRoof(FOOTPRINT);
    expect(polygonArea(roofPoly)).toBeCloseTo(80, 9);
  });

  it('stretches projected area by 1/cos(pitch)', () => {
    for (const pitchDeg of [10, 21.8, 26.57, 30, 45]) {
      const plane = new RoofPlane({ pitchDeg, azimuthDeg: 180, pitchSource: 'measured' });
      const expected = 80 / Math.cos((pitchDeg * Math.PI) / 180);
      expect(polygonArea(plane.polygonToRoof(FOOTPRINT))).toBeCloseTo(expected, 9);
      expect(plane.surfaceArea(FOOTPRINT)).toBeCloseTo(expected, 9);
    }
  });

  it('round-trips roof <-> horizontal exactly', () => {
    const plane = new RoofPlane({ pitchDeg: 30, azimuthDeg: 200, pitchSource: 'measured' });
    for (const p of [
      { x: 0, y: 0 },
      { x: 3.5, y: -7.25 },
      { x: -12, y: 4 },
    ]) {
      const back = plane.toHorizontal(plane.toRoof(p));
      expect(back.x).toBeCloseTo(p.x, 10);
      expect(back.y).toBeCloseTo(p.y, 10);
    }
  });

  it('scales only the slope direction, never the ridge direction', () => {
    // South-facing roof: down-slope points due south, ridge runs east-west.
    const plane = new RoofPlane({ pitchDeg: 45, azimuthDeg: 180, pitchSource: 'measured' });
    // 10 m due east is purely ridge-parallel and must keep its length.
    const east = plane.toRoof({ x: 10, y: 0 });
    expect(Math.hypot(east.u, east.v)).toBeCloseTo(10, 9);
    // 10 m due south is purely down-slope and must stretch by 1/cos45.
    const south = plane.toRoof({ x: 0, y: -10 });
    expect(Math.hypot(south.u, south.v)).toBeCloseTo(10 / Math.cos(Math.PI / 4), 9);
    expect(south.v).toBeLessThan(0); // south is down-slope here, and +v is up-slope
  });

  it('points +v up the roof', () => {
    // North-facing roof: down-slope is north, so going north must be -v.
    const plane = new RoofPlane({ pitchDeg: 30, azimuthDeg: 0, pitchSource: 'measured' });
    expect(plane.toRoof({ x: 0, y: 5 }).v).toBeLessThan(0);
    expect(plane.toRoof({ x: 0, y: -5 }).v).toBeGreaterThan(0);
  });

  it('treats an unknown pitch as a flagged flat assumption', () => {
    const plane = new RoofPlane({ pitchDeg: 30, azimuthDeg: 180, pitchSource: 'unknown' });
    expect(plane.isFlatAssumption).toBe(true);
    expect(plane.cosPitch).toBe(1);
    expect(plane.slopeFactor).toBe(1);
    expect(polygonArea(plane.polygonToRoof(FOOTPRINT))).toBeCloseTo(80, 9);
  });

  it('does not flag a known pitch as an assumption', () => {
    const plane = new RoofPlane({ pitchDeg: 30, azimuthDeg: 180, pitchSource: 'measured' });
    expect(plane.isFlatAssumption).toBe(false);
  });

  it('normalises azimuth into [0, 360)', () => {
    expect(
      new RoofPlane({ pitchDeg: 0, azimuthDeg: -90, pitchSource: 'measured' }).azimuthDeg,
    ).toBe(270);
    expect(
      new RoofPlane({ pitchDeg: 0, azimuthDeg: 450, pitchSource: 'measured' }).azimuthDeg,
    ).toBe(90);
  });

  it('rejects out-of-range pitches', () => {
    expect(() => new RoofPlane({ pitchDeg: 90, azimuthDeg: 0, pitchSource: 'measured' })).toThrow(
      RangeError,
    );
    expect(() => new RoofPlane({ pitchDeg: -1, azimuthDeg: 0, pitchSource: 'measured' })).toThrow(
      RangeError,
    );
  });

  it('rotating the azimuth does not change roof-plane area', () => {
    const areas = [0, 45, 90, 137, 180, 270].map((az) =>
      polygonArea(
        new RoofPlane({ pitchDeg: 30, azimuthDeg: az, pitchSource: 'measured' }).polygonToRoof(
          FOOTPRINT,
        ),
      ),
    );
    for (const a of areas) expect(a).toBeCloseTo(areas[0]!, 9);
  });
});

describe('Japanese 寸 (sun) pitch conversion', () => {
  it('converts sun to degrees', () => {
    expect(sunToPitchDeg(0)).toBeCloseTo(0, 10);
    expect(sunToPitchDeg(3)).toBeCloseTo(16.699, 3);
    expect(sunToPitchDeg(4)).toBeCloseTo(21.801, 3);
    expect(sunToPitchDeg(5)).toBeCloseTo(26.565, 3);
    expect(sunToPitchDeg(10)).toBeCloseTo(45, 10);
  });

  it('round-trips', () => {
    for (const sun of [1, 2.5, 3, 4, 4.5, 5, 6, 8]) {
      expect(pitchDegToSun(sunToPitchDeg(sun))).toBeCloseTo(sun, 10);
    }
  });

  it('rejects nonsense input', () => {
    expect(() => sunToPitchDeg(-1)).toThrow(RangeError);
    expect(() => pitchDegToSun(90)).toThrow(RangeError);
  });
});

describe('azimuthLabel', () => {
  it('labels the 8 compass points in Japanese', () => {
    expect(azimuthLabel(0)).toBe('北');
    expect(azimuthLabel(90)).toBe('東');
    expect(azimuthLabel(180)).toBe('南');
    expect(azimuthLabel(270)).toBe('西');
    expect(azimuthLabel(225)).toBe('南西');
    expect(azimuthLabel(359)).toBe('北');
  });
});
