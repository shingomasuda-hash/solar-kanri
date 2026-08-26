import type { IrradianceDataset, Month } from '../types';
import { MONTHS } from '../types';
import { sourced } from '../sourced';
import type { SolarDataProvider, SolarQuery } from './types';

/**
 * PVGIS (EU Joint Research Centre) non-interactive API, v5.3.
 *
 * Endpoint:  https://re.jrc.ec.europa.eu/api/v5_3/MRcalc  (monthly radiation)
 *            https://re.jrc.ec.europa.eu/api/v5_3/PVcalc  (PV performance)
 * Method:    GET only. Rate limit 30 requests/second/IP; over that the service
 *            answers 429.
 * Source:    https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en
 *
 * Azimuth convention: PVGIS `aspect` is 0 = SOUTH, negative = east,
 * positive = west. Our domain model uses compass degrees (0 = north), so the
 * conversion is `aspect = compass - 180`, wrapped to [-180, 180]. Getting this
 * backwards silently produces a north-facing yield for a south-facing roof,
 * which is why {@link compassToPvgisAspect} is unit-tested on its own.
 *
 * We use MRcalc for monthly plane-of-array irradiation and ambient temperature
 * and apply our own loss model, rather than PVcalc's built-in one: our derates
 * have to be individually sourced and auditable (rule 19), which a single
 * opaque `loss` percentage cannot be.
 */
export class PvgisProvider implements SolarDataProvider {
  readonly id = 'pvgis';
  readonly name = 'PVGIS v5.3 (EU JRC)';

  constructor(
    private readonly options: {
      readonly baseUrl?: string;
      readonly enabled?: boolean;
      readonly fetchImpl?: typeof fetch;
      readonly timeoutMs?: number;
    } = {},
  ) {}

  isAvailable(): boolean {
    return this.options.enabled !== false;
  }

  async fetch(query: SolarQuery): Promise<IrradianceDataset | null> {
    const base = this.options.baseUrl ?? 'https://re.jrc.ec.europa.eu/api/v5_3';
    const doFetch = this.options.fetchImpl ?? globalThis.fetch;
    const url = new URL(`${base}/MRcalc`);
    url.searchParams.set('lat', String(query.latitude));
    url.searchParams.set('lon', String(query.longitude));
    url.searchParams.set('angle', String(query.tiltDeg));
    url.searchParams.set('aspect', String(compassToPvgisAspect(query.azimuthDeg)));
    // Irradiation on the specified plane, plus monthly mean air temperature.
    url.searchParams.set('selectrad', '1');
    url.searchParams.set('avtemp', '1');
    url.searchParams.set('outputformat', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    let payload: PvgisMonthlyResponse;
    try {
      const res = await doFetch(url.toString(), { signal: controller.signal });
      if (res.status === 429) {
        throw new Error('PVGIS rate limit exceeded (30 req/s per IP). Back off and retry.');
      }
      if (!res.ok) {
        throw new Error(`PVGIS responded ${res.status} ${res.statusText}`);
      }
      payload = (await res.json()) as PvgisMonthlyResponse;
    } finally {
      clearTimeout(timer);
    }

    return parsePvgisMonthly(payload, query, this.id, this.name);
  }
}

/** Compass azimuth (0 = N, clockwise) to PVGIS `aspect` (0 = S). */
export function compassToPvgisAspect(compassDeg: number): number {
  let aspect = (((compassDeg % 360) + 360) % 360) - 180;
  if (aspect <= -180) aspect += 360;
  if (aspect > 180) aspect -= 360;
  return aspect;
}

/** Inverse of {@link compassToPvgisAspect}. */
export function pvgisAspectToCompass(aspect: number): number {
  return (((aspect + 180) % 360) + 360) % 360;
}

interface PvgisMonthlyRow {
  month: number;
  /** Monthly irradiation on the selected plane, kWh/m2 per month. */
  'H(i)_m'?: number;
  /** Monthly irradiation on the horizontal plane, kWh/m2 per month. */
  'H(h)_m'?: number;
  /** Monthly mean air temperature, degrees Celsius. */
  T2m?: number;
}

export interface PvgisMonthlyResponse {
  outputs?: { monthly?: PvgisMonthlyRow[] };
  inputs?: unknown;
  meta?: unknown;
}

/**
 * Convert a PVGIS response into our domain model.
 *
 * Exported and pure so it can be exercised against captured fixtures without a
 * network call — external payloads must never reach the UI unmapped (rule 17).
 */
export function parsePvgisMonthly(
  payload: PvgisMonthlyResponse,
  query: SolarQuery,
  providerId: string,
  providerName: string,
): IrradianceDataset | null {
  const rows = payload.outputs?.monthly;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const perDay = {} as Record<Month, number>;
  const temps = {} as Record<Month, number>;
  const daysInMonth: Record<number, number> = {
    1: 31,
    2: 28,
    3: 31,
    4: 30,
    5: 31,
    6: 30,
    7: 31,
    8: 31,
    9: 30,
    10: 31,
    11: 30,
    12: 31,
  };

  let isPlaneOfArray = true;
  for (const row of rows) {
    const m = row.month as Month;
    if (!MONTHS.includes(m)) continue;
    const monthly = row['H(i)_m'] ?? row['H(h)_m'];
    if (typeof monthly !== 'number' || !Number.isFinite(monthly)) continue;
    if (row['H(i)_m'] === undefined) isPlaneOfArray = false;
    perDay[m] = monthly / daysInMonth[m]!;
    temps[m] = typeof row.T2m === 'number' && Number.isFinite(row.T2m) ? row.T2m : NaN;
  }

  for (const m of MONTHS) {
    if (perDay[m] === undefined) return null;
    if (!Number.isFinite(temps[m])) {
      // Temperature is optional in some PVGIS configurations. Without it the
      // thermal derate cannot be computed, so refuse rather than invent one.
      return null;
    }
  }

  return {
    providerId,
    providerName,
    latitude: query.latitude,
    longitude: query.longitude,
    tiltDeg: query.tiltDeg,
    azimuthDeg: query.azimuthDeg,
    climate: { planeOfArrayKWhPerM2PerDay: perDay, ambientTempC: temps },
    source: sourced(`PVGIS v5.3 MRcalc @ ${query.latitude},${query.longitude}`, {
      kind: 'provider-api',
      citation: 'PVGIS v5.3 non-interactive service, MRcalc endpoint',
      url: 'https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en',
      note:
        'Irradiation is the long-term monthly mean for the selected radiation database. ' +
        'Confirm the database covers the site before relying on the result in Japan.',
    }),
    isPlaneOfArray,
  };
}
