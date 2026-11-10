import ClipperLib from "clipper-lib";
import { flattenPathToPolygons, type FlatPoint } from "@/lib/laser-outline";
import { CURVE_TOLERANCE_MM, GAP_CLOSE_MM, OUTLINE_OFFSET_MM } from "@/lib/keychain-geometry";

/** Clipper works in integers; this preserves ~3 decimal places of a path unit (mm in production). */
const SCALE = 1000;

function toClipperPath(points: FlatPoint[]): ClipperLib.IntPoint[] {
  return points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}

function shapesToClipperPaths(shapes: string[], curveTolerance: number): ClipperLib.Path[] {
  const paths: ClipperLib.Path[] = [];
  for (const d of shapes) {
    for (const polygon of flattenPathToPolygons(d, curveTolerance)) {
      paths.push(toClipperPath(polygon));
    }
  }
  return paths;
}

function unionClipperPaths(subjectPaths: ClipperLib.Path[]): ClipperLib.Paths {
  if (subjectPaths.length === 0) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subjectPaths, ClipperLib.PolyType.ptSubject, true);
  const unionPaths: ClipperLib.Paths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    unionPaths,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return unionPaths;
}

/**
 * Drops inner holes (letter counters like the middle of "o"/"a"), keeping
 * only the path(s) sharing the orientation of whichever has the largest
 * absolute area — rather than assuming a fixed winding-direction convention.
 */
function keepOuterOrientation(paths: ClipperLib.Paths): ClipperLib.Paths {
  if (paths.length === 0) return paths;
  const withArea = paths.map((path) => ({ path, area: ClipperLib.Clipper.Area(path) }));
  let outerIsPositive = true;
  let maxAbsArea = -Infinity;
  for (const { area } of withArea) {
    if (Math.abs(area) > maxAbsArea) {
      maxAbsArea = Math.abs(area);
      outerIsPositive = area > 0;
    }
  }
  const outerPaths = withArea.filter(({ area }) => (area > 0) === outerIsPositive).map(({ path }) => path);
  return outerPaths.length > 0 ? outerPaths : paths;
}

function clipperPathsToSvgD(paths: ClipperLib.Paths): string | null {
  let d = "";
  for (const path of paths) {
    if (path.length < 3) continue;
    path.forEach((point, index) => {
      const x = (point.X / SCALE).toFixed(3);
      const y = (point.Y / SCALE).toFixed(3);
      d += index === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    d += " Z ";
  }
  return d.trim() || null;
}

/**
 * Fills notches narrower than `gapWidth` on each path separately.
 * Doing it per path (not on the whole set at once) keeps two pieces that
 * are already apart — a word space — from growing back together.
 * Round joins, so the filled notch becomes an arc, not a flat chord.
 */
function closeEachPath(paths: ClipperLib.Paths, gapWidth: number, arcTolerance: number): ClipperLib.Paths {
  if (gapWidth <= 1e-9) return paths;
  const radius = gapWidth / 2;
  const closed: ClipperLib.Paths = [];
  for (const path of paths) {
    const grown = offsetPaths([path], radius, arcTolerance);
    const shrunk = offsetPaths(grown, -radius, arcTolerance);
    if (shrunk.length > 0) closed.push(...shrunk);
    else closed.push(path);
  }
  return keepOuterOrientation(closed);
}

/**
 * Offsets closed paths by `delta` path-units (positive = outward).
 * `arcTolerance` is the maximum distance between a true round join and the
 * straight segments that replace it, in the same units as the path — not
 * Clipper's raw integer units. Round joins stay smooth without storing a
 * point every fraction of a micron.
 */
function offsetPaths(paths: ClipperLib.Paths, delta: number, arcTolerance: number): ClipperLib.Paths {
  if (paths.length === 0 || Math.abs(delta) < 1e-9) return paths;
  const clipperArc = Math.max(arcTolerance, 1e-6) * SCALE;
  const offset = new ClipperLib.ClipperOffset(2, clipperArc);
  offset.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const result: ClipperLib.Paths = [];
  offset.Execute(result, delta * SCALE);
  return result;
}

export interface ClipperOutlineOptions {
  dilateMm: number;
  erodeMm: number;
  /**
   * Max distance between a curve and its straight-segment stand-in.
   * Same units as the path. Defaults to the production curve tolerance.
   */
  curveTolerance?: number;
  /** Round-join tolerance. Defaults to `curveTolerance`. */
  arcTolerance?: number;
}

/**
 * Dilate then erode, in path units. Production cut lines do not call this
 * directly — they use `computeProductionOutline`, which closes small gaps
 * first and only then applies the small final offset. This lower-level pass
 * remains so a measurement can still reproduce the old fat contour
 * (dilate 4 mm, erode 1.5 mm) and so a pure closing (dilate = erode) stays
 * available.
 */
export function computeLaserOutlineClipper(
  shapes: string[],
  { dilateMm, erodeMm, curveTolerance = CURVE_TOLERANCE_MM, arcTolerance }: ClipperOutlineOptions
): string | null {
  const tolerance = curveTolerance;
  const arc = arcTolerance ?? tolerance;
  const subjectPaths = shapesToClipperPaths(shapes, tolerance);
  if (subjectPaths.length === 0) return null;

  try {
    const unionPaths = unionClipperPaths(subjectPaths);
    if (unionPaths.length === 0) return null;

    const dilatedPaths = offsetPaths(keepOuterOrientation(unionPaths), dilateMm, arc);
    if (dilatedPaths.length === 0) return null;

    const erodedPaths = offsetPaths(dilatedPaths, -erodeMm, arc);
    if (erodedPaths.length === 0) return null;

    return clipperPathsToSvgD(keepOuterOrientation(erodedPaths));
  } catch {
    return null;
  }
}

export interface ProductionOutlineOptions {
  /**
   * How many path-units correspond to one millimetre. Production geometry is
   * already in mm, so this stays 1. The live preview passes its px-per-mm
   * scale so the same millimetre defaults land on the right pixel size.
   */
  unitPerMm?: number;
  /**
   * Gaps narrower than this are closed. Same units as the path. Omit to use
   * `GAP_CLOSE_MM * unitPerMm`.
   */
  gapClose?: number;
  /**
   * Final outward offset after the gap is closed. Same units as the path.
   * Omit to use `OUTLINE_OFFSET_MM * unitPerMm`.
   */
  offset?: number;
  /** Curve and round-join tolerance. Omit to use `CURVE_TOLERANCE_MM * unitPerMm`. */
  curveTolerance?: number;
}

/**
 * Laser silhouette used by dynamic keychains. This is the CorelDRAW
 * "Contour, outward, 1 step" operation:
 *
 * 1. Union the design and drop interior holes, so the middle of "O" stays
 *    solid acrylic and the laser sees one outer silhouette.
 * 2. Offset outward by `offset` (default 2.5 mm) with round joins. The join
 *    is a circular arc of that radius. Gaps narrower than twice the offset
 *    close on their own. A straight edge moves by exactly this distance.
 * 3. Close each resulting piece by `gapClose` (default 4 mm). That fills
 *    the sharp cusps left between letters without moving the outer edge
 *    and without joining a separate word. Curves stay within
 *    `curveTolerance` (0.01 mm).
 *
 * The old dilate(4 mm)/erode(1.5 mm) pass is not this. It closed gaps up to
 * 8 mm and then ate the bays back into flat bridges. `computeLaserOutlineClipper`
 * still reproduces that pass for the before/after measurement.
 */
export function computeProductionOutline(shapes: string[], options: ProductionOutlineOptions = {}): string | null {
  const unit = options.unitPerMm ?? 1;
  const gapClose = options.gapClose ?? GAP_CLOSE_MM * unit;
  const offset = options.offset ?? OUTLINE_OFFSET_MM * unit;
  const curveTolerance = options.curveTolerance ?? CURVE_TOLERANCE_MM * unit;
  const subjectPaths = shapesToClipperPaths(shapes, curveTolerance);
  if (subjectPaths.length === 0) return null;

  try {
    let paths = keepOuterOrientation(unionClipperPaths(subjectPaths));
    if (paths.length === 0) return null;

    if (offset > 1e-9) {
      const grown = offsetPaths(paths, offset, curveTolerance);
      if (grown.length === 0) return null;
      paths = keepOuterOrientation(grown);
    }

    // After the offset, so the outer edge stays put. Per piece, so a word
    // space that is already its own contour is not pulled shut.
    paths = closeEachPath(paths, gapClose, curveTolerance);

    return clipperPathsToSvgD(paths);
  } catch {
    return null;
  }
}

/**
 * Plain boolean union of the given shapes — no dilate/erode. Used to combine
 * a designer-authored cut-line (already the final intended contour) with our
 * own computed text outline into one seamless shape without distorting the
 * designer's original geometry. Keeps only the outermost perimeter(s): a
 * laser cutter must never see an accidental interior loop (a stray "hole"
 * artifact from an off-center weld seam, or a genuine hole in the designer's
 * own artwork), since stroking it would cut straight through solid material.
 */
export function unionOutlines(shapes: string[], curveTolerance = CURVE_TOLERANCE_MM): string | null {
  const subjectPaths = shapesToClipperPaths(shapes, curveTolerance);
  if (subjectPaths.length === 0) return null;

  try {
    const unionPaths = unionClipperPaths(subjectPaths);
    if (unionPaths.length === 0) return null;
    return clipperPathsToSvgD(keepOuterOrientation(unionPaths));
  } catch {
    return null;
  }
}
