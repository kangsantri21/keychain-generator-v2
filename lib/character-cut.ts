/**
 * The laser line around a character is always the current production contour
 * (2.5 mm round offset). A cut line drawn inside the uploaded SVG is the old
 * outline and is not used.
 */
import { computeProductionOutline } from "@/lib/clipper-outline";
import { GAP_CLOSE_MM, OUTLINE_GROWTH_MM, OUTLINE_OFFSET_MM } from "@/lib/keychain-geometry";
import { getPathBounds, scaleAndTranslatePathData, type PathBounds } from "@/lib/laser-outline";

export function artworkShapePaths(vector: { allShapePaths: string[]; cutLinePaths: string[] }): string[] {
  if (vector.cutLinePaths.length === 0) return vector.allShapePaths;
  const cuts = new Set(vector.cutLinePaths);
  const art = vector.allShapePaths.filter((path) => !cuts.has(path));
  return art.length > 0 ? art : vector.allShapePaths;
}

function unionBounds(boxes: PathBounds[]): PathBounds {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Scale the artwork so its finished cut height is `targetOuterMm`
 * (the contour adds `OUTLINE_GROWTH_MM`). Returns the outline already
 * placed with its top-left at `marginMm`.
 */
export function productionOutlineAtHeight(
  paths: string[],
  targetOuterMm: number,
  marginMm: number
): { outline: string | null; bounds: PathBounds | null } {
  const boxes = paths.map((path) => getPathBounds(path)).filter((box): box is PathBounds => box !== null);
  if (boxes.length === 0) return { outline: null, bounds: null };
  const src = unionBounds(boxes);
  if (src.height <= 1e-6) return { outline: null, bounds: null };
  const raw = Math.max(targetOuterMm - OUTLINE_GROWTH_MM, 1);
  const scale = raw / src.height;
  const tx = marginMm - src.x * scale;
  const ty = marginMm - src.y * scale;
  const scaled = paths.map((path) => scaleAndTranslatePathData(path, scale, tx, ty));
  const outline = computeProductionOutline(scaled, { gapClose: GAP_CLOSE_MM, offset: OUTLINE_OFFSET_MM });
  return { outline, bounds: outline ? getPathBounds(outline) : null };
}

export const PRODUCTION_OUTLINE_OFFSET_MM = OUTLINE_OFFSET_MM;
