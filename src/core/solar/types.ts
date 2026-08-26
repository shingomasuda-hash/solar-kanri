import type { Sourced } from './sourced';

/** Version stamp for the generation calculation. Persisted with every result. */
export const SOLAR_ENGINE_VERSION = 'solar-engine-v1';

/** Month index 1..12. */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export const MONTHS: readonly Month[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** Days per month, non-leap. Solar yield is quoted per standard year. */
export const DAYS_IN_MONTH: Readonly<Record<Month, number>> = {
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

/**
 * Electrical and thermal characteristics of a module, from its datasheet.
 * Every field is {@link Sourced} because every one of them moves the answer.
 */
export interface ModuleElectricalSpec {
  readonly manufacturer: string;
  readonly model: string;
  readonly datasheetVersion: string;
  /** Nameplate DC power at STC, watts. */
  readonly ratedPowerW: Sourced;
  /** Pmax temperature coefficient, fraction per Kelvin (negative, e.g. -0.0035). */
  readonly pmaxTempCoeffPerK: Sourced;
  /** NOCT / NMOT, degrees Celsius. */
  readonly noctC: Sourced;
  /** Annual power degradation, fraction per year (e.g. 0.005 = 0.5 %/yr). */
  readonly annualDegradation: Sourced;
}

/**
 * System-level derates. Each is a MULTIPLIER in (0, 1]: 0.95 means a 5 % loss.
 * Kept separate rather than rolled into one number so a reviewer can see which
 * assumption is doing the work, and so each carries its own citation.
 */
export interface SystemLossFactors {
  /** Inverter / power-conditioner conversion efficiency. */
  readonly inverterEfficiency: Sourced;
  /** DC and AC wiring losses. */
  readonly wiringFactor: Sourced;
  /** Soiling, snow and array mismatch. */
  readonly soilingFactor: Sourced;
  /** Shading from surroundings, if not already in the irradiance data. */
  readonly shadingFactor: Sourced;
  /** Anything else the administrator has approved, with its reason. */
  readonly otherApprovedFactor: Sourced;
}

/** How the array is mounted, which sets the cell-temperature rise. */
export type MountingType = 'roof-flush' | 'roof-raised' | 'ground-mounted';

export interface ThermalModel {
  /**
   * Cell temperature rise above ambient at 1 kW/m2, Kelvin, per mounting type.
   * Roof-flush modules run hotter than a ground-mounted array because air
   * cannot circulate behind them.
   */
  readonly temperatureRiseK: Readonly<Record<MountingType, Sourced>>;
}

/** Monthly irradiance and ambient temperature at the site. */
export interface MonthlyClimate {
  /**
   * Irradiation in the array's plane, kWh/m2 per day, averaged over the month.
   * "Plane of array" means tilt and azimuth are already accounted for.
   */
  readonly planeOfArrayKWhPerM2PerDay: Readonly<Record<Month, number>>;
  /** Mean daytime ambient air temperature, degrees Celsius. */
  readonly ambientTempC: Readonly<Record<Month, number>>;
}

/** Everything the engine needs about the environment, with its provenance. */
export interface IrradianceDataset {
  readonly providerId: string;
  readonly providerName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly tiltDeg: number;
  readonly azimuthDeg: number;
  readonly climate: MonthlyClimate;
  readonly source: Sourced<string>;
  /**
   * True when the figures are plane-of-array. False means the engine was given
   * horizontal irradiance and had to apply an administrator-supplied
   * tilt/azimuth correction, which is a weaker basis and is reported as such.
   */
  readonly isPlaneOfArray: boolean;
}

export interface CoefficientSet {
  readonly id: string;
  readonly name: string;
  readonly losses: SystemLossFactors;
  readonly thermal: ThermalModel;
  /** Grid CO2 emission factor, kg-CO2 per kWh. */
  readonly gridCo2FactorKgPerKWh: Sourced;
}

export interface SimulationInput {
  readonly installedKw: number;
  readonly module: ModuleElectricalSpec;
  readonly mounting: MountingType;
  readonly coefficients: CoefficientSet;
  readonly irradiance: IrradianceDataset;
  /** Years to project. Year 1 is un-degraded. */
  readonly projectionYears: number;
}

export interface MonthlyYield {
  readonly month: Month;
  readonly irradiationKWhPerM2: number;
  readonly cellTempC: number;
  readonly temperatureFactor: number;
  readonly generationKWh: number;
}

export interface SimulationResult {
  readonly algorithmVersion: string;
  readonly installedKw: number;
  readonly monthly: readonly MonthlyYield[];
  /** Year-1 generation, kWh. */
  readonly annualGenerationKWh: number;
  /** Year-1 generation per installed kW, kWh/kW/year. */
  readonly specificYieldKWhPerKw: number;
  /** Performance ratio: actual output over the ideal output for that irradiance. */
  readonly performanceRatio: number;
  /** Per-year generation over `projectionYears`, with degradation applied. */
  readonly yearlyGenerationKWh: readonly number[];
  readonly lifetimeGenerationKWh: number;
  readonly annualCo2AvoidedKg: number;
  /** Every factor that produced the number, for audit and for the PDF footnote. */
  readonly breakdown: CalculationBreakdown;
  readonly warnings: readonly string[];
}

export interface CalculationBreakdown {
  readonly annualIrradiationKWhPerM2: number;
  readonly meanTemperatureFactor: number;
  readonly inverterEfficiency: number;
  readonly wiringFactor: number;
  readonly soilingFactor: number;
  readonly shadingFactor: number;
  readonly otherApprovedFactor: number;
  /**
   * The JPEA 総合設計係数 K equivalent: the product of every derate including
   * the annual-mean temperature factor. Quoted so results can be checked
   * against the industry formula EPY = PAS x HA x K x 365.
   */
  readonly overallDesignFactorK: number;
}
