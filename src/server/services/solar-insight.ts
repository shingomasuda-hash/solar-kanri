import { prisma } from '../db/client';
import { requirePermission } from '../auth/rbac';
import type { SessionUser } from '../auth/session';
import { recordAudit } from './audit';
import { GoogleSolarProvider, type GoogleRoofSegment } from '@core/solar/providers/google-solar';

/**
 * Roof pitch and orientation estimated from satellite imagery.
 *
 * Supplementary, never required (CLAUDE.md, Google API rule 3). Google models
 * some buildings and not others, and the platform has to stay fully usable for
 * the ones it does not — the operator draws the roof and states the pitch, and
 * everything downstream works exactly the same.
 *
 * What this gives an operator: a pitch and an azimuth they would otherwise have
 * to climb onto a roof to measure, plus a roof area to check their tracing
 * against. What it does not give: the outline. Google returns a segment's
 * centre and bounding box, not its boundary, so the tracing is still by hand.
 * Saying so plainly beats a feature that silently does half of what its name
 * suggests.
 *
 * **Billed per request**, so the result is cached on the property and a second
 * look at the same building costs nothing (rule 42). Moving the pin invalidates
 * the cache, because it is then a different building.
 */

export class SolarApiNotConfiguredError extends Error {
  constructor() {
    super(
      'Google Solar API キーが未設定です。docs/setup/google-maps.md の手順で ' +
        'GOOGLE_SOLAR_API_KEY を設定してください。屋根勾配は手動でも入力できます。',
    );
    this.name = 'SolarApiNotConfiguredError';
  }
}

export interface RoofEstimate {
  readonly pitchDeg: number;
  /** Compass degrees, 0 = north — the direction the roof face looks towards. */
  readonly azimuthDeg: number;
  readonly areaM2: number;
  readonly latitude: number;
  readonly longitude: number;
}

export interface RoofEstimateResult {
  readonly status: 'ok' | 'no-coverage' | 'unavailable';
  readonly segments: readonly RoofEstimate[];
  readonly imageryDate: string | null;
  readonly imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | null;
  /** True when this came from the stored copy rather than a billed request. */
  readonly cached: boolean;
  readonly reason?: string;
}

interface StoredInsight {
  readonly latitude: number;
  readonly longitude: number;
  readonly imageryDate: string | null;
  readonly imageryQuality: RoofEstimateResult['imageryQuality'];
  readonly segments: RoofEstimate[];
}

export function isSolarApiConfigured(): boolean {
  // `||` rather than `??`: an environment variable set to the empty string is
  // not a key, and must not shadow a usable fallback.
  return Boolean(process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY);
}

/** Metres between two points, good enough to decide "is this the same building". */
function roughDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const latM = (a.lat - b.lat) * 111_320;
  const lngM = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(latM, lngM);
}

/** Beyond this the pin has moved to a different building; the cache is void. */
const CACHE_RADIUS_M = 15;

export async function estimateRoofFromSatellite(
  user: SessionUser,
  propertyId: string,
  options: { readonly refresh?: boolean; readonly provider?: GoogleSolarProvider } = {},
): Promise<RoofEstimateResult> {
  requirePermission(user, 'project:write');

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error('物件が見つかりません / Property not found');
  if (property.latitude == null || property.longitude == null) {
    throw new Error('先に住所検索または緯度・経度の入力で位置を確定してください。');
  }
  const position = { lat: property.latitude, lng: property.longitude };

  if (!options.refresh) {
    const cached = readCache(property.solarInsight, position);
    if (cached) {
      return {
        status: 'ok',
        segments: cached.segments,
        imageryDate: cached.imageryDate,
        imageryQuality: cached.imageryQuality,
        cached: true,
      };
    }
  }

  if (!isSolarApiConfigured()) throw new SolarApiNotConfiguredError();

  const provider =
    options.provider ??
    new GoogleSolarProvider({
      apiKey: process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY,
    });

  const result = await provider.lookup({
    latitude: position.lat,
    longitude: position.lng,
  });

  if (result.status !== 'ok') {
    // Not an error: Google models some buildings and not others, and the
    // operator simply traces the roof instead.
    return {
      status: result.status,
      segments: [],
      imageryDate: null,
      imageryQuality: null,
      cached: false,
      reason: result.status === 'unavailable' ? result.reason : undefined,
    };
  }

  const segments = result.insight.roofSegments
    .map(toEstimate)
    // Largest first: it is the face worth putting panels on, so it should be
    // the one an operator sees at the top of the list.
    .sort((a, b) => b.areaM2 - a.areaM2);

  const stored: StoredInsight = {
    latitude: position.lat,
    longitude: position.lng,
    imageryDate: result.insight.imageryDate,
    imageryQuality: result.insight.imageryQuality,
    segments,
  };

  await prisma.property.update({
    where: { id: propertyId },
    data: { solarInsight: stored as never },
  });

  await recordAudit({
    userId: user.id,
    action: 'property.solarInsight.fetch',
    entityType: 'Property',
    entityId: propertyId,
    detail: {
      segments: segments.length,
      imageryQuality: result.insight.imageryQuality,
      imageryDate: result.insight.imageryDate,
    },
  });

  return {
    status: 'ok',
    segments,
    imageryDate: stored.imageryDate,
    imageryQuality: stored.imageryQuality,
    cached: false,
  };
}

function toEstimate(segment: GoogleRoofSegment): RoofEstimate {
  return {
    pitchDeg: Math.round(segment.pitchDeg * 10) / 10,
    azimuthDeg: Math.round(segment.azimuthDeg),
    areaM2: Math.round(segment.areaM2 * 10) / 10,
    latitude: segment.center.lat,
    longitude: segment.center.lng,
  };
}

/**
 * Read a stored lookup, but only if it still describes this position. Stored
 * JSON is validated structurally rather than trusted: it was written by an
 * earlier version of this code, and a shape change must not crash the page.
 */
function readCache(raw: unknown, position: { lat: number; lng: number }): StoredInsight | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as Partial<StoredInsight>;
  if (typeof stored.latitude !== 'number' || typeof stored.longitude !== 'number') return null;
  if (!Array.isArray(stored.segments)) return null;
  if (roughDistanceM({ lat: stored.latitude, lng: stored.longitude }, position) > CACHE_RADIUS_M) {
    return null;
  }

  const segments = stored.segments.filter(
    (s): s is RoofEstimate =>
      typeof s?.pitchDeg === 'number' &&
      typeof s?.azimuthDeg === 'number' &&
      typeof s?.areaM2 === 'number',
  );
  if (segments.length === 0) return null;

  return {
    latitude: stored.latitude,
    longitude: stored.longitude,
    imageryDate: typeof stored.imageryDate === 'string' ? stored.imageryDate : null,
    imageryQuality: stored.imageryQuality ?? null,
    segments,
  };
}
