import { describe, expect, it } from 'vitest';
import {
  QuotationError,
  calculateQuotation,
  roundYen,
  suggestLineItems,
  type QuotationLineInput,
} from '@core/quotation';

const items: QuotationLineInput[] = [
  { category: 'PANEL', name: 'モジュール', quantity: 20, unit: '枚', unitPriceJpy: 45_000 },
  { category: 'INVERTER', name: 'PCS', quantity: 1, unit: '台', unitPriceJpy: 180_000 },
  { category: 'CONSTRUCTION', name: '設置工事', quantity: 1, unit: '式', unitPriceJpy: 300_000 },
];

describe('roundYen', () => {
  it('rounds half away from zero, not half up', () => {
    expect(roundYen(0.5)).toBe(1);
    expect(roundYen(1.5)).toBe(2);
    // Math.round(-0.5) is -0, which is wrong for a discount line.
    expect(roundYen(-0.5)).toBe(-1);
    expect(roundYen(-1.5)).toBe(-2);
  });

  it('leaves integers alone', () => {
    expect(roundYen(1234)).toBe(1234);
    expect(roundYen(-1234)).toBe(-1234);
  });

  it('rejects non-finite amounts', () => {
    expect(() => roundYen(NaN)).toThrow(QuotationError);
    expect(() => roundYen(Infinity)).toThrow(QuotationError);
  });
});

describe('calculateQuotation', () => {
  it('computes line amounts, subtotal, tax and total', () => {
    const q = calculateQuotation({ items, discountJpy: 0, subsidyJpy: 0, taxRate: 0.1 });
    expect(q.lines[0]!.amountJpy).toBe(900_000);
    expect(q.subtotalJpy).toBe(900_000 + 180_000 + 300_000);
    expect(q.taxableJpy).toBe(1_380_000);
    expect(q.taxJpy).toBe(138_000);
    expect(q.totalJpy).toBe(1_518_000);
  });

  it('applies the discount before tax', () => {
    const q = calculateQuotation({ items, discountJpy: 80_000, subsidyJpy: 0, taxRate: 0.1 });
    expect(q.taxableJpy).toBe(1_300_000);
    expect(q.taxJpy).toBe(130_000);
    expect(q.totalJpy).toBe(1_430_000);
  });

  it('subtracts the subsidy after tax, not before', () => {
    // A subsidy is a receipt, not a price reduction — taxing the pre-subsidy
    // amount is the correct treatment and gives a different number.
    const q = calculateQuotation({ items, discountJpy: 0, subsidyJpy: 100_000, taxRate: 0.1 });
    expect(q.taxJpy).toBe(138_000);
    expect(q.totalJpy).toBe(1_518_000);
    expect(q.netCostJpy).toBe(1_418_000);
  });

  it('adds up: the line items always sum to the subtotal', () => {
    const awkward: QuotationLineInput[] = [
      { category: 'PANEL', name: 'a', quantity: 3, unit: '枚', unitPriceJpy: 33_333 },
      { category: 'MOUNTING', name: 'b', quantity: 5.55, unit: 'kW', unitPriceJpy: 41_111 },
      { category: 'OTHER', name: 'c', quantity: 0.1, unit: '式', unitPriceJpy: 7 },
    ];
    const q = calculateQuotation({
      items: awkward,
      discountJpy: 0,
      subsidyJpy: 0,
      taxRate: 0.1,
    });
    expect(q.lines.reduce((s, l) => s + l.amountJpy, 0)).toBe(q.subtotalJpy);
    for (const line of q.lines) expect(Number.isInteger(line.amountJpy)).toBe(true);
    expect(Number.isInteger(q.taxJpy)).toBe(true);
    expect(Number.isInteger(q.totalJpy)).toBe(true);
  });

  it('groups amounts by category', () => {
    const q = calculateQuotation({ items, discountJpy: 0, subsidyJpy: 0, taxRate: 0.1 });
    expect(q.byCategory.PANEL).toBe(900_000);
    expect(q.byCategory.INVERTER).toBe(180_000);
    expect(q.byCategory.CONSTRUCTION).toBe(300_000);
    expect(q.byCategory.BATTERY).toBe(0);
  });

  it('handles a zero-rate quotation', () => {
    const q = calculateQuotation({ items, discountJpy: 0, subsidyJpy: 0, taxRate: 0 });
    expect(q.taxJpy).toBe(0);
    expect(q.totalJpy).toBe(q.subtotalJpy);
  });

  it('handles an empty quotation', () => {
    const q = calculateQuotation({ items: [], discountJpy: 0, subsidyJpy: 0, taxRate: 0.1 });
    expect(q.subtotalJpy).toBe(0);
    expect(q.totalJpy).toBe(0);
    expect(q.netCostJpy).toBe(0);
  });

  it('warns when the subsidy exceeds the total', () => {
    const q = calculateQuotation({ items, discountJpy: 0, subsidyJpy: 9_000_000, taxRate: 0.1 });
    expect(q.warnings.join(' ')).toContain('SUBSIDY_EXCEEDS_TOTAL');
    expect(q.netCostJpy).toBeLessThan(0);
  });

  it('refuses a discount larger than the subtotal', () => {
    expect(() =>
      calculateQuotation({ items, discountJpy: 9_000_000, subsidyJpy: 0, taxRate: 0.1 }),
    ).toThrow(QuotationError);
  });

  it('refuses a non-integer unit price', () => {
    expect(() =>
      calculateQuotation({
        items: [{ category: 'OTHER', name: 'x', quantity: 1, unit: '式', unitPriceJpy: 100.5 }],
        discountJpy: 0,
        subsidyJpy: 0,
        taxRate: 0.1,
      }),
    ).toThrow(/整数/);
  });

  it('refuses nonsense rates, quantities, discounts and blank names', () => {
    const base = { items, discountJpy: 0, subsidyJpy: 0, taxRate: 0.1 };
    expect(() => calculateQuotation({ ...base, taxRate: 10 })).toThrow(/消費税率/);
    expect(() => calculateQuotation({ ...base, discountJpy: -1 })).toThrow(/値引き/);
    expect(() => calculateQuotation({ ...base, subsidyJpy: -1 })).toThrow(/補助金/);
    expect(() =>
      calculateQuotation({
        ...base,
        items: [{ category: 'OTHER', name: 'x', quantity: -1, unit: '式', unitPriceJpy: 1 }],
      }),
    ).toThrow(/数量/);
    expect(() =>
      calculateQuotation({
        ...base,
        items: [{ category: 'OTHER', name: '  ', quantity: 1, unit: '式', unitPriceJpy: 1 }],
      }),
    ).toThrow(/品名/);
  });

  it('is deterministic and stamps its version', () => {
    const a = calculateQuotation({ items, discountJpy: 1000, subsidyJpy: 500, taxRate: 0.1 });
    const b = calculateQuotation({ items, discountJpy: 1000, subsidyJpy: 500, taxRate: 0.1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.algorithmVersion).toBe('quotation-engine-v1');
  });
});

describe('suggestLineItems', () => {
  it('always includes the modules', () => {
    const lines = suggestLineItems({
      panelLabel: 'SAMPLE-400',
      panelCount: 20,
      panelUnitPriceJpy: 45_000,
      installedKw: 8,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.category).toBe('PANEL');
    expect(lines[0]!.quantity).toBe(20);
  });

  it('omits any line whose price the caller did not supply', () => {
    // The function must never invent a price it was not given.
    const lines = suggestLineItems({
      panelLabel: 'X',
      panelCount: 10,
      panelUnitPriceJpy: 40_000,
      installedKw: 4,
      constructionJpy: 250_000,
    });
    expect(lines.map((l) => l.category)).toEqual(['PANEL', 'CONSTRUCTION']);
  });

  it('includes every line when everything is supplied', () => {
    const lines = suggestLineItems({
      panelLabel: 'X',
      panelCount: 10,
      panelUnitPriceJpy: 40_000,
      inverterLabel: 'PCS',
      inverterCount: 1,
      inverterUnitPriceJpy: 180_000,
      installedKw: 4,
      mountingUnitPriceJpyPerKw: 30_000,
      constructionJpy: 250_000,
      electricalJpy: 80_000,
    });
    expect(lines.map((l) => l.category)).toEqual([
      'PANEL',
      'INVERTER',
      'MOUNTING',
      'CONSTRUCTION',
      'ELECTRICAL',
    ]);
  });
});
