import type { OrientedRect } from '../geo/types';
import { rectCorners } from '../geo/polygon';
import { Region, orientedRectsOverlap } from '../geo/region';
import type {
  LayoutConstraints,
  PanelPlacement,
  PlacementViolation,
  UsableArea,
  ValidationResult,
} from './types';

/**
 * Validate a hand-edited layout.
 *
 * Runs on every drag so the operator sees an illegal module light up
 * immediately, and again server-side before a simulation may be confirmed —
 * the client check is a convenience, not the authority.
 */
export function validatePlacements(
  placements: readonly PanelPlacement[],
  usable: UsableArea,
  constraints: LayoutConstraints,
): ValidationResult {
  const region = new Region(usable.region);
  const violations: PlacementViolation[] = [];

  for (const p of placements) {
    if (!region.containsRect(rectCorners(p.rect))) {
      violations.push({ kind: 'outside-usable-area', panelId: p.id });
    }
  }

  const gap = Math.max(0, constraints.panelGapM);
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!;
      const b = placements[j]!;
      if (orientedRectsOverlap(a.rect, b.rect)) {
        violations.push({ kind: 'overlaps-panel', panelId: a.id, otherId: b.id });
      } else if (gap > 0 && orientedRectsOverlap(grow(a.rect, gap), grow(b.rect, gap))) {
        // Both grown by half the gap each would double-count, so grow one only.
        violations.push({ kind: 'gap-too-small', panelId: a.id, otherId: b.id });
      }
    }
  }

  const invalidPanelIds = [
    ...new Set(violations.flatMap((v) => ('otherId' in v ? [v.panelId, v.otherId] : [v.panelId]))),
  ];

  return { valid: violations.length === 0, violations, invalidPanelIds };
}

function grow(rect: OrientedRect, by: number): OrientedRect {
  return { ...rect, width: rect.width + by, height: rect.height + by };
}

/** Move a placement by a delta in roof-plane metres. */
export function movePlacement(p: PanelPlacement, dx: number, dy: number): PanelPlacement {
  return { ...p, rect: { ...p.rect, cx: p.rect.cx + dx, cy: p.rect.cy + dy } };
}

/** Rotate a placement 90 degrees about its own centre, swapping orientation. */
export function rotatePlacement(p: PanelPlacement): PanelPlacement {
  return {
    ...p,
    orientation: p.orientation === 'portrait' ? 'landscape' : 'portrait',
    rect: {
      ...p.rect,
      width: p.rect.height,
      height: p.rect.width,
    },
  };
}

/**
 * Add a module at a point, matching the existing array's size and angle.
 * Returns null when nothing sensible can be inferred (an empty layout).
 */
export function addPlacementAt(
  placements: readonly PanelPlacement[],
  at: { x: number; y: number },
  idSeed: number,
): PanelPlacement | null {
  const template = placements[0];
  if (!template) return null;
  return {
    id: `manual-${idSeed}`,
    orientation: template.orientation,
    row: -1,
    col: -1,
    rect: { ...template.rect, cx: at.x, cy: at.y },
  };
}

export function removePlacement(
  placements: readonly PanelPlacement[],
  id: string,
): PanelPlacement[] {
  return placements.filter((p) => p.id !== id);
}
