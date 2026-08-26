import { describe, expect, it } from 'vitest';
import { computeLayout } from '@core/layout/engine';
import { computeUsableArea } from '@core/layout/usable-area';
import { DEFAULT_SEARCH, type LayoutConstraints, type LayoutInput } from '@core/layout/types';
import { Region, orientedRectsOverlap } from '@core/geo/region';
import { rectCorners } from '@core/geo/polygon';
import { ROOF_FIXTURES, TEST_PANEL, type RoofFixture } from '@tests/fixtures/synthetic-roofs';

function constraintsOf(f: RoofFixture): LayoutConstraints {
  return {
    setbackM: f.setbackM,
    panelGapM: f.panelGapM,
    exclusionClearanceM: f.exclusionClearanceM,
    allowedOrientations: ['portrait', 'landscape'],
  };
}

function inputOf(f: RoofFixture, search: Partial<typeof DEFAULT_SEARCH> = {}): LayoutInput {
  return {
    roof: f.roof,
    exclusions: f.exclusions,
    panel: f.panel,
    constraints: constraintsOf(f),
    search,
  };
}

describe.each(ROOF_FIXTURES.map((f) => [f.name, f] as const))(
  'panel placement regression: %s',
  (_name, fixture) => {
    const result = computeLayout(inputOf(fixture));

    it('produces a module count inside the expected band', () => {
      expect(result.panelCount).toBeGreaterThanOrEqual(fixture.expectedMin);
      expect(result.panelCount).toBeLessThanOrEqual(fixture.expectedMax);
    });

    it('places every module fully inside the usable area', () => {
      const region = new Region(result.usable.region);
      for (const p of result.placements) {
        expect(
          region.containsRect(rectCorners(p.rect)),
          `module ${p.id} is not inside the usable area`,
        ).toBe(true);
      }
    });

    it('never overlaps two modules', () => {
      const ps = result.placements;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          expect(
            orientedRectsOverlap(ps[i]!.rect, ps[j]!.rect),
            `modules ${ps[i]!.id} and ${ps[j]!.id} overlap`,
          ).toBe(false);
        }
      }
    });

    it('honours the module gap between neighbours', () => {
      const gap = fixture.panelGapM;
      const ps = result.placements;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const grown = {
            ...ps[i]!.rect,
            width: ps[i]!.rect.width + gap * 0.98,
            height: ps[i]!.rect.height + gap * 0.98,
          };
          expect(
            orientedRectsOverlap(grown, ps[j]!.rect),
            `modules ${ps[i]!.id} and ${ps[j]!.id} are closer than the ${gap} m gap`,
          ).toBe(false);
        }
      }
    });

    it('reports installed capacity consistent with the module count', () => {
      expect(result.installedKw).toBeCloseTo(
        (result.panelCount * fixture.panel.ratedPowerW) / 1000,
        9,
      );
    });

    it('never claims coverage above 100 percent of the usable area', () => {
      expect(result.usableCoverageRatio).toBeLessThanOrEqual(1.0000001);
      expect(result.roofCoverageRatio).toBeLessThanOrEqual(1.0000001);
    });

    it('stamps the algorithm version', () => {
      expect(result.algorithmVersion).toBe('layout-engine-v1');
    });

    it('is deterministic across repeated runs', () => {
      const again = computeLayout(inputOf(fixture));
      expect(again.panelCount).toBe(result.panelCount);
      expect(again.angleDeg).toBe(result.angleDeg);
      expect(again.orientation).toBe(result.orientation);
      expect(JSON.stringify(again.placements)).toBe(JSON.stringify(result.placements));
    });

    it('never truncates the search', () => {
      expect(result.stats.hitCandidateCap).toBe(false);
    });
  },
);

describe('work budget', () => {
  /**
   * A deterministic stand-in for a wall-clock assertion, which would be flaky
   * in CI. If a change makes the search explode, the rectangle count moves long
   * before anyone notices the seconds.
   */
  it('keeps the largest fixture inside its rectangle budget', () => {
    const f = ROOF_FIXTURES.find((r) => r.name === 'large-industrial')!;
    const r = computeLayout(inputOf(f));
    expect(r.stats.candidateRectsTested).toBeLessThan(1_000_000);
  });
});

describe('rotation invariance', () => {
  /**
   * The most important property in the suite: a building does not become a
   * worse solar site by facing north-east. Any drop here means the angle search
   * has stopped working.
   */
  it('gets the same module count for a rectangle at any bearing', () => {
    const base = ROOF_FIXTURES.find((f) => f.name === 'rectangle-10x6')!;
    const counts: number[] = [];
    for (const deg of [0, 13, 37, 45, 71, 90, 128]) {
      const rad = (deg * Math.PI) / 180;
      const rotated = {
        ...base,
        roof: {
          outer: base.roof.outer.map((p) => ({
            x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
            y: p.x * Math.sin(rad) + p.y * Math.cos(rad),
          })),
          holes: [],
        },
      };
      counts.push(computeLayout(inputOf(rotated)).panelCount);
    }
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect(max - min, `counts varied with bearing: ${counts.join(', ')}`).toBeLessThanOrEqual(1);
    expect(min).toBe(27);
  });

  it('reports the same usable area at any bearing', () => {
    const base = ROOF_FIXTURES.find((f) => f.name === 'rectangle-10x6')!;
    const rotated = ROOF_FIXTURES.find((f) => f.name === 'rotated-rectangle')!;
    expect(computeLayout(inputOf(rotated)).usable.areaM2).toBeCloseTo(
      computeLayout(inputOf(base)).usable.areaM2,
      6,
    );
  });
});

describe('search axes each earn their keep', () => {
  const lshape = ROOF_FIXTURES.find((f) => f.name === 'l-shape')!;

  it('offset search beats a single grid origin', () => {
    const single = computeLayout(
      inputOf(lshape, { offsetStepsX: 1, offsetStepsY: 1, perRowOffsetSearch: false }),
    ).panelCount;
    const searched = computeLayout(inputOf(lshape)).panelCount;
    expect(searched).toBeGreaterThanOrEqual(single);
  });

  it('trying both orientations beats fixing one', () => {
    const rectFixture = ROOF_FIXTURES.find((f) => f.name === 'rectangle-10x6')!;
    const both = computeLayout(inputOf(rectFixture)).panelCount;
    const portraitOnly = computeLayout({
      ...inputOf(rectFixture),
      constraints: { ...constraintsOf(rectFixture), allowedOrientations: ['portrait'] },
    }).panelCount;
    const landscapeOnly = computeLayout({
      ...inputOf(rectFixture),
      constraints: { ...constraintsOf(rectFixture), allowedOrientations: ['landscape'] },
    }).panelCount;
    expect(both).toBeGreaterThanOrEqual(Math.max(portraitOnly, landscapeOnly));
  });

  it('roof-aligned angles beat axis-only angles on an irregular roof', () => {
    const irregular = ROOF_FIXTURES.find((f) => f.name === 'irregular-polygon')!;
    const axisOnly = computeLayout(inputOf(irregular, { angleCandidatesDeg: [0, 90] })).panelCount;
    const full = computeLayout(inputOf(irregular)).panelCount;
    expect(full).toBeGreaterThanOrEqual(axisOnly);
  });
});

describe('degenerate input', () => {
  const constraints: LayoutConstraints = {
    setbackM: 0.3,
    panelGapM: 0.02,
    exclusionClearanceM: 0.3,
    allowedOrientations: ['portrait', 'landscape'],
  };

  it('returns an empty layout with a warning when the setback eats the roof', () => {
    const f = ROOF_FIXTURES.find((r) => r.name === 'setback-consumes-roof')!;
    const r = computeLayout(inputOf(f));
    expect(r.panelCount).toBe(0);
    expect(r.orientation).toBeNull();
    expect(r.warnings.join(' ')).toContain('SETBACK_CONSUMES_ROOF');
  });

  it('warns rather than throwing when no module fits', () => {
    const f = ROOF_FIXTURES.find((r) => r.name === 'too-small')!;
    const r = computeLayout(inputOf(f));
    expect(r.panelCount).toBe(0);
    expect(r.warnings.join(' ')).toContain('NO_PANEL_FITS');
  });

  it('repairs and warns on a self-intersecting roof outline', () => {
    const bowtie = {
      outer: [
        { x: 0, y: 0 },
        { x: 12, y: 12 },
        { x: 12, y: 0 },
        { x: 0, y: 12 },
      ],
      holes: [],
    };
    const r = computeLayout({ roof: bowtie, exclusions: [], panel: TEST_PANEL, constraints });
    expect(r.warnings.join(' ')).toContain('ROOF_GEOMETRY_REPAIRED');
    expect(r.usable.roofAreaM2).toBeGreaterThan(0);
  });

  it('rejects a nonsensical module', () => {
    const roof = ROOF_FIXTURES[0]!.roof;
    expect(() =>
      computeLayout({
        roof,
        exclusions: [],
        panel: { ...TEST_PANEL, widthMm: 0 },
        constraints,
      }),
    ).toThrow(RangeError);
    expect(() =>
      computeLayout({
        roof,
        exclusions: [],
        panel: { ...TEST_PANEL, ratedPowerW: 0 },
        constraints,
      }),
    ).toThrow(RangeError);
  });

  it('rejects a negative setback', () => {
    expect(() =>
      computeUsableArea(ROOF_FIXTURES[0]!.roof, [], { ...constraints, setbackM: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      computeUsableArea(ROOF_FIXTURES[0]!.roof, [], { ...constraints, exclusionClearanceM: -1 }),
    ).toThrow(RangeError);
  });
});

describe('the forbidden shortcut', () => {
  /**
   * Guards rule 13 directly: `roofArea / panelArea` is banned. On a roof with
   * obstacles the naive number must be visibly optimistic compared to what
   * rectangles can actually achieve.
   */
  it('reports fewer modules than a naive area ratio would claim', () => {
    const f = ROOF_FIXTURES.find((r) => r.name === 'multiple-exclusions')!;
    const r = computeLayout(inputOf(f));
    const naive = Math.floor(
      r.usable.roofAreaM2 / ((f.panel.widthMm / 1000) * (f.panel.heightMm / 1000)),
    );
    expect(r.panelCount).toBeLessThan(naive);
  });
});
