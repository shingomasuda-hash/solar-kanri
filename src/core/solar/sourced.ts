/**
 * Provenance for every number that enters a production calculation.
 *
 * Rule 19 of the project brief: temperature coefficients, wiring losses, CO2
 * factors, degradation rates and irradiance may NOT come from an assistant's
 * recollection. Each must trace to a datasheet, an official standard, an
 * official public dataset, or a named administrator decision.
 *
 * This is enforced in the type system rather than by convention: a bare
 * `number` cannot be used as a coefficient, and {@link assertProductionReady}
 * refuses to run a calculation whose inputs are not all verified.
 */

export type SourceKind =
  /** Manufacturer datasheet for a specific model and revision. */
  | 'manufacturer-datasheet'
  /** Published standard or industry guideline (JIS, JPEA, IEC, ...). */
  | 'official-standard'
  /** Official public dataset (NEDO METPV, PVGIS, AMeDAS, ...). */
  | 'public-dataset'
  /** Response from an external API, captured at a point in time. */
  | 'provider-api'
  /** A named administrator entered this value and owns it. */
  | 'administrator-input'
  /**
   * A seeded default that NOBODY has verified yet. Present so the system is
   * runnable in development. {@link assertProductionReady} rejects it.
   */
  | 'unverified-placeholder';

export interface CoefficientSource {
  readonly kind: SourceKind;
  /** Human-readable citation: document title, table number, revision. */
  readonly citation: string;
  /** Where the value can be checked. */
  readonly url?: string;
  /** ISO date from which the value applies. */
  readonly effectiveDate?: string;
  /** ISO timestamp of the check, and who performed it. */
  readonly verifiedAt?: string;
  readonly verifiedBy?: string;
  /** Anything a reviewer needs to know: units, caveats, scope. */
  readonly note?: string;
}

/** A number that cannot be used without saying where it came from. */
export interface Sourced<T = number> {
  readonly value: T;
  readonly source: CoefficientSource;
}

export function sourced<T>(value: T, source: CoefficientSource): Sourced<T> {
  return { value, source };
}

/** Convenience for development seeds. Never passes {@link assertProductionReady}. */
export function placeholder<T>(value: T, note: string): Sourced<T> {
  return {
    value,
    source: {
      kind: 'unverified-placeholder',
      citation: 'UNVERIFIED PLACEHOLDER — requires an administrator to supply a real source',
      note,
    },
  };
}

export function isVerified(s: Sourced<unknown>): boolean {
  return s.source.kind !== 'unverified-placeholder';
}

export class UnsourcedCoefficientError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(
      `Refusing to run a production calculation: ${fields.length} coefficient(s) have no ` +
        `verified source (${fields.join(', ')}). Supply a datasheet, standard, dataset or ` +
        `administrator decision for each in the admin console before quoting.`,
    );
    this.name = 'UnsourcedCoefficientError';
    this.fields = fields;
  }
}

/**
 * Walk an object tree and collect the paths of every {@link Sourced} value that
 * is still an unverified placeholder.
 */
export function findUnsourced(input: unknown, path = ''): string[] {
  if (input === null || typeof input !== 'object') return [];
  if (isSourcedShape(input)) {
    return isVerified(input) ? [] : [path || '(root)'];
  }
  const out: string[] = [];
  if (Array.isArray(input)) {
    input.forEach((item, i) => out.push(...findUnsourced(item, `${path}[${i}]`)));
    return out;
  }
  for (const [key, val] of Object.entries(input)) {
    out.push(...findUnsourced(val, path ? `${path}.${key}` : key));
  }
  return out;
}

function isSourcedShape(v: object): v is Sourced<unknown> {
  return 'value' in v && 'source' in v && typeof (v as Sourced).source === 'object';
}

/**
 * Throw unless every coefficient reachable from `input` carries a real source.
 * Call this at the boundary of any calculation whose result a customer sees.
 */
export function assertProductionReady(input: unknown): void {
  const missing = findUnsourced(input);
  if (missing.length > 0) throw new UnsourcedCoefficientError(missing);
}
