import type { GeoJSONPolygon, LatLng, Point2D, Polygon2D, Ring2D } from './types';
import type { LocalFrame } from './local-frame';
import { ensureCCW } from './polygon';

/**
 * Persistence format: WGS84 GeoJSON (RFC 7946), [lng, lat], closed rings.
 * Local metre coordinates are derived, never stored as the source of truth —
 * they depend on a frame origin that could otherwise drift.
 */

export function ringToGeoJSONCoords(ring: readonly LatLng[]): [number, number][] {
  const coords: [number, number][] = ring.map((p) => [p.lng, p.lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coords.push([first[0], first[1]]);
  }
  return coords;
}

export function geoJSONCoordsToRing(coords: readonly (readonly [number, number])[]): LatLng[] {
  const ring: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
  if (ring.length > 1) {
    const a = ring[0]!;
    const b = ring[ring.length - 1]!;
    if (a.lat === b.lat && a.lng === b.lng) ring.pop();
  }
  return ring;
}

export function toGeoJSONPolygon(
  outer: readonly LatLng[],
  holes: readonly LatLng[][] = [],
): GeoJSONPolygon {
  if (outer.length < 3) {
    throw new RangeError(`GeoJSON polygon needs >= 3 vertices, got ${outer.length}`);
  }
  return {
    type: 'Polygon',
    coordinates: [ringToGeoJSONCoords(outer), ...holes.map(ringToGeoJSONCoords)],
  };
}

export function fromGeoJSONPolygon(geo: GeoJSONPolygon): { outer: LatLng[]; holes: LatLng[][] } {
  const rings = geo.coordinates;
  if (!rings || rings.length === 0) throw new RangeError('GeoJSON polygon has no rings');
  return {
    outer: geoJSONCoordsToRing(rings[0]!),
    holes: rings.slice(1).map((r) => geoJSONCoordsToRing(r)),
  };
}

/** WGS84 GeoJSON → local metre polygon under the supplied frame. */
export function geoJSONToLocal(geo: GeoJSONPolygon, frame: LocalFrame): Polygon2D {
  const { outer, holes } = fromGeoJSONPolygon(geo);
  return {
    outer: ensureCCW(frame.toLocalRing(outer)),
    holes: holes.map((h) => frame.toLocalRing(h)),
  };
}

/** Local metre polygon → WGS84 GeoJSON under the supplied frame. */
export function localToGeoJSON(poly: Polygon2D, frame: LocalFrame): GeoJSONPolygon {
  const ring = (r: Ring2D): LatLng[] => frame.toLatLngRing(r as readonly Point2D[]);
  return toGeoJSONPolygon(ring(poly.outer), poly.holes.map(ring));
}
