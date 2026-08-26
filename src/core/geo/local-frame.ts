import { type LatLng, type Point2D, DEG, RAD } from './types';

/**
 * WGS84 ellipsoid constants (NIMA TR8350.2, 3rd ed.).
 * Source: https://nsgreg.nga.mil/doc/view?i=4085 (WGS84 defining parameters)
 */
const WGS84_A = 6378137.0; // semi-major axis, metres
const WGS84_F = 1 / 298.257223563; // flattening
const WGS84_E2 = WGS84_F * (2 - WGS84_F); // first eccentricity squared

/**
 * Local East-North tangent-plane frame ("local ENU", altitude ignored).
 *
 * Why: Google Maps hands us WGS84 degrees, but panel layout needs millimetre-
 * consistent metres. Doing metre arithmetic on degrees is wrong by up to ~20%
 * in x/y aspect at Japanese latitudes. We therefore pin a frame origin at the
 * roof and convert once.
 *
 * Accuracy: first-order (radius-of-curvature) approximation of the tangent
 * plane. Error grows as O(d^3 / R^2). Measured against a Vincenty geodesic
 * (see tests/unit/geo/local-frame.test.ts): under 1 mm at 50 m — a whole roof
 * — and at most ~14 ppm (~7 mm) at 500 m. Both are far below the ~10 mm panel
 * placement tolerance. See ADR-003.
 */
export class LocalFrame {
  readonly origin: LatLng;
  /** Metres per radian of latitude at the origin (meridional radius). */
  private readonly mPerRadLat: number;
  /** Metres per radian of longitude at the origin (prime-vertical × cos φ). */
  private readonly mPerRadLng: number;

  constructor(origin: LatLng) {
    if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
      throw new RangeError('LocalFrame origin must be finite');
    }
    if (origin.lat < -90 || origin.lat > 90) {
      throw new RangeError(`LocalFrame origin latitude out of range: ${origin.lat}`);
    }
    if (origin.lng < -180 || origin.lng > 180) {
      throw new RangeError(`LocalFrame origin longitude out of range: ${origin.lng}`);
    }
    this.origin = origin;

    const phi = origin.lat * DEG;
    const sinPhi = Math.sin(phi);
    const w2 = 1 - WGS84_E2 * sinPhi * sinPhi;
    const w = Math.sqrt(w2);
    // Prime-vertical radius of curvature.
    const rN = WGS84_A / w;
    // Meridional radius of curvature.
    const rM = (WGS84_A * (1 - WGS84_E2)) / (w2 * w);

    this.mPerRadLat = rM;
    this.mPerRadLng = rN * Math.cos(phi);
  }

  /** Build a frame whose origin is the centroid of the supplied coordinates. */
  static fromPoints(points: readonly LatLng[]): LocalFrame {
    if (points.length === 0) {
      throw new RangeError('LocalFrame.fromPoints requires at least one point');
    }
    let lat = 0;
    let lng = 0;
    for (const p of points) {
      lat += p.lat;
      lng += p.lng;
    }
    return new LocalFrame({ lat: lat / points.length, lng: lng / points.length });
  }

  /** WGS84 → local metres (x = East, y = North). */
  toLocal(p: LatLng): Point2D {
    return {
      x: (p.lng - this.origin.lng) * DEG * this.mPerRadLng,
      y: (p.lat - this.origin.lat) * DEG * this.mPerRadLat,
    };
  }

  /** Local metres → WGS84. Exact inverse of {@link toLocal}. */
  toLatLng(p: Point2D): LatLng {
    return {
      lat: this.origin.lat + (p.y / this.mPerRadLat) * RAD,
      lng: this.origin.lng + (p.x / this.mPerRadLng) * RAD,
    };
  }

  toLocalRing(ring: readonly LatLng[]): Point2D[] {
    return ring.map((p) => this.toLocal(p));
  }

  toLatLngRing(ring: readonly Point2D[]): LatLng[] {
    return ring.map((p) => this.toLatLng(p));
  }

  /** Serialisable description, so a stored frame can be reconstructed exactly. */
  toJSON(): { origin: LatLng } {
    return { origin: this.origin };
  }
}
