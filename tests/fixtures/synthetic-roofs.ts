import type { Point2D, Polygon2D } from '@core/geo/types';
import type { PanelSpec } from '@core/layout/types';

/**
 * Synthetic roof fixtures for the panel-placement regression suite.
 *
 * These exist because eyeballing a layout on a map proves nothing. Every case
 * carries hand-derived expectations, so a change that quietly loses modules
 * fails the build instead of shipping.
 *
 * How the bounds are set:
 *  - `expectedMax` is a hand-derived UPPER bound — usable area divided by the
 *    module's pitch area (module + gap). Exceeding it is impossible without a
 *    containment bug, so it is a hard correctness ceiling.
 *  - `expectedMin` is a REGRESSION FLOOR: the count layout-engine-v1 actually
 *    achieves, minus a small margin. It is not a claim about optimality. A
 *    better algorithm may raise these numbers; when it does, raise the floor in
 *    the same commit so the gain is locked in.
 *  - Where a shape admits an exact answer, min and max are equal and derived
 *    purely by hand.
 *
 * Module pitch area: TEST_PANEL 1.02 x 1.67 = 1.7034 m2, SMALL_PANEL
 * 0.82 x 1.02 = 0.8364 m2 (both at the 0.02 m gap used below).
 */

export const rect = (w: number, h: number, x = 0, y = 0): Polygon2D => ({
  outer: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
  holes: [],
});

const ring = (...pts: [number, number][]): Point2D[] => pts.map(([x, y]) => ({ x, y }));

/**
 * Reference module: a mainstream 60-cell residential panel footprint.
 * Dimensions are a rounded, deliberately generic 1650 x 1000 mm so the
 * fixtures test the algorithm rather than any manufacturer's product.
 */
export const TEST_PANEL: PanelSpec = {
  id: 'test-panel-1650x1000',
  widthMm: 1000,
  heightMm: 1650,
  ratedPowerW: 400,
};

/** A smaller module, for narrow-roof cases. */
export const SMALL_PANEL: PanelSpec = {
  id: 'test-panel-1000x800',
  widthMm: 800,
  heightMm: 1000,
  ratedPowerW: 180,
};

export interface RoofFixture {
  readonly name: string;
  readonly description: string;
  readonly roof: Polygon2D;
  readonly exclusions: readonly Polygon2D[];
  readonly panel: PanelSpec;
  readonly setbackM: number;
  readonly panelGapM: number;
  readonly exclusionClearanceM: number;
  /** Inclusive lower bound on module count. A regression drops below this. */
  readonly expectedMin: number;
  /** Inclusive upper bound. Exceeding it means the geometry check is broken. */
  readonly expectedMax: number;
  /** How the bounds above were arrived at. */
  readonly rationale: string;
}

export const ROOF_FIXTURES: readonly RoofFixture[] = [
  {
    name: 'rectangle-10x6',
    description: 'Plain 10 m x 6 m rectangular roof face.',
    roof: rect(10, 6),
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 27,
    expectedMax: 27,
    rationale:
      'Exact, hand-derived. Usable area 9.4 x 5.4 m. Portrait (1.00 x 1.65 m, ' +
      'pitch 1.02 x 1.67): cols = floor((9.4 + 0.02) / 1.02) = 9, rows = ' +
      'floor((5.4 + 0.02) / 1.67) = 3, so 27. Landscape: cols = ' +
      'floor(9.42 / 1.67) = 5, rows = floor(5.42 / 1.02) = 5, so 25. The engine ' +
      'must find the better of the two, and 27 is the true optimum for a ' +
      'uniform array — neither 26 nor 28 is acceptable.',
  },
  {
    name: 'rectangle-exact-fit',
    description: 'Roof sized so exactly 4 x 2 portrait modules fit with no slack.',
    // 4 modules across: 4*1.00 + 3*0.02 = 4.06; 2 rows: 2*1.65 + 1*0.02 = 3.32.
    // Plus 0.3 m setback on all four sides.
    roof: rect(4.06 + 0.6, 3.32 + 0.6),
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 8,
    expectedMax: 8,
    rationale:
      'Constructed for an exact fit: 8 portrait modules and not one more. ' +
      'A 9th would require violating the setback or the gap, so any count above ' +
      '8 proves the containment test is leaking.',
  },
  {
    name: 'l-shape',
    description: 'L-shaped roof, 12 m x 11 m overall with a 7 m x 6 m bite removed.',
    roof: { outer: ring([0, 0], [12, 0], [12, 5], [5, 5], [5, 11], [0, 11]), holes: [] },
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 36,
    expectedMax: 45,
    rationale:
      'Usable area is two limbs, 11.4 x 4.4 and 4.4 x 6.0 = 76.6 m2, so the ' +
      'ceiling is floor(76.6 / 1.7034) = 45. v1 achieves 38 by sliding each row ' +
      'independently; a rigid single-origin lattice manages noticeably fewer, ' +
      'which is what the search-axis tests assert separately.',
  },
  {
    name: 'trapezoid',
    description: 'Trapezoidal hip-roof face, 14 m base tapering to 8 m over 6 m.',
    roof: { outer: ring([0, 0], [14, 0], [11, 6], [3, 6]), holes: [] },
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 25,
    expectedMax: 33,
    rationale:
      'Usable area 55.8 m2 after the setback, so the ceiling is ' +
      'floor(55.8 / 1.7034) = 32, allowing 33 for rounding. v1 achieves 27: the ' +
      'sloping sides waste the end of every upper row, so the area bound is not ' +
      'reachable by any rectangular array.',
  },
  {
    name: 'triangle',
    description: 'Triangular gable end, 12 m base x 6 m rise.',
    roof: { outer: ring([0, 0], [12, 0], [6, 6]), holes: [] },
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 10,
    expectedMax: 17,
    rationale:
      'Usable area 27.8 m2, ceiling floor(27.8 / 1.7034) = 16, allowing 17 for ' +
      'rounding. v1 achieves 11 — a triangle is the worst case for rectangular ' +
      'packing, since only the bottom rows are wide enough for a full run and ' +
      'the apex takes nothing at all.',
  },
  {
    name: 'rectangle-with-skylight',
    description: '10 m x 8 m roof with one 1.2 m x 1.2 m skylight near the centre.',
    roof: rect(10, 8),
    exclusions: [rect(1.2, 1.2, 4.4, 3.4)],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 28,
    expectedMax: 39,
    rationale:
      'Usable area 66.4 m2 after the setback and the cleared skylight, ceiling ' +
      'floor(66.4 / 1.7034) = 38, allowing 39 for rounding. v1 achieves 30. The ' +
      'skylight plus its 0.3 m clearance is a 1.8 m square hole, which costs ' +
      'more than its own area because it interrupts whole rows.',
  },
  {
    name: 'multiple-exclusions',
    description: '12 m x 9 m roof with a skylight, a vent and a maintenance strip.',
    roof: rect(12, 9),
    exclusions: [
      rect(1.0, 1.0, 2.0, 2.0),
      rect(0.6, 0.6, 8.0, 6.0),
      rect(12, 0.8, 0, 4.1), // full-width maintenance walkway
    ],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 35,
    expectedMax: 45,
    rationale:
      'Usable area 76.0 m2, ceiling floor(76.0 / 1.7034) = 44, allowing 45 for ' +
      'rounding. v1 achieves 38. The full-width walkway plus clearance splits ' +
      'the roof into two bands, so the engine has to pack each band separately.',
  },
  {
    name: 'roof-with-hole',
    description: '14 m x 10 m roof drawn with a courtyard hole in the polygon itself.',
    roof: {
      outer: rect(14, 10).outer,
      holes: [ring([5, 4], [9, 4], [9, 7], [5, 7])],
    },
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 53,
    expectedMax: 64,
    rationale:
      'Usable area 109.4 m2, ceiling floor(109.4 / 1.7034) = 64. v1 achieves 56. ' +
      'The point of this case is that a hole in the source polygon must be ' +
      'honoured exactly like an exclusion zone; the containment assertions catch ' +
      'any module straying into the courtyard independently of the count.',
  },
  {
    name: 'very-narrow',
    description: '20 m x 1.9 m strip — a dormer or a lean-to.',
    roof: rect(20, 1.9),
    exclusions: [],
    panel: SMALL_PANEL,
    setbackM: 0.2,
    panelGapM: 0.02,
    exclusionClearanceM: 0.2,
    expectedMin: 23,
    expectedMax: 23,
    rationale:
      'Exact, hand-derived. Usable strip 19.6 x 1.5 m. The 1.00 m edge must run ' +
      'across the strip (1.00 <= 1.5 < 2.02, so exactly one row), leaving the ' +
      '0.80 m edge along it: floor((19.6 + 0.02) / 0.82) = 23.',
  },
  {
    name: 'too-small',
    description: '2 m x 1.5 m roof — smaller than one module plus its setback.',
    roof: rect(2, 1.5),
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 0,
    expectedMax: 0,
    rationale:
      'Usable area is 1.4 x 0.9 m; the module is 1.00 x 1.65 m either way round. ' +
      'Nothing fits. The engine must return zero cleanly with a warning, not throw.',
  },
  {
    name: 'setback-consumes-roof',
    description: '1 m x 1 m roof with a 0.6 m setback.',
    roof: rect(1, 1),
    exclusions: [],
    panel: SMALL_PANEL,
    setbackM: 0.6,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 0,
    expectedMax: 0,
    rationale: 'The setback erodes the roof to nothing. Must warn, not crash.',
  },
  {
    name: 'large-industrial',
    description: '60 m x 40 m flat industrial roof with four plant exclusions.',
    roof: rect(60, 40),
    exclusions: [rect(4, 4, 10, 10), rect(4, 4, 40, 10), rect(4, 4, 10, 28), rect(4, 4, 40, 28)],
    panel: TEST_PANEL,
    setbackM: 1.0,
    panelGapM: 0.02,
    exclusionClearanceM: 1.0,
    expectedMin: 1120,
    expectedMax: 1215,
    rationale:
      'Usable area 2063.5 m2 after the 1 m setback and four cleared plant blocks, ' +
      'ceiling floor(2063.5 / 1.7034) = 1211, allowing 1215 for rounding. v1 ' +
      'achieves 1146. This case also guards the performance budget: it must ' +
      'finish in under a second, which it only does because Region answers ' +
      'interior queries from its precomputed cell map.',
  },
  {
    name: 'irregular-polygon',
    description: 'Irregular 9-sided roof traced from an awkward real building.',
    roof: {
      outer: ring([0, 0], [8, 0], [10, 2], [10, 6], [7, 9], [3, 9], [1, 7], [1, 4], [-1, 2]),
      holes: [],
    },
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 31,
    expectedMax: 40,
    rationale:
      'Usable area 67.6 m2, ceiling floor(67.6 / 1.7034) = 39, allowing 40 for ' +
      'rounding. v1 achieves 33. Every side sits at a different angle, so this ' +
      'case is specifically about the angle search — an axis-only search does ' +
      'measurably worse.',
  },
  {
    name: 'rotated-rectangle',
    description: 'The 10 m x 6 m rectangle turned 37 degrees.',
    roof: {
      outer: rect(10, 6).outer.map((p) => ({
        x: p.x * Math.cos(0.6458) - p.y * Math.sin(0.6458),
        y: p.x * Math.sin(0.6458) + p.y * Math.cos(0.6458),
      })),
      holes: [],
    },
    exclusions: [],
    panel: TEST_PANEL,
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    expectedMin: 27,
    expectedMax: 27,
    rationale:
      'The same roof as rectangle-10x6, only turned 37 degrees. The count MUST be ' +
      'identical: a building does not become a worse solar site by facing ' +
      'north-east. This is the single most valuable fixture in the suite.',
  },
];

export function fixtureByName(name: string): RoofFixture {
  const f = ROOF_FIXTURES.find((r) => r.name === name);
  if (!f) throw new Error(`Unknown roof fixture: ${name}`);
  return f;
}
