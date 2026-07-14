import ClipperLib from "clipper-lib";
import { flattenPathToPolygons, type FlatPoint } from "@/lib/laser-outline";

/** Clipper works in integers; this preserves ~3 decimal places of mm precision. */
const SCALE = 1000;
/** Curve-flattening tolerance, in mm — dense enough to look smooth at keychain scale. */
const FLATTEN_TOLERANCE_MM = 0.05;

function toClipperPath(points: FlatPoint[]): ClipperLib.IntPoint[] {
  return points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}

export interface ClipperOutlineOptions {
  dilateMm: number;
  erodeMm: number;
}

/**
 * Computes the outer laser-cutting silhouette for the given SVG path shapes
 * using clipper-lib's real polygon offsetting (a dilate -> erode "closing"
 * pass with round joins), instead of paper.js's shifted-copy-union
 * approximation. Curves (glyph outlines) are flattened to dense polygons
 * first, since Clipper only understands straight-edged paths.
 */
export function computeLaserOutlineClipper(
  shapes: string[],
  { dilateMm, erodeMm }: ClipperOutlineOptions
): string | null {
  const subjectPaths: ClipperLib.Path[] = [];

  for (const d of shapes) {
    for (const polygon of flattenPathToPolygons(d, FLATTEN_TOLERANCE_MM)) {
      subjectPaths.push(toClipperPath(polygon));
    }
  }

  if (subjectPaths.length === 0) return null;

  try {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true);
    const unionPaths: ClipperLib.Paths = [];
    clipper.Execute(
      ClipperLib.ClipType.ctUnion,
      unionPaths,
      ClipperLib.PolyFillType.pftNonZero,
      ClipperLib.PolyFillType.pftNonZero
    );
    if (unionPaths.length === 0) return null;

    const dilateOffset = new ClipperLib.ClipperOffset();
    dilateOffset.AddPaths(unionPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const dilatedPaths: ClipperLib.Paths = [];
    dilateOffset.Execute(dilatedPaths, dilateMm * SCALE);
    if (dilatedPaths.length === 0) return null;

    const erodeOffset = new ClipperLib.ClipperOffset();
    erodeOffset.AddPaths(dilatedPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const erodedPaths: ClipperLib.Paths = [];
    erodeOffset.Execute(erodedPaths, -erodeMm * SCALE);
    if (erodedPaths.length === 0) return null;

    // Keep only the outer boundary/boundaries, dropping inner holes (letter
    // counters like the middle of "o"/"a"). Rather than assume a fixed
    // winding-direction convention, find the orientation of whichever path
    // has the largest absolute area and keep only paths sharing it.
    const withArea = erodedPaths.map((path) => ({ path, area: ClipperLib.Clipper.Area(path) }));
    let outerIsPositive = true;
    let maxAbsArea = -Infinity;
    for (const { area } of withArea) {
      if (Math.abs(area) > maxAbsArea) {
        maxAbsArea = Math.abs(area);
        outerIsPositive = area > 0;
      }
    }
    const outerPaths = withArea
      .filter(({ area }) => (area > 0) === outerIsPositive)
      .map(({ path }) => path);
    const finalPaths = outerPaths.length > 0 ? outerPaths : erodedPaths;

    let d = "";
    for (const path of finalPaths) {
      if (path.length < 3) continue;
      path.forEach((point, index) => {
        const x = (point.X / SCALE).toFixed(3);
        const y = (point.Y / SCALE).toFixed(3);
        d += index === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
      });
      d += " Z ";
    }

    return d.trim() || null;
  } catch {
    return null;
  }
}
