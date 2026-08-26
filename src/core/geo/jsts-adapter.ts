/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The ONLY module allowed to touch JSTS directly.
 *
 * JSTS (a port of JTS) gives us numerically robust planar buffer and overlay
 * operations. It operates on plain planar coordinates, which is exactly what
 * we have after {@link LocalFrame} conversion — do not feed it degrees.
 *
 * Everything crosses this boundary as our own {@link Polygon2D} types so the
 * rest of the codebase never depends on the library's object model.
 */
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
// Side-effect import: JSTS attaches union/difference/intersection/isValid to
// Geometry.prototype here rather than defining them on the class itself.
import 'jsts/org/locationtech/jts/monkey.js';

import type { MultiPolygon2D, Point2D, Polygon2D, Ring2D } from './types';
import { ensureCCW, polygonArea } from './polygon';

const reader = new (GeoJSONReader as any)();
const writer = new (GeoJSONWriter as any)();

type Geom = any;

/** Join style for buffering. Mitre keeps rectangular roofs rectangular. */
export type JoinStyle = 'mitre' | 'round' | 'bevel';

function joinStyleCode(style: JoinStyle): number {
  switch (style) {
    case 'round':
      return (BufferParameters as any).JOIN_ROUND;
    case 'bevel':
      return (BufferParameters as any).JOIN_BEVEL;
    case 'mitre':
    default:
      return (BufferParameters as any).JOIN_MITRE;
  }
}

function ringToCoords(ring: Ring2D): number[][] {
  const pts = ring.map((p) => [p.x, p.y]);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0]!, first[1]!]);
  return pts;
}

function toGeoJSON(poly: Polygon2D): { type: 'Polygon'; coordinates: number[][][] } {
  return {
    type: 'Polygon',
    coordinates: [ringToCoords(ensureCCW(poly.outer)), ...poly.holes.map((h) => ringToCoords(h))],
  };
}

function coordsToRing(coords: number[][]): Point2D[] {
  const ring: Point2D[] = coords.map((c) => ({ x: c[0]!, y: c[1]! }));
  // GeoJSON rings repeat the first vertex; our Ring2D does not.
  if (ring.length > 1) {
    const a = ring[0]!;
    const b = ring[ring.length - 1]!;
    if (a.x === b.x && a.y === b.y) ring.pop();
  }
  return ring;
}

function fromGeoJSON(geo: any): MultiPolygon2D {
  if (!geo) return [];
  if (geo.type === 'Polygon') {
    const rings = geo.coordinates as number[][][];
    if (rings.length === 0) return [];
    const outer = coordsToRing(rings[0]!);
    if (outer.length < 3) return [];
    return [
      {
        outer,
        holes: rings
          .slice(1)
          .map(coordsToRing)
          .filter((r) => r.length >= 3),
      },
    ];
  }
  if (geo.type === 'MultiPolygon') {
    const out: Polygon2D[] = [];
    for (const rings of geo.coordinates as number[][][][]) {
      if (rings.length === 0) continue;
      const outer = coordsToRing(rings[0]!);
      if (outer.length < 3) continue;
      out.push({
        outer,
        holes: rings
          .slice(1)
          .map(coordsToRing)
          .filter((r) => r.length >= 3),
      });
    }
    return out;
  }
  if (geo.type === 'GeometryCollection') {
    return (geo.geometries as any[]).flatMap((g) => fromGeoJSON(g));
  }
  return [];
}

function readPolygon(poly: Polygon2D): Geom {
  return reader.read(toGeoJSON(poly));
}

function readMulti(polys: MultiPolygon2D): Geom | null {
  const geoms = polys.map(readPolygon);
  if (geoms.length === 0) return null;
  let acc: Geom = geoms[0];
  for (let i = 1; i < geoms.length; i++) acc = acc.union(geoms[i]);
  return acc;
}

function writeGeom(g: Geom): MultiPolygon2D {
  if (!g || g.isEmpty()) return [];
  return fromGeoJSON(writer.write(g)).filter((p) => polygonArea(p) > 1e-9);
}

/**
 * Offset a polygon by `distance` metres. Negative shrinks (setback), positive
 * grows (clearance). May return zero polygons (fully consumed) or several
 * (a concave roof can split when eroded).
 */
export function bufferPolygon(
  poly: Polygon2D,
  distance: number,
  joinStyle: JoinStyle = 'mitre',
): MultiPolygon2D {
  if (distance === 0) return [poly];
  const params = new (BufferParameters as any)();
  params.setJoinStyle(joinStyleCode(joinStyle));
  // A generous mitre limit keeps acute roof corners sharp instead of bevelled,
  // but is capped so needle-thin corners cannot shoot off to infinity.
  params.setMitreLimit(5.0);
  params.setQuadrantSegments(16);
  const result = (BufferOp as any).bufferOp(readPolygon(poly), distance, params);
  return writeGeom(result);
}

export function bufferMulti(
  polys: MultiPolygon2D,
  distance: number,
  joinStyle: JoinStyle = 'mitre',
): MultiPolygon2D {
  return polys.flatMap((p) => bufferPolygon(p, distance, joinStyle));
}

/** Boolean union. */
export function union(polys: MultiPolygon2D): MultiPolygon2D {
  const g = readMulti(polys);
  return g ? writeGeom(g) : [];
}

/** Boolean difference: `subject` minus `cutters`. */
export function difference(subject: MultiPolygon2D, cutters: MultiPolygon2D): MultiPolygon2D {
  if (subject.length === 0) return [];
  if (cutters.length === 0) return [...subject];
  const s = readMulti(subject)!;
  const c = readMulti(cutters)!;
  return writeGeom(s.difference(c));
}

/** Boolean intersection. */
export function intersection(a: MultiPolygon2D, b: MultiPolygon2D): MultiPolygon2D {
  if (a.length === 0 || b.length === 0) return [];
  return writeGeom(readMulti(a)!.intersection(readMulti(b)!));
}

export function intersectionArea(a: MultiPolygon2D, b: MultiPolygon2D): number {
  return intersection(a, b).reduce((sum, p) => sum + polygonArea(p), 0);
}

const geometryFactory = new (GeometryFactory as any)();

/**
 * Repair self-intersecting input — a routine result of freehand map drawing.
 *
 * Deliberately NOT `buffer(0)`, the usual JTS shortcut: on a bow-tie it keeps
 * only the counter-clockwise lobe and silently discards the other half of the
 * roof. Instead we node the ring against itself and re-polygonize, which keeps
 * every enclosed area. A bow-tie comes back as two triangles, so the operator
 * sees the whole shape they drew and can correct it.
 */
export function makeValid(poly: Polygon2D): MultiPolygon2D {
  const g = readPolygon(poly);
  if (g.isValid()) return writeGeom(g);

  const out: Polygon2D[] = [];
  const rings: Geom[] = [g.getExteriorRing()];
  for (let i = 0; i < g.getNumInteriorRing(); i++) rings.push(g.getInteriorRingN(i));

  for (const ring of rings) {
    const line = geometryFactory.createLineString(ring.getCoordinates());
    // Unioning with a point on the line forces JTS to node self-intersections.
    const noded = line.union(geometryFactory.createPoint(line.getCoordinateN(0)));
    const polygonizer = new (Polygonizer as any)();
    polygonizer.add(noded);
    const collection = polygonizer.getPolygons();
    for (let it = collection.iterator(); it.hasNext();) {
      out.push(...writeGeom(it.next()));
    }
  }
  return out.filter((p) => polygonArea(p) > 1e-9);
}

export function isValidPolygon(poly: Polygon2D): boolean {
  try {
    return readPolygon(poly).isValid();
  } catch {
    return false;
  }
}
