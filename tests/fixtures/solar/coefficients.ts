import { placeholder, sourced } from '@core/solar/sourced';
import type {
  CoefficientSet,
  IrradianceDataset,
  ModuleElectricalSpec,
  Month,
  MonthlyClimate,
} from '@core/solar/types';

/**
 * TEST COEFFICIENTS ONLY.
 *
 * These are internally consistent values chosen so the engine's arithmetic can
 * be verified exactly. They are NOT industry figures and must never be seeded
 * into a production database — the production seed marks everything as an
 * unverified placeholder precisely so it cannot be quoted from.
 *
 * They are marked as verified here only so `assertProductionReady` lets the
 * arithmetic tests run; see `unverified.ts` for the rejection tests.
 */
const TEST_SOURCE = {
  kind: 'administrator-input' as const,
  citation: 'Synthetic test value — not a real-world figure',
  effectiveDate: '2026-01-01',
  verifiedAt: '2026-01-01T00:00:00Z',
  verifiedBy: 'test-suite',
};

export const TEST_MODULE: ModuleElectricalSpec = {
  manufacturer: 'TestCo',
  model: 'TC-400',
  datasheetVersion: 'synthetic-1',
  ratedPowerW: sourced(400, TEST_SOURCE),
  pmaxTempCoeffPerK: sourced(-0.004, TEST_SOURCE),
  noctC: sourced(45, TEST_SOURCE),
  annualDegradation: sourced(0.005, TEST_SOURCE),
};

/** Every derate set to 1.0, so generation reduces to P x H x f_temp exactly. */
export const UNITY_COEFFICIENTS: CoefficientSet = {
  id: 'unity',
  name: 'Unity (analytic test set)',
  losses: {
    inverterEfficiency: sourced(1, TEST_SOURCE),
    wiringFactor: sourced(1, TEST_SOURCE),
    soilingFactor: sourced(1, TEST_SOURCE),
    shadingFactor: sourced(1, TEST_SOURCE),
    otherApprovedFactor: sourced(1, TEST_SOURCE),
  },
  thermal: {
    temperatureRiseK: {
      'roof-flush': sourced(0, TEST_SOURCE),
      'roof-raised': sourced(0, TEST_SOURCE),
      'ground-mounted': sourced(0, TEST_SOURCE),
    },
  },
  gridCo2FactorKgPerKWh: sourced(0.5, TEST_SOURCE),
};

/** A realistic-shaped set with distinct factors, so each is separable in tests. */
export const TEST_COEFFICIENTS: CoefficientSet = {
  id: 'test',
  name: 'Distinct-factor test set',
  losses: {
    inverterEfficiency: sourced(0.95, TEST_SOURCE),
    wiringFactor: sourced(0.98, TEST_SOURCE),
    soilingFactor: sourced(0.97, TEST_SOURCE),
    shadingFactor: sourced(0.99, TEST_SOURCE),
    otherApprovedFactor: sourced(1.0, TEST_SOURCE),
  },
  thermal: {
    temperatureRiseK: {
      'roof-flush': sourced(25, TEST_SOURCE),
      'roof-raised': sourced(20, TEST_SOURCE),
      'ground-mounted': sourced(15, TEST_SOURCE),
    },
  },
  gridCo2FactorKgPerKWh: sourced(0.45, TEST_SOURCE),
};

export const UNSOURCED_COEFFICIENTS: CoefficientSet = {
  ...TEST_COEFFICIENTS,
  id: 'unsourced',
  losses: {
    ...TEST_COEFFICIENTS.losses,
    wiringFactor: placeholder(0.98, 'nobody has checked this'),
  },
};

export function flatClimate(kWhPerDay: number, tempC: number): MonthlyClimate {
  const perDay = {} as Record<Month, number>;
  const temps = {} as Record<Month, number>;
  for (let m = 1 as Month; m <= 12; m = (m + 1) as Month) {
    perDay[m] = kWhPerDay;
    temps[m] = tempC;
  }
  return { planeOfArrayKWhPerM2PerDay: perDay, ambientTempC: temps };
}

export function testDataset(climate: MonthlyClimate, isPlaneOfArray = true): IrradianceDataset {
  return {
    providerId: 'test',
    providerName: 'Synthetic',
    latitude: 35.0,
    longitude: 139.0,
    tiltDeg: 30,
    azimuthDeg: 180,
    climate,
    source: sourced('synthetic', TEST_SOURCE),
    isPlaneOfArray,
  };
}

/** A seasonal profile, so the monthly model is exercised rather than a flat line. */
export const SEASONAL_CLIMATE: MonthlyClimate = {
  planeOfArrayKWhPerM2PerDay: {
    1: 3.2, 2: 3.6, 3: 4.0, 4: 4.4, 5: 4.5, 6: 3.8,
    7: 4.0, 8: 4.4, 9: 3.5, 10: 3.2, 11: 3.0, 12: 3.0,
  },
  ambientTempC: {
    1: 6, 2: 7, 3: 10, 4: 15, 5: 20, 6: 23,
    7: 27, 8: 29, 9: 25, 10: 19, 11: 14, 12: 9,
  },
};
