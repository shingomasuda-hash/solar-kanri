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
   * A representative figure loaded for demonstration. Roughly right for a
   * Japanese residential system, traceable to nothing. It exists so the whole
   * sales flow can be walked through before an administrator has collected real
   * datasheets, and it is deliberately a different thing from a placeholder:
   * {@link assertSimulatable} lets it run, {@link assertProductionReady}
   * refuses it, so a demo figure can be explored on screen but can never leave
   * the building inside an issued quotation.
   */
  | 'demo-approximation'
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

/** Nothing was supplied at all. Blocks every calculation. */
export function demoValue<T>(value: T, note: string): Sourced<T> {
  return {
    value,
    source: {
      kind: 'demo-approximation',
      citation: 'DEMO APPROXIMATION — representative figure, not traceable to any document',
      note,
    },
  };
}

export function isPlaceholder(s: Sourced<unknown>): boolean {
  return s.source.kind === 'unverified-placeholder';
}

/** Roughly right, traceable to nothing. May be explored, never quoted. */
export function isDemo(s: Sourced<unknown>): boolean {
  return s.source.kind === 'demo-approximation';
}

/** Traceable to a datasheet, standard, dataset, API or a named administrator. */
export function isVerified(s: Sourced<unknown>): boolean {
  return !isPlaceholder(s) && !isDemo(s);
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
 * Walk an object tree and collect the paths of every {@link Sourced} value the
 * predicate matches. Paths are dotted and indexed, so the caller can name the
 * offending field rather than saying "something is unsourced".
 */
export class DemoFiguresError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(
      `Refusing to issue a customer-facing document: ${fields.length} figure(s) are ` +
        `demonstration approximations (${fields.join(', ')}). Replace them with datasheet, ` +
        'standard or administrator-sourced values in the admin console first.',
    );
    this.name = 'DemoFiguresError';
    this.fields = fields;
  }
}

export function findSourced(
  input: unknown,
  match: (s: Sourced<unknown>) => boolean,
  path = '',
): string[] {
  if (input === null || typeof input !== 'object') return [];
  if (isSourcedShape(input)) {
    return match(input) ? [path || '(root)'] : [];
  }
  const out: string[] = [];
  if (Array.isArray(input)) {
    input.forEach((item, i) => out.push(...findSourced(item, match, `${path}[${i}]`)));
    return out;
  }
  for (const [key, val] of Object.entries(input)) {
    out.push(...findSourced(val, match, path ? `${path}.${key}` : key));
  }
  return out;
}

/** Paths of every value nobody has supplied at all. */
export function findUnsourced(input: unknown, path = ''): string[] {
  return findSourced(input, isPlaceholder, path);
}

/** Paths of every value that is a demonstration figure. */
export function findDemo(input: unknown, path = ''): string[] {
  return findSourced(input, isDemo, path);
}

function isSourcedShape(v: object): v is Sourced<unknown> {
  return 'value' in v && 'source' in v && typeof (v as Sourced).source === 'object';
}

/**
 * Throw unless every coefficient reachable from `input` has *something* behind
 * it. Demonstration figures pass; placeholders do not.
 *
 * This is the engines' guard. It is deliberately weaker than
 * {@link assertProductionReady}: the engines are allowed to compute a number
 * from figures marked as a demonstration, because exploring the flow on screen
 * is useful and harmless. What must never happen is that number reaching a
 * customer, and that is a different boundary — see below.
 */
export function assertSimulatable(input: unknown): void {
  const missing = findUnsourced(input);
  if (missing.length > 0) throw new UnsourcedCoefficientError(missing);
}

/**
 * Throw unless every coefficient reachable from `input` is genuinely traceable.
 *
 * Call this wherever a figure becomes a commitment to a customer — issuing a
 * quotation, above all. A demonstration figure is roughly right, which is
 * precisely what makes it dangerous here: it looks like an answer.
 */
export function assertProductionReady(input: unknown): void {
  const missing = findUnsourced(input);
  if (missing.length > 0) throw new UnsourcedCoefficientError(missing);
  const demo = findDemo(input);
  if (demo.length > 0) throw new DemoFiguresError(demo);
}
