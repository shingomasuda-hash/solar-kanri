import { describe, expect, it } from 'vitest';
import {
  UnsourcedCoefficientError,
  assertProductionReady,
  findUnsourced,
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
    expect(findUnsourced(tree).sort()).toEqual([
      'losses.wiring',
      'module.degradation',
    ]);
  });

  it('walks arrays', () => {
    expect(findUnsourced({ list: [sourced(1, REAL), placeholder(2, 'x')] })).toEqual([
      'list[1]',
    ]);
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
