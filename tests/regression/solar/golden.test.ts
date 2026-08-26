import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulateGeneration } from '@core/solar/engine';
import { sourced } from '@core/solar/sourced';
import { MONTHS, type Month, type SimulationInput } from '@core/solar/types';

/**
 * Golden tests against published reference figures (project brief rule 22).
 *
 * The harness is always exercised. Whether the *comparisons* are mandatory
 * depends on `manifest.json`:
 *
 *  - AWAITING_REFERENCE_DATA — no third-party case has been loaded. The harness
 *    self-tests against a synthetic case so it cannot silently rot, and the
 *    outstanding gap is reported. Tracked as OI-001 in docs/open-issues.md.
 *  - ACTIVE — at least one real case is expected. An empty directory now fails
 *    the build, and every case must land inside its declared tolerance.
 *
 * The two-state design exists because reference data is a Product Owner
 * responsibility (rule 3D: the final generation baseline is a human decision),
 * but the harness that consumes it is not, and should not wait for it.
 */

const GOLDEN_DIR = join(process.cwd(), 'tests/fixtures/solar/golden');

interface GoldenManifest {
  status: 'AWAITING_REFERENCE_DATA' | 'ACTIVE';
  statusNote: string;
  defaultTolerancePct: number;
  cases: string[];
}

interface GoldenCase {
  id: string;
  description: string;
  source: { kind: string; citation: string; url?: string; retrievedAt?: string };
  input: {
    installedKw: number;
    mounting: 'roof-flush' | 'roof-raised' | 'ground-mounted';
    latitude: number;
    longitude: number;
    tiltDeg: number;
    azimuthDeg: number;
    module: { pmaxTempCoeffPerK: number; noctC: number; annualDegradation: number };
    losses: Record<string, number>;
    temperatureRiseK: Record<string, number>;
    climate: {
      planeOfArrayKWhPerM2PerDay: Record<string, number>;
      ambientTempC: Record<string, number>;
    };
  };
  reference: {
    annualGenerationKWh: number;
    monthlyGenerationKWh?: Record<string, number>;
    tolerancePct?: number;
  };
}

const manifest: GoldenManifest = JSON.parse(
  readFileSync(join(GOLDEN_DIR, 'manifest.json'), 'utf8'),
);

function loadCases(): GoldenCase[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
    .sort()
    .map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf8')) as GoldenCase);
}

/** Build engine input from a golden case. Exported shape mirrors the schema doc. */
export function toSimulationInput(c: GoldenCase): SimulationInput {
  const src = {
    kind: 'public-dataset' as const,
    citation: c.source.citation,
    url: c.source.url,
    verifiedAt: c.source.retrievedAt ?? '1970-01-01T00:00:00Z',
    verifiedBy: 'golden-dataset',
  };
  const perDay = {} as Record<Month, number>;
  const temps = {} as Record<Month, number>;
  for (const m of MONTHS) {
    perDay[m] = c.input.climate.planeOfArrayKWhPerM2PerDay[String(m)]!;
    temps[m] = c.input.climate.ambientTempC[String(m)]!;
  }
  return {
    installedKw: c.input.installedKw,
    mounting: c.input.mounting,
    module: {
      manufacturer: 'golden',
      model: c.id,
      datasheetVersion: c.source.citation,
      ratedPowerW: sourced(400, src),
      pmaxTempCoeffPerK: sourced(c.input.module.pmaxTempCoeffPerK, src),
      noctC: sourced(c.input.module.noctC, src),
      annualDegradation: sourced(c.input.module.annualDegradation, src),
    },
    coefficients: {
      id: c.id,
      name: c.description,
      losses: {
        inverterEfficiency: sourced(c.input.losses.inverterEfficiency!, src),
        wiringFactor: sourced(c.input.losses.wiringFactor!, src),
        soilingFactor: sourced(c.input.losses.soilingFactor!, src),
        shadingFactor: sourced(c.input.losses.shadingFactor!, src),
        otherApprovedFactor: sourced(c.input.losses.otherApprovedFactor!, src),
      },
      thermal: {
        temperatureRiseK: {
          'roof-flush': sourced(c.input.temperatureRiseK['roof-flush']!, src),
          'roof-raised': sourced(c.input.temperatureRiseK['roof-raised']!, src),
          'ground-mounted': sourced(c.input.temperatureRiseK['ground-mounted']!, src),
        },
      },
      gridCo2FactorKgPerKWh: sourced(0.45, src),
    },
    irradiance: {
      providerId: 'golden',
      providerName: c.source.citation,
      latitude: c.input.latitude,
      longitude: c.input.longitude,
      tiltDeg: c.input.tiltDeg,
      azimuthDeg: c.input.azimuthDeg,
      climate: { planeOfArrayKWhPerM2PerDay: perDay, ambientTempC: temps },
      source: sourced(c.source.citation, src),
      isPlaneOfArray: true,
    },
    projectionYears: 1,
  };
}

const cases = loadCases();

describe('golden dataset harness', () => {
  it('has a readable manifest', () => {
    expect(['AWAITING_REFERENCE_DATA', 'ACTIVE']).toContain(manifest.status);
    expect(manifest.defaultTolerancePct).toBeGreaterThan(0);
  });

  it('requires every loaded case to declare a verifiable source', () => {
    for (const c of cases) {
      expect(c.source?.citation, `case ${c.id} has no citation`).toBeTruthy();
      expect(c.source?.kind, `case ${c.id} has no source kind`).toBeTruthy();
    }
  });

  it('proves the harness itself works on a synthetic case', () => {
    // Constructed so the expected answer is exact: unity losses, no thermal
    // rise, ambient at STC. E = 5 kW x 4 kWh/m2/day x 365 = 7300 kWh.
    const synthetic: GoldenCase = {
      id: 'harness-self-test',
      description: 'Analytic case with a closed-form answer',
      source: { kind: 'official-standard', citation: 'Analytic identity E = P x H' },
      input: {
        installedKw: 5,
        mounting: 'ground-mounted',
        latitude: 35,
        longitude: 139,
        tiltDeg: 30,
        azimuthDeg: 180,
        module: { pmaxTempCoeffPerK: -0.004, noctC: 45, annualDegradation: 0 },
        losses: {
          inverterEfficiency: 1,
          wiringFactor: 1,
          soilingFactor: 1,
          shadingFactor: 1,
          otherApprovedFactor: 1,
        },
        temperatureRiseK: { 'roof-flush': 0, 'roof-raised': 0, 'ground-mounted': 0 },
        climate: {
          planeOfArrayKWhPerM2PerDay: Object.fromEntries(MONTHS.map((m) => [m, 4])),
          ambientTempC: Object.fromEntries(MONTHS.map((m) => [m, 25])),
        },
      },
      reference: { annualGenerationKWh: 7300, tolerancePct: 0.001 },
    };
    const r = simulateGeneration(toSimulationInput(synthetic));
    expect(r.annualGenerationKWh).toBeCloseTo(7300, 6);
  });

  if (manifest.status === 'ACTIVE') {
    it('has at least one reference case loaded', () => {
      expect(
        cases.length,
        'manifest says ACTIVE but no reference case files are present',
      ).toBeGreaterThan(0);
    });
  } else {
    it('reports the outstanding reference-data gap (OI-001)', () => {
      // Intentionally not a failure: loading third-party reference data is a
      // Product Owner action (rule 3D). This assertion documents the gap so it
      // shows up in every test run rather than being forgotten.
      expect(cases.length).toBe(0);
      expect(manifest.statusNote).toContain('OI-001');
    });
  }
});

describe.runIf(cases.length > 0)('golden dataset comparison', () => {
  it.each(cases.map((c) => [c.id, c] as const))(
    '%s matches its reference within tolerance',
    (_id, c) => {
      const result = simulateGeneration(toSimulationInput(c));
      const tolerancePct = c.reference.tolerancePct ?? manifest.defaultTolerancePct;
      const absError = result.annualGenerationKWh - c.reference.annualGenerationKWh;
      const pctError = (absError / c.reference.annualGenerationKWh) * 100;

      // Reported on every run, pass or fail, so drift is visible before it breaks.
      console.info(
        `[golden] ${c.id}: engine ${result.annualGenerationKWh.toFixed(0)} kWh vs ` +
          `reference ${c.reference.annualGenerationKWh.toFixed(0)} kWh — ` +
          `abs ${absError.toFixed(0)} kWh, ${pctError.toFixed(2)} % (tolerance ±${tolerancePct} %)`,
      );
      expect(Math.abs(pctError)).toBeLessThanOrEqual(tolerancePct);
    },
  );
});
