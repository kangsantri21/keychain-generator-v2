import paper from "paper";

// Tuned to match the server-side DILATE_MM/ERODE_MM (lib/keychain-geometry.ts)
// scaled to the live-preview canvas's px-per-mm ratio, so the preview's
// clipper-lib offsetting visually matches the final laser-cut output.
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

/**
 * Scales raw SVG path data by a uniform factor (around the origin) then
 * translates it — used to fit a designer-authored cut-line path (in its own
 * SVG's coordinate space) into our shared CHAR_BOX_MM square.
 */
export function scaleAndTranslatePathData(d: string, scale: number, tx: number, ty: number): string {
  if (!ensureScope()) return d;

  try {
    const item = paper.PathItem.create(d);
    if (!item) return d;
    item.scale(scale, new paper.Point(0, 0));
    item.translate(new paper.Point(tx, ty));
    return item.pathData;
  } catch {
    return d;
  } finally {
    paper.project?.activeLayer.removeChildren();
  }
}

/**
 * Scales raw SVG path data horizontally only (vertical axis untouched),
 * anchored at a fixed x so geometry does not shift at that x — used to
 * condense ("gepeng") a name's text when it would otherwise push the item
 * past MAX_ITEM_WIDTH_MM, without touching the text's own target cut height
 * (Template.textTargetHeight, a locked scale-Y, see keychain-render.ts).
 */
export function squeezeHorizontalPathData(d: string, scaleX: number, anchorX: number): string {
  if (!ensureScope()) return d;

  try {
    const item = paper.PathItem.create(d);
    if (!item) return d;
    item.scale(scaleX, 1, new paper.Point(anchorX, 0));
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

/** Bounding box that contains both `a` and `b`. */
export function unionBounds(a: PathBounds, b: PathBounds): PathBounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** SVG path `d` for a circle of radius `r` centered at (cx, cy), as two arcs. */
export function circlePathData(cx: number, cy: number, r: number): string {
  return `M ${cx - r},${cy} A ${r},${r} 0 1,0 ${cx + r},${cy} A ${r},${r} 0 1,0 ${cx - r},${cy} Z`;
}

/**
 * Candidate ring-hole centers within `bounds`, closest to the preferred
 * (nominal top-left) position first — used with `findHoleCenterInside` below
 * to find a spot that actually lands on solid material for a non-square/
 * non-convex silhouette, shared by both the "dynamic" (lib/keychain-
 * render.ts) and "fixed" (lib/keychain-render-fixed.ts) render engines.
 */
export function holeCandidates(
  preferred: { x: number; y: number },
  bounds: PathBounds,
  radius: number,
  step: number
): FlatPoint[] {
  const points: FlatPoint[] = [];
  for (let y = bounds.y + radius; y <= bounds.y + bounds.height - radius; y += step) {
    for (let x = bounds.x + radius; x <= bounds.x + bounds.width - radius; x += step) {
      points.push({ x, y });
    }
  }
  points.sort((a, b) => {
    const da = (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2;
    const db = (b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2;
    return da - db;
  });
  return points;
}

/**
 * Scans candidate centers (in preference order) for one where a circle of
 * the given radius lies entirely within the outline, and returns the first
 * hit. Used to verify the ring hole actually lands on solid material instead
 * of a fixed offset that may miss a non-square/non-convex silhouette. The
 * outline is parsed once and reused across all candidates for performance.
 */
export function findHoleCenterInside(
  outlineD: string,
  candidates: FlatPoint[],
  radius: number
): FlatPoint | null {
  if (!ensureScope()) return null;

  try {
    const outline = paper.PathItem.create(outlineD);
    if (!outline) return null;

    for (const { x, y } of candidates) {
      const circle = new paper.Path.Circle(new paper.Point(x, y), radius);
      const circleArea = Math.abs(circle.area);
      const intersection = outline.intersect(circle);
      const intersectionArea = Math.abs((intersection as paper.PathItem & { area: number }).area);
      circle.remove();
      intersection.remove();
      if (circleArea > 0 && intersectionArea >= circleArea * 0.995) {
        return { x, y };
      }
    }
    return null;
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

