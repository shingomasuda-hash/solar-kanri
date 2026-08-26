import type { MultiPolygon2D, OrientedRect, Point2D, Polygon2D } from '../geo/types';
import { DEG, RAD } from '../geo/types';
import {
  bbox,
  bboxOfPolygons,
  centroid,
  dominantEdgeAngles,
  normalizeHalfTurn,
  rectCorners,
  rotateRing,
} from '../geo/polygon';
import { Region } from '../geo/region';
import { computeUsableArea } from './usable-area';
import {
  DEFAULT_SEARCH,
  LAYOUT_ENGINE_VERSION,
  type LayoutCandidate,
  type LayoutInput,
  type LayoutResult,
  type PanelOrientation,
  type PanelPlacement,
  type PanelSpec,
  type SearchOptions,
  type SearchStats,
  type UsableArea,
} from './types';

/**
 * Deterministic panel-placement search.
 *
 * The forbidden shortcut is `roofArea / panelArea`: it ignores setbacks, gaps,
 * obstacles and the fact that rectangles do not tile an arbitrary polygon. This
 * engine instead places real rectangles and geometrically proves every one fits.
 *
 * The search is an exhaustive grid search over three axes, in this order:
 *
 *   orientation × array angle × grid phase offset
 *
 * and, within each of those, an optional per-row slide. Every axis matters:
 *  - a single origin (top-left only) loses up to a whole row and column;
 *  - a single angle loses badly on any roof that is not axis-aligned;
 *  - a single orientation is typically 5-15% off the better of the two.
 *
 * Determinism is a hard requirement (see ADR-004): identical input always
 * yields byte-identical output, so a saved quotation can be reproduced years
 * later. There is therefore no randomness and no wall-clock budget — the
 * search is bounded by a candidate-rectangle cap instead.
 */
export function computeLayout(input: LayoutInput): LayoutResult {
  const search: SearchOptions = { ...DEFAULT_SEARCH, ...input.search };
  const usable = computeUsableArea(input.roof, input.exclusions, input.constraints);
  const warnings = [...usable.warnings];

  validatePanel(input.panel);

  if (usable.region.length === 0 || usable.areaM2 <= 0) {
    return emptyResult(usable, warnings, {
      anglesEvaluated: 0,
      candidateLayoutsEvaluated: 0,
      candidateRectsTested: 0,
      hitCandidateCap: false,
    });
  }

  const orientations = dedupeOrientations(input.constraints.allowedOrientations, input.panel);
  if (orientations.length === 0) {
    return emptyResult(usable, [...warnings, 'NO_ORIENTATION_ALLOWED: no orientation permitted.'], {
      anglesEvaluated: 0,
      candidateLayoutsEvaluated: 0,
      candidateRectsTested: 0,
      hitCandidateCap: false,
    });
  }

  const angles = resolveAngles(input.roof, search);
  const pivot = centroid(input.roof.outer);

  let best: LayoutCandidate | null = null;
  let candidateRectsTested = 0;
  let candidateLayoutsEvaluated = 0;
  let hitCandidateCap = false;

  for (const angleDeg of angles) {
    const angleRad = angleDeg * DEG;
    // Rotate the region into the array's frame so packing is axis-aligned.
    const rotated = rotateRegion(usable.region, -angleRad, pivot);
    const region = new Region(rotated);
    if (region.isEmpty) continue;
    const box = bboxOfPolygons(rotated);

    for (const orientation of orientations) {
      const { w, h } = moduleSize(input.panel, orientation);
      const cellW = w + input.constraints.panelGapM;
      const cellH = h + (input.constraints.rowGapM ?? input.constraints.panelGapM);

      if (w > box.maxX - box.minX + 1e-9 && h > box.maxY - box.minY + 1e-9) continue;

      for (let ix = 0; ix < search.offsetStepsX; ix++) {
        for (let iy = 0; iy < search.offsetStepsY; iy++) {
          if (hitCandidateCap) break;
          const offsetX = (ix / search.offsetStepsX) * cellW;
          const offsetY = (iy / search.offsetStepsY) * cellH;

          const placed = packAxisAligned(
            region,
            box,
            w,
            h,
            cellW,
            cellH,
            offsetX,
            offsetY,
            orientation,
            search,
            (n) => {
              candidateRectsTested += n;
              if (candidateRectsTested > search.maxCandidateRects) {
                hitCandidateCap = true;
                return false;
              }
              return true;
            },
          );
          candidateLayoutsEvaluated++;

          if (placed.length === 0) continue;
          const score = scoreLayout(placed, region);
          if (best === null || score > best.score) {
            // Rotate the accepted placements back into roof-plane coordinates.
            best = {
              orientation,
              angleDeg,
              offsetX,
              offsetY,
              placements: placed.map((p) => ({
                ...p,
                rect: rotateRect(p.rect, angleRad, pivot),
              })),
              score,
            };
          }
        }
        if (hitCandidateCap) break;
      }
      if (hitCandidateCap) break;
    }
    if (hitCandidateCap) break;
  }

  if (hitCandidateCap) {
    warnings.push(
      'SEARCH_TRUNCATED: the candidate cap was reached, so the search was not exhaustive. ' +
        'The layout is valid but may not be optimal.',
    );
  }

  const stats: SearchStats = {
    anglesEvaluated: angles.length,
    candidateLayoutsEvaluated,
    candidateRectsTested,
    hitCandidateCap,
  };

  if (!best) {
    return emptyResult(
      usable,
      [
        ...warnings,
        `NO_PANEL_FITS: no ${input.panel.widthMm}x${input.panel.heightMm} mm module fits in ` +
          `${usable.areaM2.toFixed(1)} m² of usable area under the current setback and gaps.`,
      ],
      stats,
    );
  }

  const moduleAreaM2 =
    (input.panel.widthMm / 1000) * (input.panel.heightMm / 1000) * best.placements.length;

  return {
    algorithmVersion: LAYOUT_ENGINE_VERSION,
    placements: best.placements,
    panelCount: best.placements.length,
    installedKw: (best.placements.length * input.panel.ratedPowerW) / 1000,
    orientation: best.orientation,
    angleDeg: best.angleDeg,
    usable,
    usableCoverageRatio: usable.areaM2 > 0 ? moduleAreaM2 / usable.areaM2 : 0,
    roofCoverageRatio: usable.roofAreaM2 > 0 ? moduleAreaM2 / usable.roofAreaM2 : 0,
    stats,
    warnings,
  };
}

/* ------------------------------------------------------------------ */

function validatePanel(panel: PanelSpec): void {
  if (!(panel.widthMm > 0) || !(panel.heightMm > 0)) {
    throw new RangeError(
      `Panel dimensions must be positive, got ${panel.widthMm}x${panel.heightMm} mm`,
    );
  }
  if (!(panel.ratedPowerW > 0)) {
    throw new RangeError(`Panel rated power must be positive, got ${panel.ratedPowerW} W`);
  }
}

function moduleSize(panel: PanelSpec, orientation: PanelOrientation): { w: number; h: number } {
  const short = Math.min(panel.widthMm, panel.heightMm) / 1000;
  const long = Math.max(panel.widthMm, panel.heightMm) / 1000;
  // Portrait: long edge up-slope (the array's y axis).
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short };
}

/** A square module makes the two orientations identical — do not search twice. */
function dedupeOrientations(
  allowed: readonly PanelOrientation[],
  panel: PanelSpec,
): PanelOrientation[] {
  const unique = [...new Set(allowed)];
  if (Math.abs(panel.widthMm - panel.heightMm) < 1e-6 && unique.length > 1) {
    return [unique[0]!];
  }
  return unique;
}

/**
 * The array angles to try. Always includes 0° and 90° (spec requirement), plus
 * the roof's own dominant edge directions, which is what an installer would
 * actually align to on a non-rectangular roof.
 */
export function resolveAngles(roof: Polygon2D, search: SearchOptions): number[] {
  if (search.angleCandidatesDeg && search.angleCandidatesDeg.length > 0) {
    return dedupeAngles(search.angleCandidatesDeg.map((a) => normalizeHalfTurn(a * DEG) * RAD));
  }
  const angles = [0, 90];
  if (search.useRoofAlignedAngles) {
    for (const rad of dominantEdgeAngles(roof.outer).slice(0, search.maxRoofAlignedAngles)) {
      const deg = rad * RAD;
      angles.push(deg, deg + 90);
    }
  }
  return dedupeAngles(angles.map((a) => normalizeHalfTurn(a * DEG) * RAD));
}

function dedupeAngles(degrees: readonly number[], toleranceDeg = 0.05): number[] {
  const out: number[] = [];
  for (const d of degrees) {
    const norm = normalizeHalfTurn(d * DEG) * RAD;
    if (!out.some((e) => Math.abs(e - norm) < toleranceDeg)) out.push(norm);
  }
  // Sort so the search order — and therefore tie-breaking — is deterministic.
  return out.sort((a, b) => a - b);
}

function rotateRegion(region: MultiPolygon2D, angleRad: number, about: Point2D): MultiPolygon2D {
  if (angleRad === 0) return region;
  return region.map((p) => ({
    outer: rotateRing(p.outer, angleRad, about),
    holes: p.holes.map((h) => rotateRing(h, angleRad, about)),
  }));
}

function rotateRect(rect: OrientedRect, angleRad: number, about: Point2D): OrientedRect {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dx = rect.cx - about.x;
  const dy = rect.cy - about.y;
  return {
    cx: about.x + dx * c - dy * s,
    cy: about.y + dx * s + dy * c,
    width: rect.width,
    height: rect.height,
    rotation: rect.rotation + angleRad,
  };
}

/**
 * Pack axis-aligned modules into a region, row by row.
 *
 * Rows sit on a fixed pitch so the array reads as tidy rows on site. Within a
 * row, `perRowOffsetSearch` lets the row slide along x independently, which is
 * what picks up the extra module on a trapezoid or an L-shape where a rigid
 * lattice would waste the row's ragged end.
 *
 * @param budget called with the number of rectangles about to be tested;
 *               return false to abort the search.
 */
function packAxisAligned(
  region: Region,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  w: number,
  h: number,
  cellW: number,
  cellH: number,
  offsetX: number,
  offsetY: number,
  orientation: PanelOrientation,
  search: SearchOptions,
  budget: (tested: number) => boolean,
): PanelPlacement[] {
  const placements: PanelPlacement[] = [];
  const startY = box.minY - offsetY;
  const rows = Math.ceil((box.maxY - startY) / cellH) + 1;
  const cols = Math.ceil((box.maxX - (box.minX - offsetX)) / cellW) + 1;
  if (rows <= 0 || cols <= 0) return placements;

  const rowShifts = search.perRowOffsetSearch
    ? Array.from(
        { length: search.perRowOffsetSteps },
        (_, i) => (i / search.perRowOffsetSteps) * cellW,
      )
    : [0];

  let row = 0;
  for (let r = 0; r < rows; r++) {
    const y = startY + r * cellH;
    if (y + h > box.maxY + 1e-9) break;

    let bestRow: PanelPlacement[] = [];
    for (const shift of rowShifts) {
      const startX = box.minX - offsetX + shift - cellW;
      const rowCols = cols + 2;
      if (!budget(rowCols)) return placements;

      const candidate: PanelPlacement[] = [];
      for (let c = 0; c < rowCols; c++) {
        const x = startX + c * cellW;
        if (x + w > box.maxX + 1e-9) break;
        if (x < box.minX - cellW) continue;
        const rect: OrientedRect = {
          cx: x + w / 2,
          cy: y + h / 2,
          width: w,
          height: h,
          rotation: 0,
        };
        if (region.containsRect(rectCorners(rect))) {
          candidate.push({
            id: `p-${row}-${candidate.length}`,
            orientation,
            rect,
            row,
            col: candidate.length,
          });
        }
      }
      if (candidate.length > bestRow.length) bestRow = candidate;
      // A full row cannot be improved on; stop sliding.
      if (bestRow.length >= cols) break;
    }

    if (bestRow.length > 0) {
      placements.push(...bestRow);
      row++;
    }
  }
  return placements;
}

/**
 * Rank a candidate layout.
 *
 * Module count dominates — for a single module type it is exactly proportional
 * to installed kW and hence to yield. Ties are broken by compactness (mean
 * squared distance from the region centroid, negated), which prefers a single
 * contiguous block over the same count scattered across the roof: easier to
 * wire, fewer strings, and visually what a customer expects.
 */
export function scoreLayout(placements: readonly PanelPlacement[], region: Region): number {
  if (placements.length === 0) return 0;
  const box = bboxOfPolygons(region.polygons);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1);
  let spread = 0;
  for (const p of placements) {
    const dx = (p.rect.cx - cx) / span;
    const dy = (p.rect.cy - cy) / span;
    spread += dx * dx + dy * dy;
  }
  const meanSpread = spread / placements.length;
  // Count is weighted far above the tie-break, so compactness can never trade
  // away a module.
  return placements.length * 1000 - meanSpread;
}

function emptyResult(
  usable: UsableArea,
  warnings: readonly string[],
  stats: SearchStats,
): LayoutResult {
  return {
    algorithmVersion: LAYOUT_ENGINE_VERSION,
    placements: [],
    panelCount: 0,
    installedKw: 0,
    orientation: null,
    angleDeg: 0,
    usable,
    usableCoverageRatio: 0,
    roofCoverageRatio: 0,
    stats,
    warnings,
  };
}

/** Bounding box of a set of placements, useful for tests and UI framing. */
export function placementsBBox(placements: readonly PanelPlacement[]) {
  return bbox(placements.flatMap((p) => rectCorners(p.rect)));
}
