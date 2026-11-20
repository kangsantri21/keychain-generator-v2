/**
 * Production group compaction — a deterministic post-pack pass. Every
 * receipt group is a RIGID rectangle (its final footprint box): only its
 * position changes, never its content (no reflow, no resize, no rotation,
 * no split). Groups slide left as far as possible, then up, repeating
 * X -> Y -> X -> ... until nothing moves.
 *
 * A slide is continuous (exact collision distance, no grid): a group stops
 * at the frame edge (first-group position: margin + gap per axis, the same
 * edge the outer pack uses) or exactly the minimum gap from the group that
 * blocks it — the Production receipt gaps (2 mm side by side, 2 mm stacked). Groups only ever
 * move left/up, so per sheet used width/height can only shrink and the sheet
 * count never changes: the objective can never get worse.
 *
 * Labels play no part: internal receipt labels are placed afterwards, in
 * whatever free space the compacted layout has (lib/receipt-labels.ts).
 */
import { FIDUCIAL_CLEARANCE_MM, PRODUCTION_SPACING, outerSpacing, type OuterSpacingConfig } from "./grouped-nesting-config";
import { fiducialDistance } from "@/lib/production-gate";

const EPS = 1e-6;
const MAX_ROUNDS = 200;

export interface RigidRect {
  key: number;
  sheet: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompactionBounds {
  /** Leftmost / topmost allowed group position. */
  minX: number;
  minY: number;
  gapX: number;
  gapY: number;
}

export type CompactionStatus = "COMPACTED_X" | "COMPACTED_Y" | "BLOCKED";

export interface CompactionMove {
  key: number;
  sheet: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Total displacement (<= 0: left / up). */
  dx: number;
  dy: number;
  /** COMPACTED_X and/or COMPACTED_Y when it moved; BLOCKED when it could not move at all. */
  status: CompactionStatus[];
  /** What stops it now: "edge" (frame/margin), "fiducial", or the blocking group's key. */
  blockedLeftBy: number | "edge" | "fiducial";
  blockedUpBy: number | "edge" | "fiducial";
}

/** The frame edges and gaps of a spacing config: Production = left 5, top 13, gaps 2 / 2. */
export function compactionBoundsOf(config: OuterSpacingConfig): CompactionBounds {
  const s = outerSpacing(config);
  return { minX: s.marginX + s.gapX, minY: s.marginY + s.gapY, gapX: s.gapX, gapY: s.gapY };
}

export const PRODUCTION_COMPACTION_BOUNDS: CompactionBounds = compactionBoundsOf(PRODUCTION_SPACING);

/** Clear distance along y / along x between two rects (negative = projections overlap). */
const gapY = (a: RigidRect, b: RigidRect) => Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
const gapX = (a: RigidRect, b: RigidRect) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));

const fiducialSafe = (r: RigidRect) => fiducialDistance({ posX: r.x, posY: r.y, width: r.w, height: r.h }) >= FIDUCIAL_CLEARANCE_MM - EPS;

/** Furthest-left position of `r` among `others` (same sheet), and what stops it there. */
export function slideLeftLimit(r: RigidRect, others: RigidRect[], b: CompactionBounds): { x: number; by: number | "edge" } {
  let x = b.minX;
  let by: number | "edge" = "edge";
  for (const o of others) {
    if (o.key === r.key || o.sheet !== r.sheet) continue;
    // Only a group whose rows come closer than the vertical gap can block a horizontal slide.
    if (gapY(r, o) >= b.gapY - EPS || o.x + o.w > r.x + EPS) continue;
    const stop = o.x + o.w + b.gapX;
    if (stop > x + EPS || (Math.abs(stop - x) <= EPS && by === "edge")) {
      x = stop;
      by = o.key;
    }
  }
  return { x: Math.min(x, r.x), by };
}

/** Furthest-up position of `r` among `others` (same sheet), and what stops it there. */
export function slideUpLimit(r: RigidRect, others: RigidRect[], b: CompactionBounds): { y: number; by: number | "edge" } {
  let y = b.minY;
  let by: number | "edge" = "edge";
  for (const o of others) {
    if (o.key === r.key || o.sheet !== r.sheet) continue;
    if (gapX(r, o) >= b.gapX - EPS || o.y + o.h > r.y + EPS) continue;
    const stop = o.y + o.h + b.gapY;
    if (stop > y + EPS || (Math.abs(stop - y) <= EPS && by === "edge")) {
      y = stop;
      by = o.key;
    }
  }
  return { y: Math.min(y, r.y), by };
}

/**
 * Compacts rigid rects toward the top-left. Pure and deterministic: within a
 * pass groups are processed left-to-right (X) / top-to-bottom (Y), ties by
 * key. Input must be a valid layout (pairwise gaps already met).
 */
export function compactRigidRects(input: RigidRect[], b: CompactionBounds): { rects: RigidRect[]; moves: CompactionMove[]; rounds: number } {
  const rects = input.map((r) => ({ ...r }));
  const order = (axis: "x" | "y") => [...rects].sort((p, q) => p.sheet - q.sheet || p[axis] - q[axis] || (axis === "x" ? p.y - q.y : p.x - q.x) || p.key - q.key);
  let rounds = 0;
  for (; rounds < MAX_ROUNDS; rounds++) {
    let moved = false;
    for (const r of order("x")) {
      const { x } = slideLeftLimit(r, rects, b);
      if (x < r.x - EPS && fiducialSafe({ ...r, x })) {
        r.x = x;
        moved = true;
      }
    }
    for (const r of order("y")) {
      const { y } = slideUpLimit(r, rects, b);
      if (y < r.y - EPS && fiducialSafe({ ...r, y })) {
        r.y = y;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const moves = input.map((from, i) => {
    const to = rects[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const status: CompactionStatus[] = [];
    if (dx < -EPS) status.push("COMPACTED_X");
    if (dy < -EPS) status.push("COMPACTED_Y");
    if (status.length === 0) status.push("BLOCKED");
    const left = slideLeftLimit(to, rects, b);
    const up = slideUpLimit(to, rects, b);
    return {
      key: from.key,
      sheet: from.sheet,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      dx,
      dy,
      status,
      blockedLeftBy: left.x < to.x - EPS ? ("fiducial" as const) : left.by,
      blockedUpBy: up.y < to.y - EPS ? ("fiducial" as const) : up.by,
    };
  });
  return { rects, moves, rounds };
}
