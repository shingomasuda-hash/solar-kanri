import type { IrradianceDataset, MonthlyClimate } from '../types';
import { MONTHS } from '../types';
import { sourced, type CoefficientSource } from '../sourced';
import type { SolarDataProvider, SolarQuery } from './types';

/**
 * Irradiance keyed in by an administrator, typically transcribed from NEDO
 * METPV-20 or an equivalent regional dataset.
 *
 * This provider is what guarantees the platform is never blocked by an external
 * API: a site with no online coverage is still quotable, provided a human has
 * supplied a table and named its source.
 */
export class ManualSolarProvider implements SolarDataProvider {
  readonly id = 'manual';
  readonly name = '手動入力 / Manual dataset';

  constructor(
    private readonly datasets: readonly ManualDataset[],
    /** Radius within which a stored dataset is considered to represent a site. */
    private readonly matchRadiusKm = 30,
  ) {}

  isAvailable(): boolean {
    return this.datasets.length > 0;
  }

  async fetch(query: SolarQuery): Promise<IrradianceDataset | null> {
    const match = this.nearest(query);
    if (!match) return null;
    return {
      providerId: this.id,
      providerName: this.name,
      latitude: query.latitude,
      longitude: query.longitude,
      tiltDeg: query.tiltDeg,
      azimuthDeg: query.azimuthDeg,
      climate: match.dataset.climate,
      source: sourced(match.dataset.label, match.dataset.source),
      isPlaneOfArray: match.dataset.isPlaneOfArray,
    };
  }

  private nearest(query: SolarQuery): { dataset: ManualDataset; km: number } | null {
    let best: { dataset: ManualDataset; km: number } | null = null;
    for (const dataset of this.datasets) {
      const km = haversineKm(query, dataset);
      if (km > this.matchRadiusKm) continue;
      if (!best || km < best.km) best = { dataset, km };
    }
    return best;
  }
}

export interface ManualDataset {
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly climate: MonthlyClimate;
  readonly source: CoefficientSource;
  readonly isPlaneOfArray: boolean;
}

/** Validate an administrator-entered table before it is stored. */
export function validateManualClimate(climate: MonthlyClimate): string[] {
  const errors: string[] = [];
  for (const m of MONTHS) {
    const h = climate.planeOfArrayKWhPerM2PerDay[m];
    if (!Number.isFinite(h) || h < 0) {
      errors.push(`Month ${m}: irradiation must be a number >= 0, got ${h}`);
    } else if (h > 12) {
      // Extraterrestrial irradiance caps daily totals well below this anywhere
      // on Earth; a larger number means the units are wrong.
      errors.push(
        `Month ${m}: ${h} kWh/m²/day exceeds any physically achievable daily total. ` +
          'Check the units — this table wants kWh/m²/day, not MJ/m²/day (divide by 3.6).',
      );
    }
    const t = climate.ambientTempC[m];
    if (!Number.isFinite(t)) {
      errors.push(`Month ${m}: ambient temperature must be a number, got ${t}`);
    } else if (t < -50 || t > 60) {
      errors.push(`Month ${m}: ambient temperature ${t} °C is outside a plausible range.`);
    }
  }
  return errors;
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371.0088;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
