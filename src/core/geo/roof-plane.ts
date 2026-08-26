import type { MultiPolygon2D, Point2D, Polygon2D, Ring2D, RoofPoint } from './types';
import { DEG, normalizeAzimuth } from './types';
import { polygonArea } from './polygon';

/**
 * How a roof plane's tilt was determined. Drives what we are allowed to claim
 * about the numbers downstream.
 */
export type PitchSource =
  /** Entered by a surveyor / sales engineer. */
  | 'measured'
  /** Supplied by an external building-model provider (e.g. Google Solar API). */
  | 'provider'
  /** Chosen by the operator from a standard 寸 (sun) table. */
  | 'assumed'
  /** Not known — calculations fall back to a flat-plane assumption. */
  | 'unknown';

export interface RoofPlaneSpec {
  /** Tilt from horizontal in degrees, [0, 90). Null when `pitchSource` is 'unknown'. */
  readonly pitchDeg: number | null;
  /** Down-slope compass direction in degrees (0 = N, 90 = E, 180 = S, 270 = W). */
  readonly azimuthDeg: number;
  readonly pitchSource: PitchSource;
}

/**
 * Transform between the *horizontal projection* (what an aerial photo and a
 * map polygon give you) and the *roof plane* (the surface panels actually sit
 * on).
 *
 * A polygon traced on satellite imagery is the roof's shadow on the ground.
 * On a 30° roof the real surface is 1/cos(30°) ≈ 15.5% longer in the slope
 * direction. Laying real-size panel rectangles straight onto the projected
 * polygon therefore silently loses roughly one row per 7 rows. We do all
 * layout on the roof plane and project back only for display.
 *
 * Axes (both metres, measured along the roof surface):
 *   u — cross-slope, parallel to the ridge/eaves. Unscaled.
 *   v — up-slope. Scaled by 1/cos(pitch); +v points UP the roof.
 *
 * When the pitch is unknown the transform is the identity and
 * {@link isFlatAssumption} is true, which the UI must surface to the user.
 */
export class RoofPlane {
  readonly spec: RoofPlaneSpec;
  /** cos(pitch); 1 when the pitch is unknown. */
  readonly cosPitch: number;
  /** Horizontal down-slope unit vector, in local ENU metres. */
  private readonly dx: number;
  private readonly dy: number;
  /** Horizontal ridge-parallel unit vector (down-slope rotated -90°). */
  private readonly rx: number;
  private readonly ry: number;

  constructor(spec: RoofPlaneSpec) {
    const pitch = spec.pitchSource === 'unknown' ? null : spec.pitchDeg;
    if (pitch !== null) {
      if (!Number.isFinite(pitch) || pitch < 0 || pitch >= 90) {
        throw new RangeError(`Roof pitch must be in [0, 90) degrees, got ${pitch}`);
      }
    }
    this.spec = { ...spec, pitchDeg: pitch, azimuthDeg: normalizeAzimuth(spec.azimuthDeg) };
    this.cosPitch = pitch === null ? 1 : Math.cos(pitch * DEG);

    const psi = this.spec.azimuthDeg * DEG;
    // Compass azimuth → ENU: east = sin(ψ), north = cos(ψ).
    this.dx = Math.sin(psi);
    this.dy = Math.cos(psi);
    this.rx = this.dy;
    this.ry = -this.dx;
  }

  /** True when no real pitch is known and results assume a flat roof. */
  get isFlatAssumption(): boolean {
    return this.spec.pitchDeg === null;
  }

  get pitchDeg(): number {
    return this.spec.pitchDeg ?? 0;
  }

  get azimuthDeg(): number {
    return this.spec.azimuthDeg;
  }

  /** Ratio of true roof-surface area to horizontally-projected area. */
  get slopeFactor(): number {
    return 1 / this.cosPitch;
  }

  /** Horizontal projection (local ENU metres) → roof-plane metres. */
  toRoof(p: Point2D): RoofPoint {
    const u = p.x * this.rx + p.y * this.ry;
    const alongDown = p.x * this.dx + p.y * this.dy;
    // +v is up-slope, so negate the down-slope component before stretching.
    return { u, v: -alongDown / this.cosPitch };
  }

  /** Roof-plane metres → horizontal projection (local ENU metres). */
  toHorizontal(p: RoofPoint): Point2D {
    const alongDown = -p.v * this.cosPitch;
    return {
      x: p.u * this.rx + alongDown * this.dx,
      y: p.u * this.ry + alongDown * this.dy,
    };
  }

  toRoofRing(ring: Ring2D): RoofPoint[] {
    return ring.map((p) => this.toRoof(p));
  }

  toHorizontalRing(ring: readonly RoofPoint[]): Point2D[] {
    return ring.map((p) => this.toHorizontal(p));
  }

  /**
   * Convert a projected polygon into roof-plane coordinates.
   * The result is expressed in {@link Point2D} (x = u, y = v) so that every
   * planar helper — buffering, overlay, packing — works unchanged.
   */
  polygonToRoof(poly: Polygon2D): Polygon2D {
    const conv = (ring: Ring2D): Point2D[] =>
      ring.map((p) => {
        const r = this.toRoof(p);
        return { x: r.u, y: r.v };
      });
    return { outer: conv(poly.outer), holes: poly.holes.map(conv) };
  }

  polygonToHorizontal(poly: Polygon2D): Polygon2D {
    const conv = (ring: Ring2D): Point2D[] =>
      ring.map((p) => this.toHorizontal({ u: p.x, v: p.y }));
    return { outer: conv(poly.outer), holes: poly.holes.map(conv) };
  }

  multiToRoof(polys: MultiPolygon2D): MultiPolygon2D {
    return polys.map((p) => this.polygonToRoof(p));
  }

  multiToHorizontal(polys: MultiPolygon2D): MultiPolygon2D {
    return polys.map((p) => this.polygonToHorizontal(p));
  }

  /** True surface area of a horizontally-projected polygon. Units: m². */
  surfaceArea(projected: Polygon2D): number {
    return polygonArea(projected) * this.slopeFactor;
  }
}

/**
 * Japanese roof pitch is quoted in 寸 (sun): rise in sun per 10 sun of run,
 * i.e. the tangent of the pitch multiplied by 10. 4寸 = atan(0.4) ≈ 21.8°.
 */
export function sunToPitchDeg(sun: number): number {
  if (!Number.isFinite(sun) || sun < 0) {
    throw new RangeError(`Roof pitch in sun must be >= 0, got ${sun}`);
  }
  return Math.atan(sun / 10) / DEG;
}

export function pitchDegToSun(pitchDeg: number): number {
  if (!Number.isFinite(pitchDeg) || pitchDeg < 0 || pitchDeg >= 90) {
    throw new RangeError(`Roof pitch must be in [0, 90) degrees, got ${pitchDeg}`);
  }
  return Math.tan(pitchDeg * DEG) * 10;
}

/** Compass point label for an azimuth, using 8-point Japanese notation. */
export function azimuthLabel(azimuthDeg: number): string {
  const labels = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  const idx = Math.round(normalizeAzimuth(azimuthDeg) / 45) % 8;
  return labels[idx]!;
}
