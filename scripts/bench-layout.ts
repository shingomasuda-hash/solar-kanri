/**
 * Layout engine benchmark. Run with `npx tsx scripts/bench-layout.ts`.
 *
 * Reports module count and work done per fixture, plus the gain from each
 * search axis. Rule 14 of the project brief requires evidence before adopting a
 * more complex optimiser; this is where that evidence comes from.
 */
import { computeLayout } from '../src/core/layout/engine';
import type { LayoutConstraints, SearchOptions } from '../src/core/layout/types';
import { ROOF_FIXTURES, type RoofFixture } from '../tests/fixtures/synthetic-roofs';

function run(f: RoofFixture, search: Partial<SearchOptions> = {}) {
  const constraints: LayoutConstraints = {
    setbackM: f.setbackM,
    panelGapM: f.panelGapM,
    exclusionClearanceM: f.exclusionClearanceM,
    allowedOrientations: ['portrait', 'landscape'],
  };
  const t0 = process.hrtime.bigint();
  const r = computeLayout({
    roof: f.roof,
    exclusions: f.exclusions,
    panel: f.panel,
    constraints,
    search,
  });
  return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

console.log(
  'fixture'.padEnd(26),
  'count'.padStart(6),
  'band'.padStart(12),
  'ms'.padStart(7),
  'rects'.padStart(9),
);
for (const f of ROOF_FIXTURES) {
  const { r, ms } = run(f);
  console.log(
    f.name.padEnd(26),
    String(r.panelCount).padStart(6),
    `[${f.expectedMin},${f.expectedMax}]`.padStart(12),
    ms.toFixed(0).padStart(7),
    String(r.stats.candidateRectsTested).padStart(9),
  );
}

console.log('\nMarginal value of each search axis (module count):');
console.log(
  'fixture'.padEnd(26),
  'origin-only'.padStart(12),
  '+offsets'.padStart(9),
  '+per-row'.padStart(9),
  'full'.padStart(6),
);
for (const f of ROOF_FIXTURES) {
  if (f.expectedMax === 0) continue;
  const originOnly = run(f, {
    offsetStepsX: 1,
    offsetStepsY: 1,
    perRowOffsetSearch: false,
    angleCandidatesDeg: [0, 90],
  }).r.panelCount;
  const offsets = run(f, {
    perRowOffsetSearch: false,
    angleCandidatesDeg: [0, 90],
  }).r.panelCount;
  const perRow = run(f, { angleCandidatesDeg: [0, 90] }).r.panelCount;
  const full = run(f).r.panelCount;
  console.log(
    f.name.padEnd(26),
    String(originOnly).padStart(12),
    String(offsets).padStart(9),
    String(perRow).padStart(9),
    String(full).padStart(6),
  );
}
