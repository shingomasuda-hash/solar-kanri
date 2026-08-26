import type { MultiPolygon2D, OrientedRect, Polygon2D } from '../geo/types';

/** Version stamp for the layout algorithm. Persisted with every saved layout. */
export const LAYOUT_ENGINE_VERSION = 'layout-engine-v1';

/**
 * Physical module dimensions, straight off the datasheet.
 * `widthMm` is the short edge and `heightMm` the long edge by convention, but
 * the engine does not rely on that — it evaluates both orientations regardless.
 */
export interface PanelSpec {
  readonly id: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly ratedPowerW: number;
}

/**
 * Portrait  — the module's long edge runs UP the slope (the usual mounting).
 * Landscape — the module's long edge runs ACROSS the slope.
 */
export type PanelOrientation = 'portrait' | 'landscape';

export interface LayoutConstraints {
  /** Keep-out band inside the roof edge, metres. */
  readonly setbackM: number;
  /** Gap between neighbouring modules within a row, metres. */
  readonly panelGapM: number;
  /** Gap between rows, metres. Defaults to `panelGapM` when omitted. */
  readonly rowGapM?: number;
  /** Extra keep-out added around every exclusion zone, metres. */
  readonly exclusionClearanceM: number;
  readonly allowedOrientations: readonly PanelOrientation[];
}

export const DEFAULT_CONSTRAINTS: LayoutConstraints = {
  setbackM: 0.3,
  panelGapM: 0.02,
  exclusionClearanceM: 0.3,
  allowedOrientations: ['portrait', 'landscape'],
};

export interface SearchOptions {
  /**
   * Explicit array angles to evaluate, in degrees measured within the roof
   * plane. When omitted the engine uses 0 and 90 plus the roof's own dominant
   * edge directions.
   */
  readonly angleCandidatesDeg?: readonly number[];
  /** Add the roof polygon's dominant edge directions to the angle set. */
  readonly useRoofAlignedAngles: boolean;
  /** How many dominant edge directions to take. */
  readonly maxRoofAlignedAngles: number;
  /** Grid phase offsets tried along each axis. 1 = single origin (do not do this). */
  readonly offsetStepsX: number;
  readonly offsetStepsY: number;
  /**
   * Let each row slide independently along the array axis to pick up extra
   * modules on non-rectangular roofs. Rows stay aligned across the slope, so
   * the array still reads as tidy rows on site.
   */
  readonly perRowOffsetSearch: boolean;
  /** Phase offsets tried per row when `perRowOffsetSearch` is on. */
  readonly perRowOffsetSteps: number;
  /** Hard cap on candidate rectangles examined, so the search always terminates. */
  readonly maxCandidateRects: number;
}

export const DEFAULT_SEARCH: SearchOptions = {
  useRoofAlignedAngles: true,
  maxRoofAlignedAngles: 3,
  offsetStepsX: 5,
  offsetStepsY: 5,
  perRowOffsetSearch: true,
  perRowOffsetSteps: 5,
  maxCandidateRects: 4_000_000,
};

/** One placed module, in roof-plane metres (x = cross-slope, y = up-slope). */
export interface PanelPlacement {
  readonly id: string;
  readonly orientation: PanelOrientation;
  readonly rect: OrientedRect;
  readonly row: number;
  readonly col: number;
}

export interface LayoutInput {
  /** Roof outline in roof-plane metres. */
  readonly roof: Polygon2D;
  /** Obstacle outlines in roof-plane metres, before clearance is applied. */
  readonly exclusions: readonly Polygon2D[];
  readonly panel: PanelSpec;
  readonly constraints: LayoutConstraints;
  readonly search?: Partial<SearchOptions>;
}

export interface UsableArea {
  /** Roof minus setback, minus every cleared exclusion zone. */
  readonly region: MultiPolygon2D;
  readonly areaM2: number;
  /** Roof area before any deduction. */
  readonly roofAreaM2: number;
  /** Area lost to the edge setback. */
  readonly setbackLossM2: number;
  /** Area lost to exclusion zones and their clearances. */
  readonly exclusionLossM2: number;
  readonly warnings: readonly string[];
}

export interface LayoutCandidate {
  readonly orientation: PanelOrientation;
  readonly angleDeg: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly placements: readonly PanelPlacement[];
  readonly score: number;
}

export interface SearchStats {
  readonly anglesEvaluated: number;
  readonly candidateLayoutsEvaluated: number;
  readonly candidateRectsTested: number;
  readonly hitCandidateCap: boolean;
}

export interface LayoutResult {
  readonly algorithmVersion: string;
  readonly placements: readonly PanelPlacement[];
  readonly panelCount: number;
  readonly installedKw: number;
  readonly orientation: PanelOrientation | null;
  /** Array angle within the roof plane, degrees. */
  readonly angleDeg: number;
  readonly usable: UsableArea;
  /** Total module area / usable area. */
  readonly usableCoverageRatio: number;
  /** Total module area / gross roof area. */
  readonly roofCoverageRatio: number;
  readonly stats: SearchStats;
  readonly warnings: readonly string[];
}

/** Why a manually edited placement is not acceptable. */
export type PlacementViolation =
  | { readonly kind: 'outside-usable-area'; readonly panelId: string }
  | { readonly kind: 'overlaps-panel'; readonly panelId: string; readonly otherId: string }
  | { readonly kind: 'gap-too-small'; readonly panelId: string; readonly otherId: string };

export interface ValidationResult {
  readonly valid: boolean;
  readonly violations: readonly PlacementViolation[];
  /** IDs of every placement involved in at least one violation. */
  readonly invalidPanelIds: readonly string[];
}
