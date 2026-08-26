'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/server/auth/service';
import { UnauthenticatedError } from '@/server/auth/rbac';
import { toFormState, type FormState } from '@/server/form-state';
import { prisma } from '@/server/db/client';
import {
  computeAndSaveLayout,
  deleteExclusionZone,
  deleteRoofFace,
  saveExclusionZone,
  saveRoofFace,
} from '@/server/services/design';
import { runSimulation, SimulationBlockedError } from '@/server/services/simulation';
import { geocodeAddress, GeocodingNotConfiguredError } from '@/server/services/geocoding';
import { recordAudit } from '@/server/services/audit';

export type { FormState };

/** Parse a pasted GeoJSON polygon, with messages an operator can act on. */
function parsePolygonText(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('座標が JSON として読み取れません。GeoJSON Polygon を貼り付けてください。');
  }
  const obj = parsed as { type?: unknown; geometry?: unknown };
  // Accept a bare geometry or a Feature wrapper — both are what people paste.
  if (obj?.type === 'Feature' && obj.geometry) return obj.geometry;
  return parsed;
}

export async function saveRoofFaceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();

    const pitchRaw = String(formData.get('pitchDeg') ?? '').trim();
    await saveRoofFace(
      user,
      {
        propertyId: String(formData.get('propertyId') ?? ''),
        label: String(formData.get('label') ?? '屋根面'),
        outline: parsePolygonText(String(formData.get('outline') ?? '')) as never,
        pitchDeg: pitchRaw === '' ? null : Number(pitchRaw),
        azimuthDeg: Number(formData.get('azimuthDeg') ?? 180),
        pitchSource: (pitchRaw === ''
          ? 'UNKNOWN'
          : String(formData.get('pitchSource') ?? 'ASSUMED')) as never,
        setbackM: Number(formData.get('setbackM') ?? 0.3),
        panelGapM: Number(formData.get('panelGapM') ?? 0.02),
      },
      String(formData.get('id') ?? '') || undefined,
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/design`);
  return {};
}

export async function deleteRoofFaceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await deleteRoofFace(user, String(formData.get('id') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/design`);
  return {};
}

export async function saveExclusionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await saveExclusionZone(user, {
      roofFaceId: String(formData.get('roofFaceId') ?? ''),
      kind: String(formData.get('kind') ?? 'OTHER'),
      label: formData.get('label'),
      outline: parsePolygonText(String(formData.get('outline') ?? '')),
      clearanceM: Number(formData.get('clearanceM') ?? 0.3),
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/design`);
  return {};
}

export async function deleteExclusionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    await deleteExclusionZone(user, String(formData.get('id') ?? ''));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/design`);
  return {};
}

export interface LayoutState extends FormState {
  readonly summary?: {
    /** Which face the summary describes, so a stale banner can be detected. */
    roofFaceId: string;
    panelCount: number;
    installedKw: number;
    orientation: string | null;
    angleDeg: number;
    usableAreaM2: number;
    roofAreaM2: number;
    warnings: string[];
  };
}

export async function computeLayoutAction(
  _prev: LayoutState,
  formData: FormData,
): Promise<LayoutState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const result = await computeAndSaveLayout(
      user,
      String(formData.get('roofFaceId') ?? ''),
      String(formData.get('panelModelId') ?? ''),
    );
    revalidatePath(`/projects/${projectId}/design`);
    return {
      summary: {
        roofFaceId: result.roofFaceId,
        panelCount: result.panelCount,
        installedKw: result.installedKw,
        orientation: result.orientation,
        angleDeg: result.angleDeg,
        usableAreaM2: result.usableAreaM2,
        roofAreaM2: result.roofAreaM2,
        warnings: [...result.warnings],
      },
    };
  } catch (err) {
    return toFormState(err);
  }
}

export async function geocodeAction(
  _prev: FormState,
  formData: FormData,
): Promise<
  FormState & {
    results?: { formattedAddress: string; latitude: number; longitude: number }[];
  }
> {
  const address = String(formData.get('address') ?? '').trim();
  const propertyId = String(formData.get('propertyId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (!address) return { error: '住所を入力してください' };

  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();

    const results = await geocodeAddress(address);
    if (results.length === 0) {
      return { error: '該当する住所が見つかりませんでした。表記を変えてお試しください。' };
    }
    const best = results[0]!;

    if (propertyId) {
      await prisma.property.update({
        where: { id: propertyId },
        data: {
          latitude: best.latitude,
          longitude: best.longitude,
          geocodedAt: new Date(),
          geocodeFormattedAddress: best.formattedAddress,
        },
      });
      await recordAudit({
        userId: user.id,
        action: 'property.geocode',
        entityType: 'Property',
        entityId: propertyId,
        detail: { address, resolved: best.formattedAddress },
      });
      revalidatePath(`/projects/${projectId}/design`);
    }
    return { results };
  } catch (err) {
    if (err instanceof GeocodingNotConfiguredError) return { error: err.message };
    return toFormState(err);
  }
}

/** Set the site position by hand, for when geocoding is unavailable or wrong. */
export async function setPositionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const latitude = Number(formData.get('latitude'));
    const longitude = Number(formData.get('longitude'));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('緯度は -90 〜 90 の数値で入力してください');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('経度は -180 〜 180 の数値で入力してください');
    }
    await prisma.property.update({
      where: { id: String(formData.get('propertyId') ?? '') },
      data: { latitude, longitude, geocodedAt: new Date() },
    });
    await recordAudit({
      userId: user.id,
      action: 'property.position.manual',
      entityType: 'Property',
      entityId: String(formData.get('propertyId') ?? ''),
      detail: { latitude, longitude },
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/projects/${projectId}/design`);
  return {};
}

export interface SimulationState extends FormState {
  readonly simulationId?: string;
  readonly blockedFields?: string[];
}

export async function runSimulationAction(
  _prev: SimulationState,
  formData: FormData,
): Promise<SimulationState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await getCurrentUser();
    if (!user) throw new UnauthenticatedError();
    const layoutIds = formData.getAll('layoutIds').map(String).filter(Boolean);
    const { simulation } = await runSimulation(user, {
      projectId,
      layoutIds,
      mounting: (String(formData.get('mounting') ?? 'roof-flush') || 'roof-flush') as never,
      annualConsumptionKWh: Number(formData.get('annualConsumptionKWh') ?? 5000),
      totalCostJpy: Math.round(Number(formData.get('totalCostJpy') ?? 0)),
      subsidyJpy: Math.round(Number(formData.get('subsidyJpy') ?? 0)),
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/design`);
    return { simulationId: simulation.id };
  } catch (err) {
    if (err instanceof SimulationBlockedError) {
      return { error: err.message, blockedFields: [...err.missing] };
    }
    return toFormState(err);
  }
}
