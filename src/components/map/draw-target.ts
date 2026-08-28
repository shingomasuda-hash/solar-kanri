import type { DrawMode } from './roof-map';

/**
 * Which form field a polygon drawn on the map belongs in.
 *
 * Trivial, and extracted anyway. A single shared buffer used to send every
 * drawn polygon to the roof outline field, so drawing a skylight silently
 * replaced the roof the operator had just traced — and drawing an exclusion
 * zone was impossible without pasting GeoJSON by hand. The browser suite could
 * not catch it, because it runs without a Maps key and therefore never draws.
 * A pure function can at least be asserted directly.
 */
export type DrawTarget = 'roof' | 'exclusion';

export function drawTargetFor(mode: DrawMode): DrawTarget | null {
  if (mode === 'exclusion') return 'exclusion';
  if (mode === 'roof') return 'roof';
  // 'select' edits an existing feature and 'none' draws nothing; neither
  // produces a polygon that belongs in a create form.
  return null;
}
