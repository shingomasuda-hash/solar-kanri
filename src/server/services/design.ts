import { prisma } from '../db/client';
import { requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import { exclusionZoneSchema, roofFaceSchema, type RoofFaceInput } from '../validation/schemas';
import { polygonArea } from '@core/geo';
import {
  computeLayout,
  LAYOUT_ENGINE_VERSION,
  type LayoutResult,
  type PanelSpec,
} from '@core/layout';
import {
  buildRoofGeometry,
  deserialisePlacements,
  geometryFromStored,
  placementsToGeoJSON,
  serialisePlacements,
  type RoofGeometry,
} from './geometry-bridge';

/**
 * Roof drawing and panel layout.
 *
 * Layout always runs on the server: the browser result would be advisory only
 * and a client could send back any placement it liked. The engine is
 * deterministic, so the server recomputing gives the same answer the operator
 * saw, and the saved layout is one the server has proved.
 */

export async function saveRoofFace(user: SessionUser, input: RoofFaceInput, id?: string) {
  requirePermission(user, 'project:write');
  const data = roofFaceSchema.parse(input);

  const geometry = buildRoofGeometry(
    {
      outline: data.outline,
      pitchDeg: data.pitchDeg ?? null,
      azimuthDeg: data.azimuthDeg,
      pitchSource: data.pitchSource,
    },
    [],
  );

  const projectedAreaM2 = polygonArea(geometry.projected);
  if (projectedAreaM2 <= 0) {
    throw new Error('屋根の面積がゼロです。図形を確認してください。');
  }

  const values = {
    propertyId: data.propertyId,
    label: data.label,
    outline: data.outline as never,
    pitchDeg: data.pitchDeg ?? null,
    azimuthDeg: data.azimuthDeg,
    pitchSource: data.pitchSource,
    setbackM: data.setbackM,
    panelGapM: data.panelGapM,
    projectedAreaM2,
    surfaceAreaM2: geometry.surfaceAreaM2,
  };

  const face = id
    ? await prisma.roofFace.update({ where: { id }, data: values })
    : await prisma.roofFace.create({ data: values });

  await recordAudit({
    userId: user.id,
    action: id ? 'roofFace.update' : 'roofFace.create',
    entityType: 'RoofFace',
    entityId: face.id,
    detail: {
      label: face.label,
      projectedAreaM2,
      surfaceAreaM2: geometry.surfaceAreaM2,
      pitchSource: face.pitchSource,
    },
  });

  // A saved edit invalidates any layout computed from the old outline. Silently
  // keeping a stale panel count against a changed roof would be worse than
  // making the operator re-run it.
  if (id) {
    const removed = await prisma.layout.deleteMany({ where: { roofFaceId: id } });
    if (removed.count > 0) {
      await recordAudit({
        userId: user.id,
        action: 'layout.invalidated',
        entityType: 'RoofFace',
        entityId: id,
        detail: { reason: 'roof outline changed', removed: removed.count },
      });
    }
  }

  return face;
}

export async function deleteRoofFace(user: SessionUser, id: string): Promise<void> {
  requirePermission(user, 'project:write');
  const face = await prisma.roofFace.findUnique({ where: { id } });
  if (!face) return;
  await prisma.roofFace.delete({ where: { id } });
  await recordAudit({
    userId: user.id,
    action: 'roofFace.delete',
    entityType: 'RoofFace',
    entityId: id,
    detail: { label: face.label },
  });
}

export async function saveExclusionZone(user: SessionUser, input: unknown, id?: string) {
  requirePermission(user, 'project:write');
  const data = exclusionZoneSchema.parse(input);

  const values = {
    roofFaceId: data.roofFaceId,
    kind: data.kind,
    label: data.label ?? null,
    outline: data.outline as never,
    clearanceM: data.clearanceM,
  };

  const zone = id
    ? await prisma.exclusionZone.update({ where: { id }, data: values })
    : await prisma.exclusionZone.create({ data: values });

  await prisma.layout.deleteMany({ where: { roofFaceId: data.roofFaceId } });
  await recordAudit({
    userId: user.id,
    action: id ? 'exclusionZone.update' : 'exclusionZone.create',
    entityType: 'ExclusionZone',
    entityId: zone.id,
    detail: { kind: zone.kind, clearanceM: zone.clearanceM },
  });
  return zone;
}

export async function deleteExclusionZone(user: SessionUser, id: string): Promise<void> {
  requirePermission(user, 'project:write');
  const zone = await prisma.exclusionZone.findUnique({ where: { id } });
  if (!zone) return;
  await prisma.exclusionZone.delete({ where: { id } });
  await prisma.layout.deleteMany({ where: { roofFaceId: zone.roofFaceId } });
  await recordAudit({
    userId: user.id,
    action: 'exclusionZone.delete',
    entityType: 'ExclusionZone',
    entityId: id,
  });
}

export interface LayoutSummary {
  readonly layoutId: string;
  readonly roofFaceId: string;
  readonly roofFaceLabel: string;
  readonly panelCount: number;
  readonly installedKw: number;
  readonly orientation: string | null;
  readonly angleDeg: number;
  readonly usableAreaM2: number;
  readonly roofAreaM2: number;
  readonly usableCoverageRatio: number;
  readonly panelPolygons: unknown[];
  readonly roofPolygon: unknown;
  readonly usablePolygons: unknown[];
  readonly warnings: readonly string[];
  readonly isFlatAssumption: boolean;
}

/**
 * Run the placement engine for one roof face and persist the result.
 */
export async function computeAndSaveLayout(
  user: SessionUser,
  roofFaceId: string,
  panelModelId: string,
): Promise<LayoutSummary> {
  requirePermission(user, 'project:write');

  const face = await prisma.roofFace.findUnique({
    where: { id: roofFaceId },
    include: { exclusionZones: true },
  });
  if (!face) throw new Error('屋根面が見つかりません / Roof face not found');

  const panel = await prisma.panelModel.findUnique({ where: { id: panelModelId } });
  if (!panel) throw new Error('パネルが見つかりません / Panel model not found');
  if (!panel.isActive) throw new Error('選択されたパネルは無効化されています');

  const geometry = buildRoofGeometry(face, face.exclusionZones);
  const panelSpec: PanelSpec = {
    id: panel.id,
    widthMm: panel.widthMm,
    heightMm: panel.heightMm,
    ratedPowerW: panel.ratedPowerW,
  };

  const result: LayoutResult = computeLayout({
    roof: geometry.onPlane,
    exclusions: geometry.exclusionsOnPlane,
    panel: panelSpec,
    constraints: {
      setbackM: face.setbackM,
      panelGapM: face.panelGapM,
      // Each zone was already grown by its own clearance in buildRoofGeometry,
      // so the engine's global clearance must be zero or it would double-count.
      exclusionClearanceM: 0,
      allowedOrientations: ['portrait', 'landscape'],
    },
  });

  const saved = await prisma.layout.upsert({
    where: { id: (await existingLayoutId(roofFaceId, panelModelId)) ?? '__none__' },
    update: {
      algorithmVersion: result.algorithmVersion,
      placements: serialisePlacements(result.placements, geometry) as never,
      panelCount: result.panelCount,
      installedW: Math.round(result.installedKw * 1000),
      orientation: result.orientation,
      angleDeg: result.angleDeg,
      usableAreaM2: result.usable.areaM2,
      isManuallyEdited: false,
      engineMeta: { stats: result.stats, warnings: result.warnings } as never,
    },
    create: {
      roofFaceId,
      panelModelId,
      algorithmVersion: result.algorithmVersion,
      placements: serialisePlacements(result.placements, geometry) as never,
      panelCount: result.panelCount,
      installedW: Math.round(result.installedKw * 1000),
      orientation: result.orientation,
      angleDeg: result.angleDeg,
      usableAreaM2: result.usable.areaM2,
      engineMeta: { stats: result.stats, warnings: result.warnings } as never,
    },
  });

  await recordAudit({
    userId: user.id,
    action: 'layout.compute',
    entityType: 'Layout',
    entityId: saved.id,
    detail: {
      roofFaceId,
      panelModelId,
      panelCount: result.panelCount,
      installedKw: result.installedKw,
      algorithmVersion: LAYOUT_ENGINE_VERSION,
    },
  });

  return summarise(saved.id, face.id, face.label, result, geometry);
}

async function existingLayoutId(roofFaceId: string, panelModelId: string) {
  const existing = await prisma.layout.findFirst({
    where: { roofFaceId, panelModelId },
    select: { id: true },
  });
  return existing?.id;
}

function summarise(
  layoutId: string,
  roofFaceId: string,
  roofFaceLabel: string,
  result: LayoutResult,
  geometry: RoofGeometry,
): LayoutSummary {
  return {
    layoutId,
    roofFaceId,
    roofFaceLabel,
    panelCount: result.panelCount,
    installedKw: result.installedKw,
    orientation: result.orientation,
    angleDeg: result.angleDeg,
    usableAreaM2: result.usable.areaM2,
    roofAreaM2: result.usable.roofAreaM2,
    usableCoverageRatio: result.usableCoverageRatio,
    panelPolygons: placementsToGeoJSON(result.placements, geometry),
    roofPolygon: geometryToGeoJSON(geometry),
    usablePolygons: result.usable.region.map((poly) => placementsRegionToGeoJSON(poly, geometry)),
    warnings: [
      ...result.warnings,
      ...(geometry.plane.isFlatAssumption
        ? [
            'PITCH_UNKNOWN: 屋根勾配が未設定のため、水平面として計算しています。' +
              '実際の傾斜がある場合、枚数と発電量は変わります。',
          ]
        : []),
    ],
    isFlatAssumption: geometry.plane.isFlatAssumption,
  };
}

function geometryToGeoJSON(geometry: RoofGeometry): unknown {
  const ring = geometry.projected.outer.map((p) => geometry.frame.toLatLng(p));
  const coords = ring.map((p) => [p.lng, p.lat]);
  if (coords.length > 0) coords.push([coords[0]![0]!, coords[0]![1]!]);
  return { type: 'Polygon', coordinates: [coords] };
}

function placementsRegionToGeoJSON(
  poly: {
    outer: readonly { x: number; y: number }[];
    holes: readonly (readonly { x: number; y: number }[])[];
  },
  geometry: RoofGeometry,
): unknown {
  const ringToCoords = (ring: readonly { x: number; y: number }[]) => {
    // The usable region is computed on the roof plane; project it back for display.
    const coords = ring
      .map((p) => geometry.plane.toHorizontal({ u: p.x, v: p.y }))
      .map((p) => geometry.frame.toLatLng(p))
      .map((p) => [p.lng, p.lat]);
    if (coords.length > 0) coords.push([coords[0]![0]!, coords[0]![1]!]);
    return coords;
  };
  return {
    type: 'Polygon',
    coordinates: [ringToCoords(poly.outer), ...poly.holes.map(ringToCoords)],
  };
}

/**
 * Redraw a saved layout as panel outlines in WGS84.
 *
 * The stored form keeps the frame origin and the roof plane alongside the
 * placements precisely so this can be done without re-running the engine, and
 * the result is identical to what the operator saw when they placed them.
 *
 * Returns an empty array rather than throwing on a row it cannot read: a
 * layout saved by an older version should cost the operator its picture, not
 * the whole design screen.
 */
export function storedLayoutPolygons(placements: unknown): unknown[] {
  try {
    const stored = deserialisePlacements(placements);
    return placementsToGeoJSON(stored.placements, geometryFromStored(stored));
  } catch {
    return [];
  }
}

export async function listPanelModels() {
  return prisma.panelModel.findMany({
    where: { isActive: true },
    orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }],
  });
}
