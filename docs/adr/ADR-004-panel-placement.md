# ADR-004: Panel placement algorithm

**Status:** Accepted · 2026-08-26

## Context

Module count drives capacity, which drives yield, which drives the entire
economic case. It is the single most consequential number the system produces.

The tempting implementation is `usableArea / panelArea`. It is wrong, and
wrong in the optimistic direction: it ignores that rectangles do not tile an
arbitrary polygon, that rows have ragged ends, that obstacles interrupt whole
rows rather than just their own area, and that gaps accumulate. On the project's
own `multiple-exclusions` fixture it overstates by a wide margin. Rule 13 of the
brief bans it, and a regression test asserts we beat it downward.

## Decision

An exhaustive, deterministic search over three axes, with an optional per-row
refinement.

```
usable = (roof ⊖ setback) − ⋃(exclusion ⊕ clearance)

for each array angle θ:                    ← 0°, 90°, and the roof's dominant edges
  rotate the usable region by −θ
  for each orientation ∈ {portrait, landscape}:
    for each grid phase offset (dx, dy):   ← 5 × 5 sub-cell offsets
      pack axis-aligned rows
      for each row: slide independently along x   ← 5 sub-cell shifts
      score the layout
keep the best
```

Every candidate rectangle is geometrically proven to fit: fully inside the
usable region, clear of every exclusion, non-overlapping, gap respected.

### Why all three axes

Measured on the fixture suite (`scripts/bench-layout.ts`):

| Fixture                 | origin only | + offsets | + per-row | full (with angle search) |
| ----------------------- | ----------- | --------- | --------- | ------------------------ |
| rotated rectangle (37°) | 16          | 18        | 20        | **27**                   |
| triangle                | 9           | 10        | **11**    | 11                       |
| trapezoid               | 26          | 26        | **27**    | 27                       |
| axis-aligned rectangle  | 27          | 27        | 27        | 27                       |

The angle search is worth **+69 %** on a rotated building. That is the headline:
without it, whether a proposal is competitive depends on which way the house
happens to face. Offsets and the per-row slide are each worth a module or two on
tapered shapes and nothing on rectangles — cheap insurance rather than the main
event.

A dedicated test asserts **rotation invariance**: the same rectangle at 0°, 13°,
37°, 45°, 71°, 90° and 128° must give the same count. This is the property most
likely to silently regress and the one a customer would most reasonably expect.

### Why deterministic

A quotation saved today must reproduce byte-identically in five years, when a
customer queries their contract. So: no randomness, no wall-clock budget, no
parallel non-determinism. `Math.random` is banned in `src/core` by a lint rule
and `Date.now` alongside it. The search terminates on a **candidate-rectangle
cap** instead of a timeout, and reports `hitCandidateCap` when it truncates.

### Scoring

Module count dominates (weighted ×1000). Ties break on compactness — mean
squared distance from the region centroid — which prefers one contiguous block
over the same count scattered across the roof: fewer strings, less cable, and
what a customer expects to see. Compactness can never trade away a module.

## Performance

The hot loop is rectangle containment, called ~700k times on the 60 × 40 m
industrial fixture. `Region` (`src/core/geo/region.ts`) indexes boundary edges
into a uniform grid and **precomputes which cells are wholly interior**, so the
overwhelming majority of queries on a large roof are answered without touching a
single edge. That fixture runs in ~0.9 s; before the interior map it exceeded
30 s.

Containment for a convex rectangle is exact via three conditions:

1. every corner is in the region,
2. no region edge _properly_ crosses a rectangle edge (collinear overlap is
   allowed — a module may sit flush against an eave),
3. no region vertex lies strictly inside the rectangle — which is what catches a
   skylight swallowed whole, where no edge crossing occurs at all.

## Rejected alternatives

**Integer programming / MILP.** Genuinely optimal, and genuinely a solver
dependency, a non-deterministic runtime and a model nobody on the team can debug
at 5 pm before a customer meeting. Rule 14 requires benchmark evidence before
adopting a more complex optimiser; the grid search is currently within a few
percent of the area ceiling on every fixture. Revisit if a fixture shows a
persistent double-digit gap.

**Simulated annealing / genetic search.** Non-deterministic, which contradicts
the reproducibility requirement outright.

**Free-form per-panel placement.** Would beat a row-aligned array on paper.
Rejected because installers build rows: an array that is optimal on screen and
unbuildable on a roof is worth nothing.

## Consequences

- `layout-engine-v1` is stamped on every result and persisted with it.
- Fixture floors are recorded as regression guards. A better algorithm may raise
  them — and must, in the same commit, so gains are locked in.
- Mixed orientation within one layout is not supported. Portrait and landscape
  are evaluated as whole-array alternatives. A candidate for v2, with a fixture
  to prove it pays.
