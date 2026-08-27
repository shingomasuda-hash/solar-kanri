import { describe, expect, it } from 'vitest';
import {
  DemoFiguresError,
  UnsourcedCoefficientError,
  assertProductionReady,
  assertSimulatable,
  demoValue,
  findDemo,
  findUnsourced,
  isDemo,
  isPlaceholder,
  isVerified,
  placeholder,
  sourced,
} from '@core/solar/sourced';

const REAL = {
  kind: 'manufacturer-datasheet' as const,
  citation: 'TestCo TC-400 datasheet rev 3, table 2',
  url: 'https://example.invalid/tc-400.pdf',
  effectiveDate: '2026-01-01',
};

describe('sourced values', () => {
  it('keeps the value and its provenance together', () => {
    const s = sourced(-0.0035, REAL);
    expect(s.value).toBe(-0.0035);
    expect(s.source.citation).toContain('TC-400');
    expect(isVerified(s)).toBe(true);
  });

  it('marks placeholders as unverified', () => {
    const p = placeholder(0.95, 'copied from a blog post');
    expect(isVerified(p)).toBe(false);
    expect(p.source.kind).toBe('unverified-placeholder');
    expect(p.source.note).toContain('blog post');
  });
});

describe('findUnsourced', () => {
  it('finds nothing in a fully sourced tree', () => {
    expect(findUnsourced({ a: sourced(1, REAL), b: { c: sourced(2, REAL) } })).toEqual([]);
  });

  it('reports the dotted path of each placeholder', () => {
    const tree = {
      module: { tempCoeff: sourced(-0.0035, REAL), degradation: placeholder(0.005, 'guess') },
      losses: { wiring: placeholder(0.98, 'guess') },
    };
    expect(findUnsourced(tree).sort()).toEqual(['losses.wiring', 'module.degradation']);
  });

  it('walks arrays', () => {
    expect(findUnsourced({ list: [sourced(1, REAL), placeholder(2, 'x')] })).toEqual(['list[1]']);
  });

  it('ignores plain numbers, strings and nulls', () => {
    expect(findUnsourced({ a: 1, b: 'x', c: null, d: undefined })).toEqual([]);
    expect(findUnsourced(42)).toEqual([]);
    expect(findUnsourced(null)).toEqual([]);
  });

  it('labels a bare placeholder at the root', () => {
    expect(findUnsourced(placeholder(1, 'x'))).toEqual(['(root)']);
  });
});

describe('assertProductionReady', () => {
  it('passes a fully sourced tree', () => {
    expect(() => assertProductionReady({ a: sourced(1, REAL) })).not.toThrow();
  });

  it('throws naming every offending field', () => {
    try {
      assertProductionReady({ x: placeholder(1, 'a'), y: { z: placeholder(2, 'b') } });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsourcedCoefficientError);
      const e = err as UnsourcedCoefficientError;
      expect([...e.fields].sort()).toEqual(['x', 'y.z']);
      // The message has to tell an administrator what to actually do.
      expect(e.message).toContain('admin console');
      expect(e.message).toContain('x');
      expect(e.message).toContain('y.z');
    }
  });
});

/**
 * The demonstration tier exists so the sales flow can be walked through before
 * any datasheet has been collected. It is only safe because it is a *third*
 * state: computable, but never quotable. These tests pin both edges — a demo
 * figure that stopped computing would make the demo useless, and one that
 * started passing assertProductionReady would put an invented temperature
 * coefficient into a customer's quotation.
 */
describe('demonstration figures', () => {
  const demo = demoValue(0.97, 'representative wiring loss');

  it('is neither a placeholder nor verified', () => {
    expect(isDemo(demo)).toBe(true);
    expect(isPlaceholder(demo)).toBe(false);
    expect(isVerified(demo)).toBe(false);
  });

  it('does not appear in findUnsourced — nothing is missing, it is just not traceable', () => {
    expect(findUnsourced({ a: demo })).toEqual([]);
    expect(findDemo({ a: demo })).toEqual(['a']);
  });

  it('computes: the engines accept it', () => {
    expect(() => assertSimulatable({ a: demo, b: sourced(1, REAL) })).not.toThrow();
  });

  it('never reaches a customer: assertProductionReady refuses it by name', () => {
    try {
      assertProductionReady({ losses: { wiring: demo }, module: { temp: demo } });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DemoFiguresError);
      const e = err as DemoFiguresError;
      expect([...e.fields].sort()).toEqual(['losses.wiring', 'module.temp']);
    }
  });

  it('reports a missing value ahead of a demo one', () => {
    // Both are wrong, but they need different actions, and "nobody supplied
    // this" is the more fundamental of the two.
    expect(() => assertProductionReady({ a: placeholder(1, 'x'), b: demo })).toThrow(
      UnsourcedCoefficientError,
    );
  });

  it('still refuses a placeholder at the simulate boundary', () => {
    expect(() => assertSimulatable({ a: placeholder(1, 'x') })).toThrow(UnsourcedCoefficientError);
  });
});
