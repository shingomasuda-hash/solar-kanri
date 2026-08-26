import { describe, expect, it } from 'vitest';
import { calculateEconomics, computeIrr, computePayback } from '@core/economics/engine';
import type { EconomicsInput } from '@core/economics/types';
import { UnsourcedCoefficientError, placeholder, sourced } from '@core/solar/sourced';

const SRC = {
  kind: 'administrator-input' as const,
  citation: 'Synthetic test value',
  verifiedAt: '2026-01-01T00:00:00Z',
  verifiedBy: 'test-suite',
};

function input(over: Partial<EconomicsInput> = {}): EconomicsInput {
  return {
    yearlyGenerationKWh: Array.from({ length: 20 }, () => 6000),
    tariff: {
      id: 't',
      name: 'test tariff',
      purchasePriceJpyPerKWh: sourced(30, SRC),
      exportPriceJpyPerKWh: sourced(16, SRC),
      exportPriceYears: sourced(10, SRC),
      postExportPriceJpyPerKWh: sourced(8, SRC),
      annualPriceEscalation: sourced(0, SRC),
      monthlyBasicChargeJpy: sourced(1000, SRC),
    },
    consumption: {
      annualConsumptionKWh: 5000,
      selfConsumptionRatio: sourced(0.3, SRC),
    },
    cost: {
      totalCostJpy: 1_500_000,
      subsidyJpy: 100_000,
      annualOpexJpy: sourced(10_000, SRC),
      scheduledCostsJpy: {},
    },
    discountRate: sourced(0, SRC),
    ...over,
  };
}

describe('economics: year-one arithmetic', () => {
  it('splits generation into self-consumption and export', () => {
    const r = calculateEconomics(input());
    const y1 = r.yearly[0]!;
    expect(y1.selfConsumedKWh).toBeCloseTo(6000 * 0.3, 9);
    expect(y1.exportedKWh).toBeCloseTo(6000 - 1800, 9);
  });

  it('values self-consumption at the retail price and export at the promo price', () => {
    const y1 = calculateEconomics(input()).yearly[0]!;
    expect(y1.billSavingJpy).toBeCloseTo(1800 * 30, 6);
    expect(y1.exportRevenueJpy).toBeCloseTo(4200 * 16, 6);
    expect(y1.netBenefitJpy).toBeCloseTo(1800 * 30 + 4200 * 16 - 10_000, 6);
  });

  it('nets the subsidy off the investment', () => {
    expect(calculateEconomics(input()).netInvestmentJpy).toBe(1_400_000);
  });
});

describe('economics: the self-consumption cap', () => {
  /**
   * The classic way to overstate a proposal is to let an oversized array save
   * more than the customer's bill. Consumption is a hard ceiling.
   */
  it('cannot save more than the site actually consumes', () => {
    const r = calculateEconomics(
      input({
        yearlyGenerationKWh: [40_000],
        consumption: { annualConsumptionKWh: 5000, selfConsumptionRatio: sourced(0.9, SRC) },
      }),
    );
    const y1 = r.yearly[0]!;
    expect(y1.selfConsumedKWh).toBe(5000); // not 36,000
    expect(y1.exportedKWh).toBe(35_000);
    expect(y1.billSavingJpy).toBeCloseTo(5000 * 30, 6);
  });

  it('warns when the cap binds', () => {
    const r = calculateEconomics(
      input({
        yearlyGenerationKWh: [40_000],
        consumption: { annualConsumptionKWh: 5000, selfConsumptionRatio: sourced(0.9, SRC) },
      }),
    );
    expect(r.warnings.join(' ')).toContain('SELF_CONSUMPTION_CAPPED');
  });

  it('does not warn for a right-sized array', () => {
    expect(calculateEconomics(input()).warnings).toEqual([]);
  });
});

describe('economics: tariff transitions', () => {
  it('drops to the post-promotional export price after the term', () => {
    const r = calculateEconomics(input());
    expect(r.yearly[9]!.exportRevenueJpy).toBeCloseTo(4200 * 16, 6); // year 10, last promo year
    expect(r.yearly[10]!.exportRevenueJpy).toBeCloseTo(4200 * 8, 6); // year 11
  });

  it('escalates the retail price but not the export price', () => {
    const r = calculateEconomics(
      input({
        tariff: { ...input().tariff, annualPriceEscalation: sourced(0.02, SRC) },
      }),
    );
    expect(r.yearly[0]!.billSavingJpy).toBeCloseTo(1800 * 30, 6);
    expect(r.yearly[1]!.billSavingJpy).toBeCloseTo(1800 * 30 * 1.02, 6);
    expect(r.yearly[4]!.billSavingJpy).toBeCloseTo(1800 * 30 * 1.02 ** 4, 6);
    expect(r.yearly[1]!.exportRevenueJpy).toBeCloseTo(r.yearly[0]!.exportRevenueJpy, 6);
  });
});

describe('economics: scheduled costs', () => {
  it('applies a one-off cost in exactly its year', () => {
    const r = calculateEconomics(
      input({
        cost: { ...input().cost, scheduledCostsJpy: { 15: 250_000 } },
      }),
    );
    expect(r.yearly[14]!.scheduledCostJpy).toBe(250_000);
    expect(r.yearly[13]!.scheduledCostJpy).toBe(0);
    expect(r.yearly[15]!.scheduledCostJpy).toBe(0);
    expect(r.yearly[14]!.netBenefitJpy).toBeCloseTo(
      r.yearly[13]!.netBenefitJpy - 250_000,
      6,
    );
  });

  it('can push a project past its payback', () => {
    const withoutCost = calculateEconomics(input()).paybackYears!;
    const withCost = calculateEconomics(
      input({ cost: { ...input().cost, scheduledCostsJpy: { 5: 400_000 } } }),
    ).paybackYears!;
    expect(withCost).toBeGreaterThan(withoutCost);
  });
});

describe('economics: payback', () => {
  it('interpolates inside the crossing year', () => {
    const r = calculateEconomics(input());
    expect(r.paybackYears).not.toBeNull();
    const p = r.paybackYears!;
    expect(Number.isInteger(p)).toBe(false);
    const before = r.yearly[Math.floor(p) - 1]!;
    const after = r.yearly[Math.floor(p)]!;
    expect(before.cumulativeNetJpy).toBeLessThan(r.netInvestmentJpy);
    expect(after.cumulativeNetJpy).toBeGreaterThanOrEqual(r.netInvestmentJpy);
  });

  it('returns null when the project never pays back inside the horizon', () => {
    const r = calculateEconomics(
      input({ cost: { ...input().cost, totalCostJpy: 500_000_000, subsidyJpy: 0 } }),
    );
    expect(r.paybackYears).toBeNull();
    expect(r.lifetimeNetJpy).toBeLessThan(0);
    // A wildly over-priced project still has a well-defined, very negative IRR;
    // that is real information, so it is reported rather than suppressed.
    expect(r.irr).toBeLessThan(0);
  });

  it('is zero when there is nothing to pay back', () => {
    expect(computePayback([], 0)).toBe(0);
  });
});

describe('economics: NPV and IRR', () => {
  it('NPV equals the undiscounted total at a zero discount rate', () => {
    const r = calculateEconomics(input());
    expect(r.npvJpy).toBeCloseTo(r.lifetimeNetJpy, 6);
  });

  it('discounting reduces NPV below the undiscounted total', () => {
    const r = calculateEconomics(input({ discountRate: sourced(0.03, SRC) }));
    expect(r.npvJpy).toBeLessThan(r.lifetimeNetJpy);
  });

  it('IRR zeroes the NPV of the cashflows', () => {
    const r = calculateEconomics(input());
    expect(r.irr).not.toBeNull();
    const cashflows = [-r.netInvestmentJpy, ...r.yearly.map((y) => y.netBenefitJpy)];
    const npvAtIrr = cashflows.reduce((s, cf, i) => s + cf / (1 + r.irr!) ** i, 0);
    expect(Math.abs(npvAtIrr)).toBeLessThan(1); // within one yen
  });

  it('IRR is deterministic', () => {
    const flows = [-1_000_000, 200_000, 200_000, 200_000, 200_000, 200_000, 200_000];
    expect(computeIrr(flows)).toBe(computeIrr(flows));
  });

  it('IRR of a project that only loses money is null', () => {
    expect(computeIrr([-1000, -100, -100])).toBeNull();
  });

  it('IRR is 0 for a project that exactly returns its cost', () => {
    expect(computeIrr([-1000, 500, 500])).toBeCloseTo(0, 6);
  });
});

describe('economics: refuses to guess', () => {
  it('rejects an unsourced tariff', () => {
    expect(() =>
      calculateEconomics(
        input({
          tariff: {
            ...input().tariff,
            purchasePriceJpyPerKWh: placeholder(30, 'nobody approved this price'),
          },
        }),
      ),
    ).toThrow(UnsourcedCoefficientError);
  });

  it('rejects an unsourced self-consumption assumption', () => {
    expect(() =>
      calculateEconomics(
        input({
          consumption: {
            annualConsumptionKWh: 5000,
            selfConsumptionRatio: placeholder(0.3, 'guessed'),
          },
        }),
      ),
    ).toThrow(UnsourcedCoefficientError);
  });
});

describe('economics: input validation', () => {
  it('rejects an empty projection', () => {
    expect(() => calculateEconomics(input({ yearlyGenerationKWh: [] }))).toThrow(RangeError);
  });

  it('rejects negative generation, cost or subsidy', () => {
    expect(() => calculateEconomics(input({ yearlyGenerationKWh: [-1] }))).toThrow(RangeError);
    expect(() =>
      calculateEconomics(input({ cost: { ...input().cost, totalCostJpy: -1 } })),
    ).toThrow(RangeError);
    expect(() =>
      calculateEconomics(input({ cost: { ...input().cost, subsidyJpy: -1 } })),
    ).toThrow(RangeError);
  });

  it('rejects a self-consumption ratio outside [0, 1]', () => {
    expect(() =>
      calculateEconomics(
        input({
          consumption: { annualConsumptionKWh: 5000, selfConsumptionRatio: sourced(1.5, SRC) },
        }),
      ),
    ).toThrow(RangeError);
  });

  it('warns when the subsidy exceeds the cost', () => {
    const r = calculateEconomics(
      input({ cost: { ...input().cost, totalCostJpy: 100_000, subsidyJpy: 200_000 } }),
    );
    expect(r.warnings.join(' ')).toContain('SUBSIDY_EXCEEDS_COST');
  });
});

describe('economics: determinism and versioning', () => {
  it('returns identical results for identical input', () => {
    expect(JSON.stringify(calculateEconomics(input()))).toBe(
      JSON.stringify(calculateEconomics(input())),
    );
  });

  it('stamps the engine version', () => {
    expect(calculateEconomics(input()).algorithmVersion).toBe('economics-engine-v1');
  });
});
