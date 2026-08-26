/**
 * Core geometry value types.
 *
 * UNITS CONTRACT (see docs/adr/ADR-003-coordinate-system.md):
 *  - `LatLng`     : WGS84 degrees. Display / storage / external APIs ONLY.
 *  - `Point2D`    : metres in a *local Cartesian* frame. All computation.
 *  - `RoofPoint`  : metres on the *roof plane* (tilt-corrected). Panel layout.
 *
 * Never do metre-scale arithmetic on LatLng. Convert first.
 */

/** WGS84 geographic coordinate, degrees. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** A point in a local Cartesian frame. Units: metres. x = East, y = North. */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/**
 * A point on the roof plane. Units: metres, measured along the roof surface.
 * u = cross-slope (ridge-parallel) axis, v = up-slope axis.
 */
export interface RoofPoint {
  readonly u: number;
  readonly v: number;
}

/**
 * Simple polygon ring in local metres. Implicitly closed: the last vertex is
 * NOT a repeat of the first. Minimum 3 vertices.
 */
export type Ring2D = readonly Point2D[];

/** Polygon with an outer ring and zero or more holes, in local metres. */
export interface Polygon2D {
  readonly outer: Ring2D;
  readonly holes: readonly Ring2D[];
}

/** A set of disjoint polygons treated as one region. */
export type MultiPolygon2D = readonly Polygon2D[];

/** Axis-aligned bounding box in local metres. */
export interface BBox2D {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** An oriented rectangle: centre, size and rotation (radians, CCW from +x). */
export interface OrientedRect {
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/** GeoJSON Polygon geometry (RFC 7946) — closed rings, [lng, lat] order. */
export interface GeoJSONPolygon {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function toRadians(deg: number): number {
  return deg * DEG;
}

export function toDegrees(rad: number): number {
  return rad * RAD;
}

/**
 * Normalise a compass azimuth to [0, 360).
 * 0 = North, 90 = East, 180 = South, 270 = West.
 */
export function normalizeAzimuth(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}
