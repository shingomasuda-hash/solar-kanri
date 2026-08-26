/**
 * Quotation arithmetic.
 *
 * Pure and deterministic, like every other engine here — money is never
 * computed by a language model (brief rule 23).
 *
 * All amounts are integer JPY. Floats are how rounding bugs get into invoices:
 * 0.1 + 0.2 is not 0.3, and a customer who adds up the line items themselves
 * will notice.
 */

export const QUOTATION_ENGINE_VERSION = 'quotation-engine-v1';

export type QuotationCategory =
  'PANEL' | 'INVERTER' | 'MOUNTING' | 'CONSTRUCTION' | 'ELECTRICAL' | 'BATTERY' | 'OTHER';

export interface QuotationLineInput {
  readonly category: QuotationCategory;
  readonly name: string;
  readonly description?: string | null;
  readonly quantity: number;
  readonly unit: string;
  readonly unitPriceJpy: number;
}

export interface QuotationLine extends QuotationLineInput {
  /** quantity × unitPrice, rounded to the yen. */
  readonly amountJpy: number;
}

export interface QuotationTotalsInput {
  readonly items: readonly QuotationLineInput[];
  readonly discountJpy: number;
  readonly subsidyJpy: number;
  /** Consumption tax rate as a fraction, e.g. 0.1 for 10%. */
  readonly taxRate: number;
}

export interface QuotationTotals {
  readonly algorithmVersion: string;
  readonly lines: readonly QuotationLine[];
  readonly subtotalJpy: number;
  readonly discountJpy: number;
  /** Subtotal after discount, before tax. */
  readonly taxableJpy: number;
  readonly taxJpy: number;
  /** Taxable + tax. What the customer pays before any subsidy is received. */
  readonly totalJpy: number;
  readonly subsidyJpy: number;
  /**
   * Total minus subsidy: the customer's real outlay, and the figure the
   * economic model treats as the investment.
   */
  readonly netCostJpy: number;
  readonly byCategory: Readonly<Record<QuotationCategory, number>>;
  readonly warnings: readonly string[];
}

export class QuotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotationError';
  }
}

const CATEGORIES: readonly QuotationCategory[] = [
  'PANEL',
  'INVERTER',
  'MOUNTING',
  'CONSTRUCTION',
  'ELECTRICAL',
  'BATTERY',
  'OTHER',
];

/**
 * Round half away from zero, which is what Japanese invoicing convention and
 * ordinary expectation both assume. JavaScript's `Math.round` rounds half UP,
 * so -0.5 becomes -0 rather than -1 — a difference that shows up on discount
 * lines.
 */
export function roundYen(value: number): number {
  if (!Number.isFinite(value)) {
    throw new QuotationError(`金額が数値ではありません / Amount is not a finite number: ${value}`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function calculateQuotation(input: QuotationTotalsInput): QuotationTotals {
  validate(input);

  const warnings: string[] = [];
  const lines: QuotationLine[] = input.items.map((item) => ({
    ...item,
    amountJpy: roundYen(item.quantity * item.unitPriceJpy),
  }));

  const subtotalJpy = lines.reduce((sum, l) => sum + l.amountJpy, 0);
  const discountJpy = roundYen(input.discountJpy);

  if (discountJpy > subtotalJpy) {
    throw new QuotationError(
      `値引き ${discountJpy.toLocaleString('ja-JP')} 円が小計 ` +
        `${subtotalJpy.toLocaleString('ja-JP')} 円を超えています。`,
    );
  }

  const taxableJpy = subtotalJpy - discountJpy;
  // Tax is computed once on the discounted total, not per line: per-line
  // rounding would not sum to the same figure, and the document has to add up.
  const taxJpy = roundYen(taxableJpy * input.taxRate);
  const totalJpy = taxableJpy + taxJpy;
  const subsidyJpy = roundYen(input.subsidyJpy);

  if (subsidyJpy > totalJpy) {
    warnings.push(
      'SUBSIDY_EXCEEDS_TOTAL: 補助金が見積総額を上回っています。金額を確認してください。',
    );
  }

  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      lines.filter((l) => l.category === c).reduce((s, l) => s + l.amountJpy, 0),
    ]),
  ) as Record<QuotationCategory, number>;

  return {
    algorithmVersion: QUOTATION_ENGINE_VERSION,
    lines,
    subtotalJpy,
    discountJpy,
    taxableJpy,
    taxJpy,
    totalJpy,
    subsidyJpy,
    netCostJpy: totalJpy - subsidyJpy,
    byCategory,
    warnings,
  };
}

function validate(input: QuotationTotalsInput): void {
  if (input.taxRate < 0 || input.taxRate > 1) {
    throw new QuotationError(
      `消費税率は 0 〜 1 で指定してください（10% は 0.1）。got ${input.taxRate}`,
    );
  }
  if (input.discountJpy < 0) {
    throw new QuotationError('値引きは0以上で入力してください。');
  }
  if (input.subsidyJpy < 0) {
    throw new QuotationError('補助金は0以上で入力してください。');
  }
  for (const [i, item] of input.items.entries()) {
    if (!Number.isFinite(item.quantity) || item.quantity < 0) {
      throw new QuotationError(`${i + 1} 行目: 数量は0以上の数値で入力してください。`);
    }
    if (!Number.isInteger(item.unitPriceJpy)) {
      // Integer yen throughout — see the module comment.
      throw new QuotationError(`${i + 1} 行目: 単価は円単位の整数で入力してください。`);
    }
    if (item.name.trim() === '') {
      throw new QuotationError(`${i + 1} 行目: 品名を入力してください。`);
    }
  }
}

/**
 * Build the standard line items for a system, as a starting point an operator
 * then edits. Prices come from the caller — this function never invents one,
 * and omits any line it was not given a price for.
 */
export function suggestLineItems(params: {
  readonly panelLabel: string;
  readonly panelCount: number;
  readonly panelUnitPriceJpy: number;
  readonly inverterLabel?: string;
  readonly inverterCount?: number;
  readonly inverterUnitPriceJpy?: number;
  readonly installedKw: number;
  readonly mountingUnitPriceJpyPerKw?: number;
  readonly constructionJpy?: number;
  readonly electricalJpy?: number;
}): QuotationLineInput[] {
  const items: QuotationLineInput[] = [
    {
      category: 'PANEL',
      name: `太陽電池モジュール ${params.panelLabel}`,
      quantity: params.panelCount,
      unit: '枚',
      unitPriceJpy: params.panelUnitPriceJpy,
    },
  ];

  if (params.inverterLabel && params.inverterCount && params.inverterUnitPriceJpy) {
    items.push({
      category: 'INVERTER',
      name: `パワーコンディショナ ${params.inverterLabel}`,
      quantity: params.inverterCount,
      unit: '台',
      unitPriceJpy: params.inverterUnitPriceJpy,
    });
  }
  if (params.mountingUnitPriceJpyPerKw) {
    items.push({
      category: 'MOUNTING',
      name: '架台一式',
      quantity: Number(params.installedKw.toFixed(2)),
      unit: 'kW',
      unitPriceJpy: params.mountingUnitPriceJpyPerKw,
    });
  }
  if (params.constructionJpy) {
    items.push({
      category: 'CONSTRUCTION',
      name: '設置工事費',
      quantity: 1,
      unit: '式',
      unitPriceJpy: params.constructionJpy,
    });
  }
  if (params.electricalJpy) {
    items.push({
      category: 'ELECTRICAL',
      name: '電気工事費',
      quantity: 1,
      unit: '式',
      unitPriceJpy: params.electricalJpy,
    });
  }
  return items;
}
