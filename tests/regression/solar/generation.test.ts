import { describe, expect, it } from 'vitest';
import { simulateGeneration, annualMeanDailyIrradiation } from '@core/solar/engine';
import { UnsourcedCoefficientError } from '@core/solar/sourced';
import { DAYS_IN_MONTH, MONTHS, type SimulationInput } from '@core/solar/types';
import {
  SEASONAL_CLIMATE,
  TEST_COEFFICIENTS,
  TEST_MODULE,
  UNITY_COEFFICIENTS,
  UNSOURCED_COEFFICIENTS,
  flatClimate,
  testDataset,
} from '@tests/fixtures/solar/coefficients';

function input(over: Partial<SimulationInput> = {}): SimulationInput {
  return {
    installedKw: 5,
    module: TEST_MODULE,
    mounting: 'roof-flush',
    coefficients: TEST_COEFFICIENTS,
    irradiance: testDataset(SEASONAL_CLIMATE),
    projectionYears: 20,
    ...over,
  };
}

describe('generation engine: analytic identities', () => {
  /**
   * With every derate at 1.0 and no temperature rise, ambient exactly 25 C, the
   * model must collapse to E = P x H. Anything else means a stray factor.
   */
  it('reduces to P x H under unity coefficients at 25 C', () => {
    const r = simulateGeneration(
      input({
        coefficients: UNITY_COEFFICIENTS,
        irradiance: testDataset(flatClimate(4, 25)),
      }),
    );
    expect(r.annualGenerationKWh).toBeCloseTo(5 * 4 * 365, 6);
    expect(r.breakdown.overallDesignFactorK).toBeCloseTo(1, 9);
    expect(r.performanceRatio).toBeCloseTo(1, 9);
  });

  it('applies the temperature coefficient linearly', () => {
    // Unity losses, no mounting rise, ambient 35 C: f_temp = 1 + (-0.004)(35-25) = 0.96.
    const r = simulateGeneration(
      input({
        coefficients: UNITY_COEFFICIENTS,
        irradiance: testDataset(flatClimate(4, 35)),
      }),
    );
    expect(r.annualGenerationKWh).toBeCloseTo(5 * 4 * 365 * 0.96, 6);
    for (const m of r.monthly) expect(m.temperatureFactor).toBeCloseTo(0.96, 9);
  });

  it('gains output when cells run below 25 C', () => {
    const cold = simulateGeneration(
      input({ coefficients: UNITY_COEFFICIENTS, irradiance: testDataset(flatClimate(4, 5)) }),
    );
    // f_temp = 1 + (-0.004)(5-25) = 1.08.
    expect(cold.annualGenerationKWh).toBeCloseTo(5 * 4 * 365 * 1.08, 6);
  });

  it('multiplies the system loss factors exactly', () => {
    const r = simulateGeneration(
      input({ irradiance: testDataset(flatClimate(4, 25)), mounting: 'ground-mounted' }),
    );
    // f_sys = 0.95 x 0.98 x 0.97 x 0.99 x 1.0; mounting rise 15 K at 0.4 kW/m2
    // (4 kWh/day over 10 daylight hours) = 6 K, so T_cell = 31 C and
    // f_temp = 1 + (-0.004)(6) = 0.976.
    const fSys = 0.95 * 0.98 * 0.97 * 0.99;
    expect(r.annualGenerationKWh).toBeCloseTo(5 * 4 * 365 * fSys * 0.976, 4);
    expect(r.breakdown.overallDesignFactorK).toBeCloseTo(fSys * 0.976, 9);
  });

  it('scales linearly with installed capacity', () => {
    const a = simulateGeneration(input({ installedKw: 5 })).annualGenerationKWh;
    const b = simulateGeneration(input({ installedKw: 10 })).annualGenerationKWh;
    expect(b).toBeCloseTo(a * 2, 6);
  });

  it('produces nothing from nothing', () => {
    const r = simulateGeneration(input({ installedKw: 0 }));
    expect(r.annualGenerationKWh).toBe(0);
    expect(r.specificYieldKWhPerKw).toBe(0);
  });

  it('reconstructs the annual total from the reported K factor', () => {
    // The JPEA cross-check: EPY = PAS x HA x K x 365.
    const r = simulateGeneration(input());
    const ha = annualMeanDailyIrradiation(
      SEASONAL_CLIMATE.planeOfArrayKWhPerM2PerDay,
    );
    const jpea = 5 * ha * r.breakdown.overallDesignFactorK * 365;
    expect(jpea).toBeCloseTo(r.annualGenerationKWh, 6);
  });

  it('reports monthly totals that sum to the annual figure', () => {
    const r = simulateGeneration(input());
    const sum = r.monthly.reduce((s, m) => s + m.generationKWh, 0);
    expect(sum).toBeCloseTo(r.annualGenerationKWh, 6);
    expect(r.monthly).toHaveLength(12);
    expect(r.monthly.map((m) => m.month)).toEqual([...MONTHS]);
  });

  it('uses calendar month lengths, not a flat 30 days', () => {
    const r = simulateGeneration(
      input({ irradiance: testDataset(flatClimate(4, 25)), coefficients: UNITY_COEFFICIENTS }),
    );
    const jan = r.monthly.find((m) => m.month === 1)!;
    const feb = r.monthly.find((m) => m.month === 2)!;
    expect(jan.irradiationKWhPerM2).toBeCloseTo(4 * DAYS_IN_MONTH[1], 9);
    expect(feb.irradiationKWhPerM2).toBeCloseTo(4 * DAYS_IN_MONTH[2], 9);
    expect(jan.generationKWh / feb.generationKWh).toBeCloseTo(31 / 28, 9);
  });
});

describe('generation engine: seasonality', () => {
  /**
   * The reason the model works monthly rather than on an annual average: the
   * thermal derate is much harsher in August than in January, and averaging
   * first hides that.
   */
  it('derates summer harder than winter', () => {
    const r = simulateGeneration(input());
    const aug = r.monthly.find((m) => m.month === 8)!;
    const jan = r.monthly.find((m) => m.month === 1)!;
    expect(aug.cellTempC).toBeGreaterThan(jan.cellTempC);
    expect(aug.temperatureFactor).toBeLessThan(jan.temperatureFactor);
    expect(jan.temperatureFactor).toBeGreaterThan(1); // colder than STC
  });

  it('penalises roof-flush mounting relative to ground mounting', () => {
    const flush = simulateGeneration(input({ mounting: 'roof-flush' }));
    const raised = simulateGeneration(input({ mounting: 'roof-raised' }));
    const ground = simulateGeneration(input({ mounting: 'ground-mounted' }));
    expect(flush.annualGenerationKWh).toBeLessThan(raised.annualGenerationKWh);
    expect(raised.annualGenerationKWh).toBeLessThan(ground.annualGenerationKWh);
  });
});

describe('generation engine: degradation and projection', () => {
  it('leaves year 1 un-degraded and compounds thereafter', () => {
    const r = simulateGeneration(input({ projectionYears: 3 }));
    expect(r.yearlyGenerationKWh).toHaveLength(3);
    expect(r.yearlyGenerationKWh[0]).toBeCloseTo(r.annualGenerationKWh, 9);
    expect(r.yearlyGenerationKWh[1]).toBeCloseTo(r.annualGenerationKWh * 0.995, 9);
    expect(r.yearlyGenerationKWh[2]).toBeCloseTo(r.annualGenerationKWh * 0.995 ** 2, 9);
  });

  it('sums the projection into the lifetime figure', () => {
    const r = simulateGeneration(input({ projectionYears: 20 }));
    expect(r.lifetimeGenerationKWh).toBeCloseTo(
      r.yearlyGenerationKWh.reduce((a, b) => a + b, 0),
      6,
    );
    expect(r.lifetimeGenerationKWh).toBeLessThan(r.annualGenerationKWh * 20);
  });

  it('computes avoided CO2 from the sourced grid factor', () => {
    const r = simulateGeneration(input());
    expect(r.annualCo2AvoidedKg).toBeCloseTo(r.annualGenerationKWh * 0.45, 6);
  });
});

describe('generation engine: refuses to guess', () => {
  it('rejects an unverified coefficient', () => {
    expect(() => simulateGeneration(input({ coefficients: UNSOURCED_COEFFICIENTS }))).toThrow(
      UnsourcedCoefficientError,
    );
  });

  it('names the offending field so an administrator can fix it', () => {
    try {
      simulateGeneration(input({ coefficients: UNSOURCED_COEFFICIENTS }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsourcedCoefficientError);
      expect((err as UnsourcedCoefficientError).fields).toContain(
        'coefficients.losses.wiringFactor',
      );
    }
  });

  it('warns when irradiance is not plane-of-array', () => {
    const r = simulateGeneration(
      input({ irradiance: testDataset(SEASONAL_CLIMATE, false) }),
    );
    expect(r.warnings.join(' ')).toContain('IRRADIANCE_NOT_PLANE_OF_ARRAY');
  });

  it('has no warnings for a fully sourced plane-of-array run', () => {
    expect(simulateGeneration(input()).warnings).toEqual([]);
  });
});

describe('generation engine: input validation', () => {
  it('catches a temperature coefficient stored as %/degC', () => {
    // -0.35 %/degC entered without dividing by 100 would silently zero the output.
    expect(() =>
      simulateGeneration(
        input({
          module: { ...TEST_MODULE, pmaxTempCoeffPerK: { ...TEST_MODULE.pmaxTempCoeffPerK, value: -0.35 } },
        }),
      ),
    ).toThrow(/implausible/);
  });

  it('catches a positive temperature coefficient', () => {
    expect(() =>
      simulateGeneration(
        input({
          module: { ...TEST_MODULE, pmaxTempCoeffPerK: { ...TEST_MODULE.pmaxTempCoeffPerK, value: 0.004 } },
        }),
      ),
    ).toThrow(/must be negative/);
  });

  it('catches a loss entered as a percentage instead of a multiplier', () => {
    expect(() =>
      simulateGeneration(
        input({
          coefficients: {
            ...TEST_COEFFICIENTS,
            losses: {
              ...TEST_COEFFICIENTS.losses,
              wiringFactor: { ...TEST_COEFFICIENTS.losses.wiringFactor, value: 5 },
            },
          },
        }),
      ),
    ).toThrow(/multiplier in \(0, 1\]/);
  });

  it('rejects nonsense capacity, horizon and degradation', () => {
    expect(() => simulateGeneration(input({ installedKw: -1 }))).toThrow(RangeError);
    expect(() => simulateGeneration(input({ projectionYears: 0 }))).toThrow(RangeError);
    expect(() => simulateGeneration(input({ projectionYears: 1.5 }))).toThrow(RangeError);
    expect(() =>
      simulateGeneration(
        input({
          module: { ...TEST_MODULE, annualDegradation: { ...TEST_MODULE.annualDegradation, value: 1 } },
        }),
      ),
    ).toThrow(RangeError);
  });

  it('rejects negative or non-finite irradiance', () => {
    const bad = testDataset(flatClimate(-1, 20));
    expect(() => simulateGeneration(input({ irradiance: bad }))).toThrow(RangeError);
  });
});

describe('generation engine: determinism and versioning', () => {
  it('returns identical results for identical input', () => {
    const a = simulateGeneration(input());
    const b = simulateGeneration(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('stamps the engine version', () => {
    expect(simulateGeneration(input()).algorithmVersion).toBe('solar-engine-v1');
  });
});
