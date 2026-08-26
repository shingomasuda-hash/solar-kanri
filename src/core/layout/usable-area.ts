import type { MultiPolygon2D, Polygon2D } from '../geo/types';
import { polygonArea } from '../geo/polygon';
import {
  bufferMulti,
  bufferPolygon,
  difference,
  isValidPolygon,
  makeValid,
  union,
} from '../geo/jsts-adapter';
import type { LayoutConstraints, UsableArea } from './types';

/**
 * STEP 1-3 of the placement algorithm: turn a raw roof outline plus obstacles
 * into the region modules may actually occupy.
 *
 *   usable = (roof eroded by setback) - (each exclusion dilated by clearance)
 *
 * All inputs are roof-plane metres. Erosion can legitimately return zero
 * polygons (roof too small) or several (a narrow waist pinches off) — both are
 * handled rather than treated as errors.
 */
export function computeUsableArea(
  roof: Polygon2D,
  exclusions: readonly Polygon2D[],
  constraints: LayoutConstraints,
): UsableArea {
  const warnings: string[] = [];

  if (constraints.setbackM < 0) {
    throw new RangeError(`setbackM must be >= 0, got ${constraints.setbackM}`);
  }
  if (constraints.exclusionClearanceM < 0) {
    throw new RangeError(
      `exclusionClearanceM must be >= 0, got ${constraints.exclusionClearanceM}`,
    );
  }

  let roofPolys: MultiPolygon2D = [roof];
  if (!isValidPolygon(roof)) {
    roofPolys = makeValid(roof);
    warnings.push(
      'ROOF_GEOMETRY_REPAIRED: the roof outline self-intersected and was ' +
        'automatically repaired. Confirm the drawn shape before quoting.',
    );
    if (roofPolys.length > 1) {
      warnings.push(
        `ROOF_SPLIT_INTO_${roofPolys.length}_PARTS: the repaired outline is not a single face.`,
      );
    }
  }

  const roofAreaM2 = roofPolys.reduce((s, p) => s + polygonArea(p), 0);
  if (roofAreaM2 <= 0) {
    return {
      region: [],
      areaM2: 0,
      roofAreaM2: 0,
      setbackLossM2: 0,
      exclusionLossM2: 0,
      warnings: [...warnings, 'ROOF_HAS_NO_AREA: the roof outline encloses no area.'],
    };
  }

  const setback =
    constraints.setbackM > 0 ? bufferMulti(roofPolys, -constraints.setbackM) : roofPolys;
  const setbackAreaM2 = setback.reduce((s, p) => s + polygonArea(p), 0);

  if (setback.length === 0) {
    warnings.push(
      `SETBACK_CONSUMES_ROOF: a ${constraints.setbackM} m setback leaves no usable area on ` +
        `a ${roofAreaM2.toFixed(1)} m² roof.`,
    );
    return {
      region: [],
      areaM2: 0,
      roofAreaM2,
      setbackLossM2: roofAreaM2,
      exclusionLossM2: 0,
      warnings,
    };
  }
  if (setback.length > roofPolys.length) {
    warnings.push(
      `SETBACK_SPLIT_ROOF: the setback pinched the roof into ${setback.length} separate faces.`,
    );
  }

  const cleared: MultiPolygon2D =
    constraints.exclusionClearanceM > 0
      ? exclusions.flatMap((z) => bufferPolygon(z, constraints.exclusionClearanceM, 'round'))
      : exclusions.map((z) => z);

  const region = cleared.length > 0 ? difference(setback, union(cleared)) : setback;
  const areaM2 = region.reduce((s, p) => s + polygonArea(p), 0);

  if (exclusions.length > 0 && areaM2 <= 0) {
    warnings.push('EXCLUSIONS_CONSUME_ROOF: exclusion zones leave no usable area.');
  }

  return {
    region,
    areaM2,
    roofAreaM2,
    setbackLossM2: roofAreaM2 - setbackAreaM2,
    exclusionLossM2: setbackAreaM2 - areaM2,
    warnings,
  };
}
