import {
  LocalFrame,
  RoofPlane,
  bufferPolygon,
  centroid,
  geoJSONToLocal,
  localToGeoJSON,
  polygonArea,
  rectCorners,
  type GeoJSONPolygon,
  type LatLng,
  type Polygon2D,
  type RoofPlaneSpec,
} from '@core/geo';
import type { PanelPlacement } from '@core/layout/types';

/**
 * The single place where stored geometry becomes engine geometry.
 *
 * Storage is WGS84 GeoJSON; the engines work in local metres and, for layout,
 * on the roof plane. Keeping every conversion here means the frame origin is
 * derived the same way everywhere — if it were computed ad hoc per call site,
 * two features could silently disagree about where (0, 0) is.
 */

export interface RoofGeometry {
  readonly frame: LocalFrame;
  readonly plane: RoofPlane;
  /** Roof outline in local metres (horizontal projection). */
  readonly projected: Polygon2D;
  /** Roof outline in roof-plane metres (x = u cross-slope, y = v up-slope). */
  readonly onPlane: Polygon2D;
  readonly exclusionsProjected: readonly Polygon2D[];
  /**
   * Exclusions on the roof plane, each already grown by its OWN clearance.
   *
   * The layout engine takes a single global clearance, but a skylight and a
   * maintenance walkway legitimately need different keep-outs. Applying each
   * zone's clearance here and passing 0 to the engine keeps both facts true.
   */
  readonly exclusionsOnPlane: readonly Polygon2D[];
  readonly projectedAreaM2: number;
  readonly surfaceAreaM2: number;
}

export interface StoredRoofFace {
  readonly outline: unknown;
  readonly pitchDeg: number | null;
  readonly azimuthDeg: number;
  readonly pitchSource: 'MEASURED' | 'PROVIDER' | 'ASSUMED' | 'UNKNOWN';
}

export interface StoredExclusion {
  readonly outline: unknown;
  /** Extra keep-out around this zone, metres. */
  readonly clearanceM: number;
}

export class InvalidGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGeometryError';
  }
}

export function asGeoJSONPolygon(value: unknown): GeoJSONPolygon {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { type?: unknown }).type !== 'Polygon' ||
    !Array.isArray((value as { coordinates?: unknown }).coordinates)
  ) {
    throw new InvalidGeometryError('保存された図形が GeoJSON Polygon ではありません');
  }
  return value as GeoJSONPolygon;
}

/** The reference point for the local frame: the roof outline's centroid. */
export function frameOriginFor(outline: GeoJSONPolygon): LatLng {
  const ring = outline.coordinates[0];
  if (!ring || ring.length < 3) {
    throw new InvalidGeometryError('屋根の外周に3点以上必要です');
  }
  // Centroid in degrees is only used to pin the frame; sub-metre placement of
  // the origin has no effect on results, so the cheap version is correct here.
  const pts = ring.map(([lng, lat]) => ({ x: lng, y: lat }));
  const c = centroid(pts);
  return { lat: c.y, lng: c.x };
}

export function buildRoofGeometry(
  face: StoredRoofFace,
  exclusions: readonly StoredExclusion[],
): RoofGeometry {
  const outline = asGeoJSONPolygon(face.outline);
  const frame = new LocalFrame(frameOriginFor(outline));

  const spec: RoofPlaneSpec = {
    pitchDeg: face.pitchDeg,
    azimuthDeg: face.azimuthDeg,
    pitchSource:
      face.pitchSource === 'MEASURED'
        ? 'measured'
        : face.pitchSource === 'PROVIDER'
          ? 'provider'
          : face.pitchSource === 'ASSUMED'
            ? 'assumed'
            : 'unknown',
  };
  const plane = new RoofPlane(spec);

  const projected = geoJSONToLocal(outline, frame);
  const exclusionsProjected = exclusions.map((z) =>
    geoJSONToLocal(asGeoJSONPolygon(z.outline), frame),
  );

  // Grow each zone by its own clearance, on the roof plane where the distance
  // is a real surface distance rather than a projected one. Rounded joins,
  // because a keep-out radius around an obstacle is genuinely circular at the
  // corners — a mitre would claim clearance the installer does not have.
  const exclusionsOnPlane = exclusionsProjected.flatMap((poly, i) => {
    const onPlane = plane.polygonToRoof(poly);
    const clearance = exclusions[i]?.clearanceM ?? 0;
    return clearance > 0 ? bufferPolygon(onPlane, clearance, 'round') : [onPlane];
  });

  const projectedAreaM2 = polygonArea(projected);

  return {
    frame,
    plane,
    projected,
    onPlane: plane.polygonToRoof(projected),
    exclusionsProjected,
    exclusionsOnPlane,
    projectedAreaM2,
    surfaceAreaM2: projectedAreaM2 * plane.slopeFactor,
  };
}

/**
 * Project a placement from roof-plane metres back to WGS84 for map display.
 *
 * Every module becomes a four-corner GeoJSON polygon, so the map layer never
 * needs to know anything about roof planes or local frames.
 */
export function placementToGeoJSON(
  placement: PanelPlacement,
  geometry: Pick<RoofGeometry, 'frame' | 'plane'>,
): GeoJSONPolygon {
  const cornersOnPlane = rectCorners(placement.rect);
  const cornersProjected = cornersOnPlane.map((p) =>
    geometry.plane.toHorizontal({ u: p.x, v: p.y }),
  );
  return localToGeoJSON({ outer: cornersProjected, holes: [] }, geometry.frame);
}

export function placementsToGeoJSON(
  placements: readonly PanelPlacement[],
  geometry: Pick<RoofGeometry, 'frame' | 'plane'>,
): GeoJSONPolygon[] {
  return placements.map((p) => placementToGeoJSON(p, geometry));
}

/** Serialisable form of a saved layout, so it can be redrawn without re-running. */
export interface StoredPlacements {
  readonly frameOrigin: LatLng;
  readonly pitchDeg: number | null;
  readonly azimuthDeg: number;
  readonly placements: readonly PanelPlacement[];
}

export function serialisePlacements(
  placements: readonly PanelPlacement[],
  geometry: RoofGeometry,
): StoredPlacements {
  return {
    frameOrigin: geometry.frame.origin,
    pitchDeg: geometry.plane.spec.pitchDeg,
    azimuthDeg: geometry.plane.azimuthDeg,
    placements: placements.map((p) => ({ ...p })),
  };
}

export function deserialisePlacements(value: unknown): StoredPlacements {
  if (!value || typeof value !== 'object') {
    throw new InvalidGeometryError('保存されたパネル配置を読み取れません');
  }
  const v = value as StoredPlacements;
  if (!Array.isArray(v.placements) || !v.frameOrigin) {
    throw new InvalidGeometryError('保存されたパネル配置の形式が不正です');
  }
  return v;
}

/** Rebuild the frame and plane a stored layout was computed in. */
export function geometryFromStored(
  stored: StoredPlacements,
): Pick<RoofGeometry, 'frame' | 'plane'> {
  return {
    frame: new LocalFrame(stored.frameOrigin),
    plane: new RoofPlane({
      pitchDeg: stored.pitchDeg,
      azimuthDeg: stored.azimuthDeg,
      pitchSource: stored.pitchDeg === null ? 'unknown' : 'measured',
    }),
  };
}
