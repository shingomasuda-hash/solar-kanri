import type { Sourced } from '../solar/sourced';

export const ECONOMICS_ENGINE_VERSION = 'economics-engine-v1';

/**
 * Tariff terms. Every rate is a business decision owned by the Product Owner
 * and entered in the admin console — none may be inferred (rule 3B).
 */
export interface TariffSet {
  readonly id: string;
  readonly name: string;
  /** Retail price of grid electricity, JPY per kWh (what self-consumption saves). */
  readonly purchasePriceJpyPerKWh: Sourced;
  /** Feed-in / export price, JPY per kWh, for the promotional period. */
  readonly exportPriceJpyPerKWh: Sourced;
  /** Years the promotional export price runs (e.g. FIT term). */
  readonly exportPriceYears: Sourced;
  /** Export price after the promotional period ends, JPY per kWh. */
  readonly postExportPriceJpyPerKWh: Sourced;
  /** Assumed annual escalation of the retail price, as a fraction (0.02 = 2 %/yr). */
  readonly annualPriceEscalation: Sourced;
  /** Fixed monthly charge the system does not remove, JPY. */
  readonly monthlyBasicChargeJpy: Sourced;
}

export interface ConsumptionProfile {
  /** Household or site annual consumption, kWh. */
  readonly annualConsumptionKWh: number;
  /**
   * Fraction of generation consumed on site rather than exported.
   * A business assumption per customer segment, not a physical constant.
   */
  readonly selfConsumptionRatio: Sourced;
}

export interface SystemCost {
  /** Total installed cost including tax, JPY. */
  readonly totalCostJpy: number;
  /** Subsidies applied, JPY. */
  readonly subsidyJpy: number;
  /** Recurring operations and maintenance, JPY per year. */
  readonly annualOpexJpy: Sourced;
  /**
   * One-off mid-life costs, keyed by the year they fall in (1-based).
   * Inverter replacement is the usual entry.
   */
  readonly scheduledCostsJpy: Readonly<Record<number, number>>;
}

export interface EconomicsInput {
  /** Per-year generation from the solar engine, kWh. Length sets the horizon. */
  readonly yearlyGenerationKWh: readonly number[];
  readonly tariff: TariffSet;
  readonly consumption: ConsumptionProfile;
  readonly cost: SystemCost;
  /** Discount rate for NPV, as a fraction. 0 gives undiscounted totals. */
  readonly discountRate: Sourced;
}

export interface YearlyEconomics {
  readonly year: number;
  readonly generationKWh: number;
  readonly selfConsumedKWh: number;
  readonly exportedKWh: number;
  readonly billSavingJpy: number;
  readonly exportRevenueJpy: number;
  readonly opexJpy: number;
  readonly scheduledCostJpy: number;
  readonly netBenefitJpy: number;
  readonly cumulativeNetJpy: number;
  readonly discountedNetJpy: number;
}

export interface EconomicsResult {
  readonly algorithmVersion: string;
  readonly netInvestmentJpy: number;
  readonly yearly: readonly YearlyEconomics[];
  readonly firstYearBenefitJpy: number;
  readonly lifetimeBenefitJpy: number;
  readonly lifetimeNetJpy: number;
  /**
   * Years until cumulative benefit covers the net investment, interpolated
   * within the year it happens. Null when it never does inside the horizon.
   */
  readonly paybackYears: number | null;
  readonly npvJpy: number;
  /** Internal rate of return as a fraction, or null when it does not exist. */
  readonly irr: number | null;
  readonly warnings: readonly string[];
}
