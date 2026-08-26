import { describe, expect, it } from 'vitest';
import {
  addPlacementAt,
  movePlacement,
  removePlacement,
  rotatePlacement,
  validatePlacements,
} from '@core/layout/manual';
import { computeLayout } from '@core/layout/engine';
import { computeUsableArea } from '@core/layout/usable-area';
import type { LayoutConstraints, PanelPlacement } from '@core/layout/types';
import { TEST_PANEL, rect } from '@tests/fixtures/synthetic-roofs';

const constraints: LayoutConstraints = {
  setbackM: 0.3,
  panelGapM: 0.02,
  exclusionClearanceM: 0.3,
  allowedOrientations: ['portrait', 'landscape'],
};

const roof = rect(10, 8);
const usable = computeUsableArea(roof, [], constraints);
const auto = computeLayout({ roof, exclusions: [], panel: TEST_PANEL, constraints });

describe('validatePlacements', () => {
  it('accepts the layout the engine itself produced', () => {
    const r = validatePlacements(auto.placements, usable, constraints);
    expect(r.valid).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.invalidPanelIds).toEqual([]);
  });

  it('accepts an empty layout', () => {
    expect(validatePlacements([], usable, constraints).valid).toBe(true);
  });

  it('flags a module dragged off the roof', () => {
    const moved = [...auto.placements];
    moved[0] = movePlacement(moved[0]!, 50, 0);
    const r = validatePlacements(moved, usable, constraints);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.kind === 'outside-usable-area')).toBe(true);
    expect(r.invalidPanelIds).toContain(moved[0]!.id);
  });

  it('flags a module dragged into the setback band', () => {
    const one: PanelPlacement = {
      id: 'x',
      orientation: 'portrait',
      row: 0,
      col: 0,
      // Centre 0.4 m from the eaves: half the 1.65 m module hangs into the setback.
      rect: { cx: 5, cy: 0.4, width: 1.0, height: 1.65, rotation: 0 },
    };
    const r = validatePlacements([one], usable, constraints);
    expect(r.valid).toBe(false);
    expect(r.violations[0]!.kind).toBe('outside-usable-area');
  });

  it('flags two overlapping modules', () => {
    const a = auto.placements[0]!;
    const b = movePlacement(auto.placements[1]!, 0, 0);
    const overlapping = [a, { ...b, rect: { ...b.rect, cx: a.rect.cx + 0.1, cy: a.rect.cy } }];
    const r = validatePlacements(overlapping, usable, constraints);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.kind === 'overlaps-panel')).toBe(true);
  });

  it('flags modules that are closer than the required gap', () => {
    const a: PanelPlacement = {
      id: 'a',
      orientation: 'portrait',
      row: 0,
      col: 0,
      rect: { cx: 3, cy: 4, width: 1.0, height: 1.65, rotation: 0 },
    };
    // 1.005 m apart centre-to-centre: not overlapping, but only 5 mm of gap.
    const b: PanelPlacement = { ...a, id: 'b', rect: { ...a.rect, cx: 4.005 } };
    const r = validatePlacements([a, b], usable, constraints);
    expect(r.valid).toBe(false);
    expect(r.violations.some((v) => v.kind === 'gap-too-small')).toBe(true);
    expect(r.invalidPanelIds).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('accepts modules exactly one gap apart', () => {
    const a: PanelPlacement = {
      id: 'a',
      orientation: 'portrait',
      row: 0,
      col: 0,
      rect: { cx: 3, cy: 4, width: 1.0, height: 1.65, rotation: 0 },
    };
    const b: PanelPlacement = { ...a, id: 'b', rect: { ...a.rect, cx: 4.02 } };
    expect(validatePlacements([a, b], usable, constraints).valid).toBe(true);
  });

  it('reports each offending module exactly once', () => {
    const a: PanelPlacement = {
      id: 'a',
      orientation: 'portrait',
      row: 0,
      col: 0,
      rect: { cx: 50, cy: 50, width: 1.0, height: 1.65, rotation: 0 },
    };
    const b: PanelPlacement = { ...a, id: 'b', rect: { ...a.rect, cx: 50.2 } };
    const r = validatePlacements([a, b], usable, constraints);
    expect([...r.invalidPanelIds].sort()).toEqual(['a', 'b']);
  });
});

describe('manual edit operations', () => {
  const p: PanelPlacement = {
    id: 'p',
    orientation: 'portrait',
    row: 0,
    col: 0,
    rect: { cx: 3, cy: 4, width: 1.0, height: 1.65, rotation: 0 },
  };

  it('moves without changing size', () => {
    const m = movePlacement(p, 1.5, -2);
    expect(m.rect.cx).toBeCloseTo(4.5, 9);
    expect(m.rect.cy).toBeCloseTo(2, 9);
    expect(m.rect.width).toBe(p.rect.width);
    expect(m.rect.height).toBe(p.rect.height);
  });

  it('rotates 90 degrees by swapping the sides and the orientation label', () => {
    const r = rotatePlacement(p);
    expect(r.rect.width).toBe(1.65);
    expect(r.rect.height).toBe(1.0);
    expect(r.orientation).toBe('landscape');
    expect(rotatePlacement(r).orientation).toBe('portrait');
    // Rotating twice returns the original geometry.
    expect(rotatePlacement(r).rect).toEqual(p.rect);
  });

  it('keeps the centre fixed when rotating', () => {
    const r = rotatePlacement(p);
    expect(r.rect.cx).toBe(p.rect.cx);
    expect(r.rect.cy).toBe(p.rect.cy);
  });

  it('adds a module matching the existing array', () => {
    const added = addPlacementAt([p], { x: 7, y: 2 }, 1);
    expect(added).not.toBeNull();
    expect(added!.rect.width).toBe(p.rect.width);
    expect(added!.rect.cx).toBe(7);
    expect(added!.id).toBe('manual-1');
  });

  it('cannot infer a module for an empty layout', () => {
    expect(addPlacementAt([], { x: 0, y: 0 }, 1)).toBeNull();
  });

  it('removes by id', () => {
    expect(removePlacement([p, { ...p, id: 'q' }], 'p').map((x) => x.id)).toEqual(['q']);
    expect(removePlacement([p], 'missing')).toHaveLength(1);
  });
});
