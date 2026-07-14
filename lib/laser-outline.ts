import paper from "paper";

const OFFSET_DIRECTIONS = 16;
export const DILATE_PX = 15;
export const ERODE_PX = 5.6;

let scopeReady = false;

/**
 * paper.js's geometry kernel (path booleans, bounds) needs no DOM/canvas, so
 * this works identically in the browser (live preview) and in Node (server-side
 * nesting) — just call `paper.setup()` once per process.
 */
function ensureScope(): boolean {
  if (scopeReady) return true;
  paper.setup(new paper.Size(10, 10));
  scopeReady = true;
  return true;
}

/**
 * paper.js has no native path-offset primitive, so dilation/erosion by a
 * disk of the given radius is approximated as the union (dilate) or
 * intersection (erode) of many copies of the shape shifted around a circle.
 * Using enough directions also naturally rounds corners, standing in for a
 * real offset library's `JoinType.Round`.
 */
function approximateOffset(item: paper.PathItem, distance: number): paper.PathItem {
  let result = item;

  for (let i = 0; i < OFFSET_DIRECTIONS; i++) {
    const angle = (360 / OFFSET_DIRECTIONS) * i;
    const vector = new paper.Point({ angle, length: Math.abs(distance) });
    const shifted = item.clone({ insert: false });
    shifted.translate(vector);

    result =
      distance >= 0
        ? result.unite(shifted, { insert: false })
        : result.intersect(shifted, { insert: false });
  }

  return result;
}

/** Drops sub-paths that are nested inside a larger sibling (letter counters like o/a/d/e). */
function dropNestedHoles(item: paper.PathItem): paper.PathItem {
  if (!(item instanceof paper.CompoundPath) || item.children.length <= 1) {
    return item;
  }

  const children = item.children as unknown as paper.Path[];
  const kept = children.filter(
    (child) =>
      !children.some(
        (other) =>
          other !== child &&
          Math.abs(other.area) > Math.abs(child.area) &&
          other.contains(child.position)
      )
  );

  if (kept.length === children.length) return item;

  return new paper.CompoundPath({
    children: kept.map((child) => child.clone({ insert: false })),
    insert: false,
  });
}

/** Translates raw SVG path data by (tx, ty), returning new path data. */
export function translatePathData(d: string, tx: number, ty: number): string {
  if (!ensureScope()) return d;

  try {
    // Some glyphs (e.g. a font's comma or a degenerate single-point curve)
    // produce path data paper.js can't turn into a real PathItem — fall back
    // to the untranslated data rather than crash on a null item.
    const item = paper.PathItem.create(d);
    if (!item) return d;
    item.translate(new paper.Point(tx, ty));
    return item.pathData;
  } catch {
    return d;
  } finally {
    paper.project?.activeLayer.removeChildren();
  }
}

export interface PathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounding box of the given SVG path data, in the same units as the path. */
export function getPathBounds(d: string): PathBounds | null {
  if (!ensureScope()) return null;

  try {
    const item = paper.PathItem.create(d);
    const { x, y, width, height } = item.bounds;
    return { x, y, width, height };
  } catch {
    return null;
  } finally {
    paper.project?.activeLayer.removeChildren();
  }
}

export interface FlatPoint {
  x: number;
  y: number;
}

/**
 * Flattens SVG path data (including bezier curves, as in font glyph outlines)
 * into one or more closed polygons — the point-array input a polygon-clipping
 * library like clipper-lib needs, since it has no notion of curves.
 */
export function flattenPathToPolygons(d: string, tolerance = 0.05): FlatPoint[][] {
  if (!ensureScope()) return [];

  try {
    const item = paper.PathItem.create(d);
    if (!item) return [];

    const flattened = item.clone({ insert: false });
    flattened.flatten(tolerance);

    const subPaths =
      flattened instanceof paper.CompoundPath
        ? (flattened.children as unknown as paper.Path[])
        : [flattened as paper.Path];

    return subPaths
      .map((path) => path.segments.map((segment) => ({ x: segment.point.x, y: segment.point.y })))
      .filter((points) => points.length >= 3);
  } catch {
    return [];
  } finally {
    paper.project?.activeLayer.removeChildren();
  }
}

/**
 * Merges the given shapes (already positioned in one shared coordinate
 * space — e.g. the character bounding box plus each glyph outline) into a
 * single silhouette, then applies a dilate(+DILATE_PX) -> erode(-ERODE_PX)
 * closing pass. Returns the resulting outer contour as SVG path data, with
 * inner holes stripped, or null if it can't be computed.
 */
export function computeLaserOutline(shapes: string[]): string | null {
  if (!ensureScope() || shapes.length === 0) return null;

  try {
    let union: paper.PathItem | null = null;

    for (const d of shapes) {
      const item = paper.PathItem.create(d);
      if (!item) continue;
      union = union ? union.unite(item, { insert: false }) : item;
    }

    if (!union) return null;

    const dilated = approximateOffset(union, DILATE_PX);
    const eroded = approximateOffset(dilated, -ERODE_PX);
    const cleaned = dropNestedHoles(eroded);

    return cleaned.pathData || null;
  } catch {
    return null;
  } finally {
    paper.project?.activeLayer.removeChildren();
  }
}
