import { assertProductionReady } from './sourced';
import {
  DAYS_IN_MONTH,
  MONTHS,
  SOLAR_ENGINE_VERSION,
  type CalculationBreakdown,
  type Month,
  type MonthlyYield,
  type SimulationInput,
  type SimulationResult,
} from './types';

/**
 * Deterministic photovoltaic yield calculation.
 *
 * NOTHING here is inferred by a language model at runtime — rule 18 of the
 * project brief. Every coefficient arrives as a {@link Sourced} value from the
 * database, and {@link assertProductionReady} refuses to proceed if any of them
 * is still an unverified placeholder.
 *
 * The model, per month m:
 *
 *   E_m = P_dc x H_m x f_temp(m) x f_inv x f_wire x f_soil x f_shade x f_other
 *
 * where H_m is plane-of-array irradiation for the month in kWh/m2 and
 *
 *   f_temp(m) = 1 + gamma_Pmax x (T_cell(m) - 25)
 *   T_cell(m) = T_ambient(m) + dT(mounting)
 *
 * Summing the months and dividing by P_dc x sum(H_m) recovers the JPEA overall
 * design factor K, so the result can be cross-checked against the industry
 * formula EPY = PAS x HA x K x 365 (JPEA 表示ガイドライン). Working monthly
 * rather than with an annual average matters because the temperature derate is
 * strongly seasonal — an annual mean understates summer losses and overstates
 * winter ones.
 *
 * See docs/solar-calculation-spec.md, which is the single source of truth for
 * this model and its citations.
 */
export function simulateGeneration(input: SimulationInput): SimulationResult {
  validate(input);
  // Refuse to produce a customer-facing number from unverified coefficients.
  assertProductionReady({
    module: input.module,
    coefficients: input.coefficients,
    irradiance: input.irradiance.source,
  });

  const warnings: string[] = [];
  if (!input.irradiance.isPlaneOfArray) {
    warnings.push(
      'IRRADIANCE_NOT_PLANE_OF_ARRAY: the dataset supplied horizontal irradiance and a ' +
        'tilt/azimuth correction was applied. Confirm the correction table before quoting.',
    );
  }

  const { losses, thermal } = input.coefficients;
  const gamma = input.module.pmaxTempCoeffPerK.value;
  const tempRise = thermal.temperatureRiseK[input.mounting].value;

  const systemFactor =
    losses.inverterEfficiency.value *
    losses.wiringFactor.value *
    losses.soilingFactor.value *
    losses.shadingFactor.value *
    losses.otherApprovedFactor.value;

  const monthly: MonthlyYield[] = [];
  let annualGenerationKWh = 0;
  let annualIrradiationKWhPerM2 = 0;

  for (const month of MONTHS) {
    const days = DAYS_IN_MONTH[month];
    const perDay = input.irradiance.climate.planeOfArrayKWhPerM2PerDay[month];
    const irradiationKWhPerM2 = perDay * days;
    const ambient = input.irradiance.climate.ambientTempC[month];

    // Cell temperature rise scales with irradiance; using the monthly mean
    // daily irradiation as the driver keeps the model closed-form and
    // reproducible. dT is quoted at 1 kW/m2, and a 1 kW/m2 hour is 1 kWh/m2,
    // so mean irradiance over daylight hours is what scales it.
    const cellTempC = ambient + tempRise * irradianceScale(perDay);
    const temperatureFactor = 1 + gamma * (cellTempC - 25);

    const generationKWh =
      input.installedKw * irradiationKWhPerM2 * temperatureFactor * systemFactor;

    monthly.push({ month, irradiationKWhPerM2, cellTempC, temperatureFactor, generationKWh });
    annualGenerationKWh += generationKWh;
    annualIrradiationKWhPerM2 += irradiationKWhPerM2;
  }

  const idealKWh = input.installedKw * annualIrradiationKWhPerM2;
  const overallDesignFactorK = idealKWh > 0 ? annualGenerationKWh / idealKWh : 0;

  // Irradiation-weighted mean, so the reported factor reconstructs the total.
  const meanTemperatureFactor = systemFactor > 0 ? overallDesignFactorK / systemFactor : 0;

  const degradation = input.module.annualDegradation.value;
  const yearlyGenerationKWh: number[] = [];
  for (let y = 0; y < input.projectionYears; y++) {
    yearlyGenerationKWh.push(annualGenerationKWh * Math.pow(1 - degradation, y));
  }

  const breakdown: CalculationBreakdown = {
    annualIrradiationKWhPerM2,
    meanTemperatureFactor,
    inverterEfficiency: losses.inverterEfficiency.value,
    wiringFactor: losses.wiringFactor.value,
    soilingFactor: losses.soilingFactor.value,
    shadingFactor: losses.shadingFactor.value,
    otherApprovedFactor: losses.otherApprovedFactor.value,
    overallDesignFactorK,
  };

  return {
    algorithmVersion: SOLAR_ENGINE_VERSION,
    installedKw: input.installedKw,
    monthly,
    annualGenerationKWh,
    specificYieldKWhPerKw: input.installedKw > 0 ? annualGenerationKWh / input.installedKw : 0,
    performanceRatio: overallDesignFactorK,
    yearlyGenerationKWh,
    lifetimeGenerationKWh: yearlyGenerationKWh.reduce((a, b) => a + b, 0),
    annualCo2AvoidedKg: annualGenerationKWh * input.coefficients.gridCo2FactorKgPerKWh.value,
    breakdown,
    warnings,
  };
}

/**
 * Mean plane-of-array irradiance during daylight, expressed in kW/m2, from the
 * mean daily irradiation. The temperature rise dT is defined at 1 kW/m2, so
 * this is the factor that scales it.
 *
 * `DAYLIGHT_HOURS` is the effective number of hours over which the day's energy
 * arrives. It is a modelling constant of this engine, not a physical
 * measurement, and is documented as such in the spec.
 */
function irradianceScale(dailyKWhPerM2: number): number {
  const DAYLIGHT_HOURS = 10;
  return dailyKWhPerM2 / DAYLIGHT_HOURS;
}

function validate(input: SimulationInput): void {
  if (!(input.installedKw >= 0)) {
    throw new RangeError(`installedKw must be >= 0, got ${input.installedKw}`);
  }
  if (!Number.isInteger(input.projectionYears) || input.projectionYears < 1) {
    throw new RangeError(`projectionYears must be an integer >= 1, got ${input.projectionYears}`);
  }
  const gamma = input.module.pmaxTempCoeffPerK.value;
  if (gamma > 0) {
    throw new RangeError(
      `Pmax temperature coefficient must be negative (power falls as cells heat), got ${gamma}. ` +
        'Datasheets quote it as %/degC — remember to divide by 100 and keep the sign.',
    );
  }
  if (gamma < -0.02) {
    throw new RangeError(
      `Pmax temperature coefficient ${gamma} /K is implausible. Expected roughly -0.002 to ` +
        '-0.005 /K. A value near -0.35 suggests %/degC was stored without dividing by 100.',
    );
  }
  const d = input.module.annualDegradation.value;
  if (d < 0 || d >= 1) {
    throw new RangeError(`annualDegradation must be in [0, 1), got ${d}`);
  }
  for (const [name, factor] of Object.entries(input.coefficients.losses)) {
    const v = (factor as { value: number }).value;
    if (!(v > 0) || v > 1) {
      throw new RangeError(
        `Loss factor ${name} must be a multiplier in (0, 1], got ${v}. ` +
          'A 5 % loss is 0.95, not 5 or 0.05.',
      );
    }
  }
  for (const month of MONTHS) {
    const h = input.irradiance.climate.planeOfArrayKWhPerM2PerDay[month];
    if (!Number.isFinite(h) || h < 0) {
      throw new RangeError(`Irradiation for month ${month} must be >= 0, got ${h}`);
    }
    const t = input.irradiance.climate.ambientTempC[month];
    if (!Number.isFinite(t)) {
      throw new RangeError(`Ambient temperature for month ${month} must be finite, got ${t}`);
    }
  }
}

/** Sum of the monthly daily-mean irradiation, expressed as kWh/m2/day (HA). */
export function annualMeanDailyIrradiation(perDay: Readonly<Record<Month, number>>): number {
  let total = 0;
  for (const m of MONTHS) total += perDay[m] * DAYS_IN_MONTH[m];
  return total / 365;
}
