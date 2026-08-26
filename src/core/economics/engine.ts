import { assertProductionReady } from '../solar/sourced';
import {
  ECONOMICS_ENGINE_VERSION,
  type EconomicsInput,
  type EconomicsResult,
  type YearlyEconomics,
} from './types';

/**
 * Deterministic economic model.
 *
 * As with generation, no money is ever computed by a language model (rule 23).
 * Every rate is a sourced business decision from the admin console; this module
 * only arithmetic.
 *
 * Per year y (1-based):
 *
 *   selfConsumed = min(generation, annualConsumption) x selfConsumptionRatio
 *   exported     = generation - selfConsumed
 *   billSaving   = selfConsumed x retailPrice x (1 + escalation)^(y-1)
 *   exportRevenue= exported x (y <= promoYears ? promoPrice : postPromoPrice)
 *   net          = billSaving + exportRevenue - opex - scheduledCost(y)
 *
 * The self-consumption cap matters: a system generating more than the site uses
 * cannot save more than the site's bill, and omitting the cap is the classic way
 * to overstate the benefit of an oversized array.
 */
export function calculateEconomics(input: EconomicsInput): EconomicsResult {
  validate(input);
  assertProductionReady({
    tariff: input.tariff,
    consumption: input.consumption.selfConsumptionRatio,
    opex: input.cost.annualOpexJpy,
    discountRate: input.discountRate,
  });

  const warnings: string[] = [];
  const netInvestmentJpy = input.cost.totalCostJpy - input.cost.subsidyJpy;
  if (netInvestmentJpy < 0) {
    warnings.push(
      'SUBSIDY_EXCEEDS_COST: the subsidy is larger than the system cost. ' +
        'Check the figures before presenting this to a customer.',
    );
  }

  const retail = input.tariff.purchasePriceJpyPerKWh.value;
  const escalation = input.tariff.annualPriceEscalation.value;
  const promoPrice = input.tariff.exportPriceJpyPerKWh.value;
  const promoYears = input.tariff.exportPriceYears.value;
  const postPrice = input.tariff.postExportPriceJpyPerKWh.value;
  const selfRatio = input.consumption.selfConsumptionRatio.value;
  const opex = input.cost.annualOpexJpy.value;
  const discount = input.discountRate.value;

  const yearly: YearlyEconomics[] = [];
  let cumulative = 0;
  let npv = -netInvestmentJpy;
  const cashflows: number[] = [-netInvestmentJpy];

  input.yearlyGenerationKWh.forEach((generationKWh, i) => {
    const year = i + 1;
    // Self-consumption cannot exceed what the site actually uses.
    const selfConsumedKWh = Math.min(
      generationKWh * selfRatio,
      input.consumption.annualConsumptionKWh,
    );
    const exportedKWh = Math.max(0, generationKWh - selfConsumedKWh);

    const escalated = retail * Math.pow(1 + escalation, year - 1);
    const billSavingJpy = selfConsumedKWh * escalated;
    const exportRevenueJpy = exportedKWh * (year <= promoYears ? promoPrice : postPrice);
    const scheduledCostJpy = input.cost.scheduledCostsJpy[year] ?? 0;
    const netBenefitJpy = billSavingJpy + exportRevenueJpy - opex - scheduledCostJpy;

    cumulative += netBenefitJpy;
    const discountedNetJpy = netBenefitJpy / Math.pow(1 + discount, year);
    npv += discountedNetJpy;
    cashflows.push(netBenefitJpy);

    yearly.push({
      year,
      generationKWh,
      selfConsumedKWh,
      exportedKWh,
      billSavingJpy,
      exportRevenueJpy,
      opexJpy: opex,
      scheduledCostJpy,
      netBenefitJpy,
      cumulativeNetJpy: cumulative,
      discountedNetJpy,
    });
  });

  if (
    input.consumption.annualConsumptionKWh > 0 &&
    yearly[0] &&
    yearly[0].generationKWh * selfRatio > input.consumption.annualConsumptionKWh
  ) {
    warnings.push(
      'SELF_CONSUMPTION_CAPPED: the array generates more than the site consumes, so the ' +
        'bill saving is limited by consumption. Surplus is valued at the export price.',
    );
  }

  return {
    algorithmVersion: ECONOMICS_ENGINE_VERSION,
    netInvestmentJpy,
    yearly,
    firstYearBenefitJpy: yearly[0]?.netBenefitJpy ?? 0,
    lifetimeBenefitJpy: yearly.reduce((s, y) => s + y.billSavingJpy + y.exportRevenueJpy, 0),
    lifetimeNetJpy: cumulative - netInvestmentJpy,
    paybackYears: computePayback(yearly, netInvestmentJpy),
    npvJpy: npv,
    irr: computeIrr(cashflows),
    warnings,
  };
}

/**
 * Payback period, interpolated inside the crossing year so the answer reads as
 * "8.4 years" rather than jumping from 8 to 9.
 */
export function computePayback(
  yearly: readonly YearlyEconomics[],
  netInvestmentJpy: number,
): number | null {
  if (netInvestmentJpy <= 0) return 0;
  let previous = 0;
  for (const y of yearly) {
    if (y.cumulativeNetJpy >= netInvestmentJpy) {
      const gain = y.cumulativeNetJpy - previous;
      if (gain <= 0) return y.year;
      return y.year - 1 + (netInvestmentJpy - previous) / gain;
    }
    previous = y.cumulativeNetJpy;
  }
  return null;
}

/**
 * Internal rate of return by bisection on NPV.
 *
 * Bisection rather than Newton: it cannot diverge, and it is deterministic —
 * the same cashflows always give the same answer to the same precision, which
 * a saved quotation depends on. Returns null when no sign change exists in the
 * bracket, which is the honest answer for a project that never pays back.
 */
export function computeIrr(
  cashflows: readonly number[],
  lower = -0.9999,
  upper = 10,
  iterations = 200,
): number | null {
  const npvAt = (rate: number): number =>
    cashflows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + rate, i), 0);

  let lo = lower;
  let hi = upper;
  let fLo = npvAt(lo);
  let fHi = npvAt(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (fMid === 0) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

function validate(input: EconomicsInput): void {
  if (input.yearlyGenerationKWh.length === 0) {
    throw new RangeError('yearlyGenerationKWh must contain at least one year');
  }
  for (const [i, g] of input.yearlyGenerationKWh.entries()) {
    if (!Number.isFinite(g) || g < 0) {
      throw new RangeError(`Generation for year ${i + 1} must be >= 0, got ${g}`);
    }
  }
  if (!(input.cost.totalCostJpy >= 0)) {
    throw new RangeError(`totalCostJpy must be >= 0, got ${input.cost.totalCostJpy}`);
  }
  if (!(input.cost.subsidyJpy >= 0)) {
    throw new RangeError(`subsidyJpy must be >= 0, got ${input.cost.subsidyJpy}`);
  }
  const ratio = input.consumption.selfConsumptionRatio.value;
  if (!(ratio >= 0) || ratio > 1) {
    throw new RangeError(`selfConsumptionRatio must be in [0, 1], got ${ratio}`);
  }
  if (!(input.consumption.annualConsumptionKWh >= 0)) {
    throw new RangeError(
      `annualConsumptionKWh must be >= 0, got ${input.consumption.annualConsumptionKWh}`,
    );
  }
  if (input.discountRate.value <= -1) {
    throw new RangeError(`discountRate must be > -1, got ${input.discountRate.value}`);
  }
}
