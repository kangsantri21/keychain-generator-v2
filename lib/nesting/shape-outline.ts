/**
 * Cut-line polygons for shape-block nesting.
 *
 * Coordinates are millimetres, origin at the top-left of the unrotated
 * artwork, Y down — the same space as the SVG outline path. Collision is
 * a Clipper offset of one outline by the clearance, then an intersection
 * with the other. Touching at exactly the clearance has no area, so it is
 * allowed.
 */
import ClipperLib from "clipper-lib";
import { flattenPathToPolygons } from "@/lib/laser-outline";

export interface Pt {
  x: number;
  y: number;
}

const SCALE = 100;
/** 0.01 mm² in Clipper units (scale 100). A touching edge has no real area. */
const AREA_EPS = 100;

export function rectOutline(width: number, height: number): Pt[][] {
  return [
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
  ];
}

/**
 * A name plate: a rectangle with a bite on the right and a matching bump
 * on the left. Rotating one copy 180° lets the bump sit in the bite, which
 * a bounding box cannot do.
 */
export function notchedNameOutline(width: number, height: number): Pt[][] {
  const bite = Math.min(1.6, height * 0.16, width * 0.12);
  const y0 = height * 0.38;
  const y1 = height * 0.62;
  return [
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: y0 },
      { x: width - bite, y: y0 },
      { x: width - bite, y: y1 },
      { x: width, y: y1 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: y1 },
      { x: bite, y: y1 },
      { x: bite, y: y0 },
      { x: 0, y: y0 },
    ],
  ];
}

/** L-shaped plate. Two copies, one of them turned 180°, nest into a shorter block than two boxes. */
export function lOutline(size = 30, thick = 12): Pt[][] {
  return [
    [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: thick },
      { x: thick, y: thick },
      { x: thick, y: size },
      { x: 0, y: size },
    ],
  ];
}

export function boundsOf(polys: Pt[][]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function translatePolys(polys: Pt[][], dx: number, dy: number): Pt[][] {
  return polys.map((poly) => poly.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

export type QuarterTurn = 0 | 90 | 180 | 270;

export function addTurns(a: QuarterTurn, b: QuarterTurn): QuarterTurn {
  return (((a + b) % 360) as QuarterTurn);
}

/**
 * Rotate artwork-space polygons around the unrotated box, then shift the
 * result so the new bounding box starts at (0, 0).
 */
export function rotateOutline(
  polys: Pt[][],
  width: number,
  height: number,
  deg: QuarterTurn
): { polys: Pt[][]; width: number; height: number } {
  const map = (x: number, y: number): Pt => {
    if (deg === 0) return { x, y };
    if (deg === 90) return { x: height - y, y: x };
    if (deg === 180) return { x: width - x, y: height - y };
    return { x: y, y: width - x };
  };
  const mapped = polys.map((poly) => poly.map((p) => map(p.x, p.y)));
  const b = boundsOf(mapped);
  const onW = deg === 90 || deg === 270 ? height : width;
  const onH = deg === 90 || deg === 270 ? width : height;
  return { polys: translatePolys(mapped, -b.x, -b.y), width: onW, height: onH };
}

function toPath(poly: Pt[]): ClipperLib.IntPoint[] {
  return poly.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}

function orientPositive(path: ClipperLib.IntPoint[]): ClipperLib.IntPoint[] {
  return ClipperLib.Clipper.Area(path) < 0 ? [...path].reverse() : path;
}

function offsetPaths(paths: ClipperLib.Path[], deltaMm: number): ClipperLib.Paths {
  if (paths.length === 0 || Math.abs(deltaMm) < 1e-9) return paths;
  const offset = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
  offset.AddPaths(paths.map(orientPositive), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const result: ClipperLib.Paths = [];
  offset.Execute(result, deltaMm * SCALE);
  return result;
}

function hasArea(paths: ClipperLib.Paths): boolean {
  return paths.some((path) => Math.abs(ClipperLib.Clipper.Area(path)) > AREA_EPS);
}

/** Cut outline prepared once so later collision tests only intersect, not offset. */
export interface PreparedOutline {
  raw: ClipperLib.Paths;
  grown: ClipperLib.Paths;
}

export function prepareOutline(polys: Pt[][], clearanceMm: number): PreparedOutline {
  const raw = polys.filter((p) => p.length >= 3).map((p) => orientPositive(toPath(p)));
  const grown = clearanceMm > 1e-6 ? offsetPaths(raw, clearanceMm) : raw.map((path) => path.map((p) => ({ X: p.X, Y: p.Y })));
  return { raw, grown };
}

function shiftPaths(paths: ClipperLib.Paths, dx: number, dy: number): ClipperLib.Paths {
  const sx = Math.round(dx * SCALE);
  const sy = Math.round(dy * SCALE);
  if (sx === 0 && sy === 0) return paths;
  return paths.map((path) => path.map((p) => ({ X: p.X + sx, Y: p.Y + sy })));
}

function pathsIntersect(subject: ClipperLib.Paths, clip: ClipperLib.Paths): boolean {
  if (subject.length === 0 || clip.length === 0) return false;
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const solution: ClipperLib.Paths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return hasArea(solution);
}

/**
 * Same test as `outlinesTooClose`, using outlines that were offset once.
 * Positions are the translation of each outline's local origin.
 */
export function preparedTooClose(a: PreparedOutline, ax: number, ay: number, b: PreparedOutline, bx: number, by: number): boolean {
  return pathsIntersect(shiftPaths(a.grown, ax, ay), shiftPaths(b.raw, bx, by));
}

/** True when the two outlines come closer than `clearanceMm` (overlap counts). */
export function outlinesTooClose(a: Pt[][], b: Pt[][], clearanceMm: number): boolean {
  const prepared = prepareOutline(a, clearanceMm);
  const other = prepareOutline(b, 0);
  return preparedTooClose(prepared, 0, 0, other, 0, 0);
}

function simplifyRing(poly: Pt[], epsilon: number, maxPoints: number): Pt[] {
  if (poly.length <= 4) return poly;
  const closed = poly[0].x === poly[poly.length - 1].x && poly[0].y === poly[poly.length - 1].y ? poly.slice(0, -1) : poly;
  const kept = douglas(closed, epsilon);
  if (kept.length <= maxPoints) return kept;
  const step = Math.ceil(kept.length / maxPoints);
  const slim = kept.filter((_, i) => i % step === 0);
  return slim.length >= 3 ? slim : kept.slice(0, maxPoints);
}

function douglas(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const dist = len2 === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.sqrt(len2);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [a, b];
  const left = douglas(points.slice(0, index + 1), epsilon);
  const right = douglas(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/**
 * Polygons from a rendered outline path. Falls back to the bounding
 * rectangle when the path is missing or empty, so a photo-only piece
 * still packs.
 */
export function polygonsFromOutlinePath(d: string | null | undefined, width: number, height: number): Pt[][] {
  if (!d) return rectOutline(width, height);
  let raw: Pt[][] = [];
  try {
    raw = flattenPathToPolygons(d, 0.4);
  } catch {
    raw = [];
  }
  const polys = raw
    .map((poly) => simplifyRing(poly, 0.35, 48))
    .filter((poly) => poly.length >= 3);
  return polys.length > 0 ? polys : rectOutline(width, height);
}

/** Unrotated artwork outline placed on the sheet at `item`'s position and angle. */
export function outlineOnSheet(
  d: string | null | undefined,
  contentWidth: number,
  contentHeight: number,
  item: { posX: number; posY: number; rotationDeg: QuarterTurn }
): Pt[][] {
  const local = polygonsFromOutlinePath(d, contentWidth, contentHeight);
  const turned = rotateOutline(local, contentWidth, contentHeight, item.rotationDeg);
  return translatePolys(turned.polys, item.posX, item.posY);
}

export function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}
