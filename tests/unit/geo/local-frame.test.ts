import { describe, expect, it } from 'vitest';
import { LocalFrame } from '@core/geo/local-frame';
import type { LatLng } from '@core/geo/types';

const TOKYO: LatLng = { lat: 35.681236, lng: 139.767125 };

describe('LocalFrame', () => {
  it('maps the origin to (0, 0)', () => {
    const f = new LocalFrame(TOKYO);
    const p = f.toLocal(TOKYO);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
  });

  it('round-trips WGS84 -> metres -> WGS84 to sub-micrometre precision', () => {
    const f = new LocalFrame(TOKYO);
    const samples: LatLng[] = [
      { lat: 35.6813, lng: 139.7672 },
      { lat: 35.6805, lng: 139.7661 },
      { lat: 35.685, lng: 139.771 },
    ];
    for (const s of samples) {
      const back = f.toLatLng(f.toLocal(s));
      expect(back.lat).toBeCloseTo(s.lat, 12);
      expect(back.lng).toBeCloseTo(s.lng, 12);
    }
  });

  it('produces distances that agree with an independent geodesic solution', () => {
    const f = new LocalFrame(TOKYO);
    // ~100 m north and ~100 m east of the origin.
    const north: LatLng = { lat: TOKYO.lat + 0.0008993, lng: TOKYO.lng };
    const east: LatLng = { lat: TOKYO.lat, lng: TOKYO.lng + 0.0011051 };

    const dNorth = Math.hypot(f.toLocal(north).x, f.toLocal(north).y);
    const dEast = Math.hypot(f.toLocal(east).x, f.toLocal(east).y);

    expect(dNorth).toBeCloseTo(geodesic(TOKYO, north), 3);
    expect(dEast).toBeCloseTo(geodesic(TOKYO, east), 3);
    // Both offsets were chosen to be ~100 m.
    expect(dNorth).toBeGreaterThan(99);
    expect(dNorth).toBeLessThan(101);
    expect(dEast).toBeGreaterThan(99);
    expect(dEast).toBeLessThan(101);
  });

  it('keeps a 100 m square square (the reason we do not compute in degrees)', () => {
    const f = new LocalFrame(TOKYO);
    const a = f.toLatLng({ x: 0, y: 0 });
    const b = f.toLatLng({ x: 100, y: 0 });
    const c = f.toLatLng({ x: 100, y: 100 });
    const side1 = geodesic(a, b);
    const side2 = geodesic(b, c);
    expect(side1).toBeCloseTo(100, 4);
    expect(side2).toBeCloseTo(100, 4);
    // In raw degree space the same square would have a ~1.23 aspect ratio here.
    expect(Math.abs(b.lng - a.lng) / Math.abs(c.lat - b.lat)).toBeGreaterThan(1.15);
  });

  it('is accurate at high and low latitude origins', () => {
    for (const origin of [
      { lat: 26.2, lng: 127.68 },
      { lat: 45.4, lng: 141.7 },
    ]) {
      const f = new LocalFrame(origin);
      const far = f.toLatLng({ x: 250, y: -180 });
      const local = f.toLocal(far);
      expect(local.x).toBeCloseTo(250, 6);
      expect(local.y).toBeCloseTo(-180, 6);
    }
  });

  /**
   * Documents the accuracy envelope claimed in ADR-003. The tangent-plane
   * approximation is second-order: error grows roughly as d^3 / R^2, so it is
   * negligible at roof scale and still tiny at site scale.
   */
  it('stays within 20 ppm of the true geodesic out to 500 m', () => {
    const origins: LatLng[] = [
      { lat: 26.2, lng: 127.68 },
      { lat: 35.681, lng: 139.767 },
      { lat: 45.4, lng: 141.7 },
    ];
    const distances = [10, 50, 100, 300, 500];
    for (const origin of origins) {
      const f = new LocalFrame(origin);
      for (const d of distances) {
        for (const bearing of [0, 30, 45, 90, 135, 180, 270]) {
          const rad = (bearing * Math.PI) / 180;
          const target = f.toLatLng({ x: d * Math.sin(rad), y: d * Math.cos(rad) });
          const ppm = Math.abs(geodesic(origin, target) - d) / d / 1e-6;
          expect(ppm).toBeLessThan(20);
        }
      }
    }
  });

  it('is sub-millimetre accurate across a single roof (<= 50 m)', () => {
    const f = new LocalFrame({ lat: 35.681, lng: 139.767 });
    for (const d of [5, 20, 50]) {
      const target = f.toLatLng({ x: d, y: 0 });
      expect(Math.abs(geodesic({ lat: 35.681, lng: 139.767 }, target) - d)).toBeLessThan(0.001);
    }
  });

  it('centres a frame on the centroid of the supplied points', () => {
    const f = LocalFrame.fromPoints([
      { lat: 35.0, lng: 139.0 },
      { lat: 35.2, lng: 139.4 },
    ]);
    expect(f.origin.lat).toBeCloseTo(35.1, 10);
    expect(f.origin.lng).toBeCloseTo(139.2, 10);
  });

  it('rejects invalid origins', () => {
    expect(() => new LocalFrame({ lat: 95, lng: 0 })).toThrow(RangeError);
    expect(() => new LocalFrame({ lat: 0, lng: 200 })).toThrow(RangeError);
    expect(() => new LocalFrame({ lat: NaN, lng: 0 })).toThrow(RangeError);
    expect(() => LocalFrame.fromPoints([])).toThrow(RangeError);
  });
});

/**
 * Independent reference: Vincenty inverse geodesic on the WGS84 ellipsoid.
 * Deliberately a different formulation from LocalFrame's tangent-plane
 * approximation, so agreement between the two is real evidence.
 * Source: T. Vincenty, Survey Review XXIII No 176 (1975).
 */
function geodesic(p1: LatLng, p2: LatLng): number {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const L = ((p2.lng - p1.lng) * Math.PI) / 180;
  const U1 = Math.atan((1 - f) * Math.tan((p1.lat * Math.PI) / 180));
  const U2 = Math.atan((1 - f) * Math.tan((p2.lat * Math.PI) / 180));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cos2SigmaM = 1;
  let cosSqAlpha = 1;

  for (let i = 0; i < 200; i++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) *
        f *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-14) break;
  }

  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return b * A * (sigma - deltaSigma);
}
