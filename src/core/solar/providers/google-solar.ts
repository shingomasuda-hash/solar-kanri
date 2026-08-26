import type { LatLng } from '../../geo/types';
import type { SolarQuery } from './types';

/**
 * Google Solar API adapter.
 *
 * Deliberately NOT a {@link SolarDataProvider}: Google returns building models
 * and annual flux, not the monthly irradiance-plus-temperature series our
 * engine needs. It is used as *supplementary* data — a starting roof outline, a
 * pitch and azimuth estimate, a sanity check on our own number — and the
 * platform must remain fully usable when it returns nothing (rule 17).
 *
 * Every response is mapped into our own domain types here. Raw Google payloads
 * never reach the UI, so a change on their side cannot reshape our screens.
 *
 * API reference: https://developers.google.com/maps/documentation/solar
 */
export interface GoogleSolarBuildingInsight {
  readonly center: LatLng;
  readonly imageryDate: string | null;
  readonly imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  readonly maxArrayPanelCount: number | null;
  readonly maxArrayAreaM2: number | null;
  readonly maxSunshineHoursPerYear: number | null;
  readonly roofSegments: readonly GoogleRoofSegment[];
}

export interface GoogleRoofSegment {
  readonly pitchDeg: number;
  /** Compass degrees, 0 = north. */
  readonly azimuthDeg: number;
  readonly areaM2: number;
  readonly center: LatLng;
}

export type GoogleSolarLookupResult =
  | { readonly status: 'ok'; readonly insight: GoogleSolarBuildingInsight }
  | { readonly status: 'no-coverage' }
  | { readonly status: 'unavailable'; readonly reason: string };

export class GoogleSolarProvider {
  readonly id = 'google-solar';
  readonly name = 'Google Solar API';

  constructor(
    private readonly options: {
      readonly apiKey?: string;
      readonly baseUrl?: string;
      readonly fetchImpl?: typeof fetch;
      readonly timeoutMs?: number;
    } = {},
  ) {}

  isAvailable(): boolean {
    return Boolean(this.options.apiKey);
  }

  /**
   * Look up building insights for a point. Never throws for the ordinary
   * "Google does not model this building" case — that is a normal outcome and
   * the operator simply draws the roof by hand.
   */
  async lookup(query: Pick<SolarQuery, 'latitude' | 'longitude'>): Promise<GoogleSolarLookupResult> {
    if (!this.options.apiKey) {
      return { status: 'unavailable', reason: 'GOOGLE_SOLAR_API_KEY is not configured' };
    }
    const base = this.options.baseUrl ?? 'https://solar.googleapis.com/v1';
    const doFetch = this.options.fetchImpl ?? globalThis.fetch;
    const url = new URL(`${base}/buildingInsights:findClosest`);
    url.searchParams.set('location.latitude', String(query.latitude));
    url.searchParams.set('location.longitude', String(query.longitude));
    url.searchParams.set('requiredQuality', 'LOW');
    url.searchParams.set('key', this.options.apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const res = await doFetch(url.toString(), { signal: controller.signal });
      if (res.status === 404) return { status: 'no-coverage' };
      if (!res.ok) {
        return { status: 'unavailable', reason: `Google Solar responded ${res.status}` };
      }
      const raw: unknown = await res.json();
      const insight = mapBuildingInsight(raw);
      return insight ? { status: 'ok', insight } : { status: 'no-coverage' };
    } catch (err) {
      return {
        status: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Map a raw Google payload onto our domain model. Pure, so it is testable. */
export function mapBuildingInsight(raw: unknown): GoogleSolarBuildingInsight | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const center = asLatLng(r.center);
  if (!center) return null;

  const potential = (r.solarPotential ?? {}) as Record<string, unknown>;
  const segments = Array.isArray(potential.roofSegmentStats)
    ? (potential.roofSegmentStats as Record<string, unknown>[])
    : [];

  return {
    center,
    imageryDate: formatDate(r.imageryDate),
    imageryQuality: asQuality(r.imageryQuality),
    maxArrayPanelCount: asNumber(potential.maxArrayPanelsCount),
    maxArrayAreaM2: asNumber(potential.maxArrayAreaMeters2),
    maxSunshineHoursPerYear: asNumber(potential.maxSunshineHoursPerYear),
    roofSegments: segments.flatMap((s) => {
      const c = asLatLng(s.center);
      const pitch = asNumber(s.pitchDegrees);
      const azimuth = asNumber(s.azimuthDegrees);
      const area = asNumber((s.stats as Record<string, unknown> | undefined)?.areaMeters2);
      if (!c || pitch === null || azimuth === null) return [];
      return [{ pitchDeg: pitch, azimuthDeg: azimuth, areaM2: area ?? 0, center: c }];
    }),
  };
}

function asLatLng(v: unknown): LatLng | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const lat = asNumber(o.latitude);
  const lng = asNumber(o.longitude);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asQuality(v: unknown): GoogleSolarBuildingInsight['imageryQuality'] {
  return v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' ? v : 'UNKNOWN';
}

function formatDate(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const y = asNumber(d.year);
  const m = asNumber(d.month);
  const day = asNumber(d.day);
  if (y === null || m === null || day === null) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
