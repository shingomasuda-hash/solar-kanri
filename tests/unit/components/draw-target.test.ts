import { describe, expect, it } from 'vitest';
import { drawTargetFor } from '@/components/map/draw-target';

/**
 * Where a drawn polygon goes.
 *
 * One shared buffer used to send every polygon to the roof outline, so drawing
 * a skylight replaced the roof the operator had just traced, and drawing an
 * exclusion zone was impossible without pasting GeoJSON by hand. Reported from
 * real use. The browser suite runs without a Maps key and therefore never
 * draws, so this is the level at which the decision can be pinned at all —
 * worth saying plainly rather than implying wider coverage.
 */
describe('drawTargetFor', () => {
  it('sends an exclusion-mode polygon to the exclusion field', () => {
    expect(drawTargetFor('exclusion')).toBe('exclusion');
  });

  it('sends a roof-mode polygon to the roof field', () => {
    expect(drawTargetFor('roof')).toBe('roof');
  });

  it('routes nothing while selecting or idle', () => {
    // Editing an existing feature must not populate a create form.
    expect(drawTargetFor('select')).toBeNull();
    expect(drawTargetFor('none')).toBeNull();
  });
});
