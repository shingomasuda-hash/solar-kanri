import type { IrradianceDataset } from '../types';

export interface SolarQuery {
  readonly latitude: number;
  readonly longitude: number;
  /** Array tilt from horizontal, degrees. */
  readonly tiltDeg: number;
  /** Array azimuth, compass degrees (0 = N, 90 = E, 180 = S, 270 = W). */
  readonly azimuthDeg: number;
}

/**
 * Source of site irradiance and temperature.
 *
 * The platform must never depend on one provider (rule 20). Google may not
 * model a given building; PVGIS coverage and licensing vary by region; NEDO
 * METPV is authoritative in Japan but is a local dataset rather than an API.
 * The manual provider is therefore always available as the floor: an operator
 * can key in a sourced monthly table and the system still works end to end.
 */
export interface SolarDataProvider {
  readonly id: string;
  readonly name: string;
  /** False when the provider is not configured (no API key, no dataset loaded). */
  isAvailable(): boolean;
  /** Resolve a dataset, or null when this provider has no data for the site. */
  fetch(query: SolarQuery): Promise<IrradianceDataset | null>;
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: string, reason: string) {
    super(`Solar data provider "${providerId}" is unavailable: ${reason}`);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * Try providers in order and return the first dataset produced.
 *
 * Order expresses preference, not capability: a site-specific measured dataset
 * should be listed ahead of a modelled one. Failures are collected rather than
 * thrown so one provider being down never blocks a quotation.
 */
export async function resolveIrradiance(
  providers: readonly SolarDataProvider[],
  query: SolarQuery,
): Promise<{ dataset: IrradianceDataset | null; attempts: ProviderAttempt[] }> {
  const attempts: ProviderAttempt[] = [];
  for (const provider of providers) {
    if (!provider.isAvailable()) {
      attempts.push({ providerId: provider.id, outcome: 'unavailable' });
      continue;
    }
    try {
      const dataset = await provider.fetch(query);
      if (dataset) {
        attempts.push({ providerId: provider.id, outcome: 'ok' });
        return { dataset, attempts };
      }
      attempts.push({ providerId: provider.id, outcome: 'no-data' });
    } catch (err) {
      attempts.push({
        providerId: provider.id,
        outcome: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { dataset: null, attempts };
}

export interface ProviderAttempt {
  readonly providerId: string;
  readonly outcome: 'ok' | 'no-data' | 'unavailable' | 'error';
  readonly message?: string;
}
