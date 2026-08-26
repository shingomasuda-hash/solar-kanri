import { describe, expect, it } from 'vitest';
import {
  fromGeoJSONPolygon,
  geoJSONToLocal,
  localToGeoJSON,
  toGeoJSONPolygon,
} from '@core/geo/geojson';
import { LocalFrame } from '@core/geo/local-frame';
import { polygonArea } from '@core/geo/polygon';
import type { GeoJSONPolygon, LatLng } from '@core/geo/types';

const ORIGIN: LatLng = { lat: 35.681236, lng: 139.767125 };

describe('GeoJSON persistence', () => {
  it('closes rings on write and opens them on read', () => {
    const ring: LatLng[] = [
      { lat: 35.0, lng: 139.0 },
      { lat: 35.0, lng: 139.001 },
      { lat: 35.001, lng: 139.001 },
    ];
    const geo = toGeoJSONPolygon(ring);
    expect(geo.coordinates[0]).toHaveLength(4);
    expect(geo.coordinates[0]![0]).toEqual(geo.coordinates[0]![3]);
    expect(fromGeoJSONPolygon(geo).outer).toHaveLength(3);
  });

  it('uses [lng, lat] ordering as RFC 7946 requires', () => {
    const geo = toGeoJSONPolygon([
      { lat: 35.5, lng: 139.5 },
      { lat: 35.5, lng: 139.6 },
      { lat: 35.6, lng: 139.6 },
    ]);
    expect(geo.coordinates[0]![0]).toEqual([139.5, 35.5]);
  });

  it('preserves holes', () => {
    const outer: LatLng[] = [
      { lat: 35.0, lng: 139.0 },
      { lat: 35.0, lng: 139.01 },
      { lat: 35.01, lng: 139.01 },
      { lat: 35.01, lng: 139.0 },
    ];
    const hole: LatLng[] = [
      { lat: 35.002, lng: 139.002 },
      { lat: 35.002, lng: 139.004 },
      { lat: 35.004, lng: 139.004 },
    ];
    const parsed = fromGeoJSONPolygon(toGeoJSONPolygon(outer, [hole]));
    expect(parsed.holes).toHaveLength(1);
    expect(parsed.holes[0]).toHaveLength(3);
  });

  it('round-trips GeoJSON -> local metres -> GeoJSON', () => {
    const frame = new LocalFrame(ORIGIN);
    const geo: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [139.767, 35.6812],
          [139.7672, 35.6812],
          [139.7672, 35.6814],
          [139.767, 35.6814],
          [139.767, 35.6812],
        ],
      ],
    };
    const back = localToGeoJSON(geoJSONToLocal(geo, frame), frame);
    const original = fromGeoJSONPolygon(geo).outer;
    const returned = fromGeoJSONPolygon(back).outer;
    expect(returned).toHaveLength(original.length);
    for (const p of original) {
      expect(
        returned.some((q) => Math.abs(q.lat - p.lat) < 1e-11 && Math.abs(q.lng - p.lng) < 1e-11),
      ).toBe(true);
    }
  });

  it('normalises to counter-clockwise winding on the way in', () => {
    const frame = new LocalFrame(ORIGIN);
    const clockwise: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [139.767, 35.6812],
          [139.767, 35.6814],
          [139.7672, 35.6814],
          [139.7672, 35.6812],
          [139.767, 35.6812],
        ],
      ],
    };
    const local = geoJSONToLocal(clockwise, frame);
    expect(polygonArea(local)).toBeGreaterThan(0);
    // ~22 m x ~22 m at this latitude.
    expect(polygonArea(local)).toBeGreaterThan(300);
    expect(polygonArea(local)).toBeLessThan(600);
  });

  it('rejects degenerate input', () => {
    expect(() => toGeoJSONPolygon([{ lat: 0, lng: 0 }])).toThrow(RangeError);
    expect(() =>
      fromGeoJSONPolygon({ type: 'Polygon', coordinates: [] } as unknown as GeoJSONPolygon),
    ).toThrow(RangeError);
  });
});
