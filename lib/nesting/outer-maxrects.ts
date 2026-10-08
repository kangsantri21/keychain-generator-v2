/**
 * Grouped Nesting V2 — Phase 2E outer packer with selectable placement
 * heuristic and sort order.
 *
 * The legacy packer (../nesting.ts `packMaxRects`) hard-codes Best-Short-
 * Side-Fit + area-descending sort and is shared with the legacy keychain
 * flow, the append-to-batch flow and the Mahar module, so it must not change
 * (its scoring function and `Sheet` class are not even exported). This is a
 * separate, V2-only MaxRects implementation that copies the legacy free-
 * rectangle mechanics exactly — same guillotine split, same containment
 * prune, same "try the last sheet, else open a new one" spill, same border
 * and trailing-gap semantics, same Bottom-Left tie-break — and only makes
 * the score function and the pre-sort selectable. With BSSF + AREA_DESC it
 * reproduces `packMaxRects` placement-for-placement (pinned by a parity
 * test), so the Phase 2C/2D layouts stay reachable.
 *
 * Only heuristics this file actually implements are offered. Contact Point
 * is deliberately absent: lib/nesting.ts's own history records it collapsing
 * layouts into one tall column. Rotation is not supported here at all —
 * order groups are never rotated (see grouped-nesting-global.ts).
 */

export type PlacementHeuristic = "BSSF" | "BLSF" | "BAF" | "BL";
export type SortStrategy = "AREA_DESC" | "HEIGHT_DESC" | "WIDTH_DESC" | "MAX_SIDE_DESC" | "PERIMETER_DESC";

export interface OuterPackingStrategy {
  id: string;
  heuristic: PlacementHeuristic;
  sort: SortStrategy;
}

export const PLACEMENT_HEURISTICS: PlacementHeuristic[] = ["BSSF", "BAF", "BLSF", "BL"];
export const SORT_STRATEGIES: SortStrategy[] = ["AREA_DESC", "HEIGHT_DESC", "WIDTH_DESC", "MAX_SIDE_DESC", "PERIMETER_DESC"];

/** The legacy `packMaxRects` behavior — always the first strategy tried. */
export const LEGACY_OUTER_STRATEGY: OuterPackingStrategy = { id: "BSSF/AREA_DESC", heuristic: "BSSF", sort: "AREA_DESC" };

/**
 * Every heuristic x sort pair, in a fixed priority order: legacy first, then
 * the other sorts under BSSF, then each remaining heuristic with every sort.
 * When the budget only allows the first N per state, these are the N tried.
 */
export const OUTER_PACKING_STRATEGIES: OuterPackingStrategy[] = PLACEMENT_HEURISTICS.flatMap((heuristic) =>
  SORT_STRATEGIES.map((sort) => ({ id: `${heuristic}/${sort}`, heuristic, sort }))
);

export interface OuterRect<T> {
  width: number;
  height: number;
  data: T;
}

export interface OuterPlacement<T> {
  x: number;
  y: number;
  width: number;
  height: number;
  sheetIndex: number;
  data: T;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SORT_KEYS: Record<SortStrategy, (r: { width: number; height: number }) => number> = {
  AREA_DESC: (r) => r.width * r.height,
  HEIGHT_DESC: (r) => r.height,
  WIDTH_DESC: (r) => r.width,
  MAX_SIDE_DESC: (r) => Math.max(r.width, r.height),
  PERIMETER_DESC: (r) => r.width + r.height,
};

/** Smaller is better for every heuristic; ties fall through to Bottom-Left. */
function placementScore(heuristic: PlacementHeuristic, free: Rect, width: number, height: number, y: number): number {
  switch (heuristic) {
    case "BSSF":
      return Math.min(free.width - width, free.height - height);
    case "BLSF":
      return Math.max(free.width - width, free.height - height);
    case "BAF":
      return free.width * free.height - width * height;
    case "BL":
      return y + height;
  }
}

/** Same rule as lib/nesting.ts's isBetterByBottomLeft. */
function isBetterByBottomLeft(a: Rect, b: Rect): boolean {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  if (aBottom !== bBottom) return aBottom < bBottom;
  return a.x < b.x;
}

/** Same as lib/nesting.ts's splitFreeRect. */
function splitFreeRect(free: Rect, used: Rect): Rect[] {
  const overlaps =
    used.x < free.x + free.width && used.x + used.width > free.x && used.y < free.y + free.height && used.y + used.height > free.y;
  if (!overlaps) return [];

  const pieces: Rect[] = [];
  if (used.x < free.x + free.width && used.x + used.width > free.x) {
    if (used.y > free.y && used.y < free.y + free.height) {
      pieces.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    if (used.y + used.height < free.y + free.height) {
      pieces.push({ x: free.x, y: used.y + used.height, width: free.width, height: free.y + free.height - (used.y + used.height) });
    }
  }
  if (used.y < free.y + free.height && used.y + used.height > free.y) {
    if (used.x > free.x && used.x < free.x + free.width) {
      pieces.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
    }
    if (used.x + used.width < free.x + free.width) {
      pieces.push({ x: used.x + used.width, y: free.y, width: free.x + free.width - (used.x + used.width), height: free.height });
    }
  }
  return pieces;
}

/** Same as lib/nesting.ts's pruneFreeRects. */
function pruneFreeRects(freeRects: Rect[]): Rect[] {
  const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
  return freeRects.filter((rect, i) => !freeRects.some((other, j) => i !== j && contains(other, rect)));
}

class OuterSheet {
  freeRects: Rect[];

  constructor(usableWidth: number, usableHeight: number, border: number) {
    this.freeRects = [{ x: border, y: border, width: usableWidth, height: usableHeight }];
  }

  place(width: number, height: number, gap: number, heuristic: PlacementHeuristic): Rect | null {
    const paddedWidth = width + gap;
    const paddedHeight = height + gap;
    let best: Rect | null = null;
    let bestScore = Infinity;

    for (const free of this.freeRects) {
      if (free.width < paddedWidth || free.height < paddedHeight) continue;
      const candidate: Rect = { x: free.x, y: free.y, width: paddedWidth, height: paddedHeight };
      const score = placementScore(heuristic, free, paddedWidth, paddedHeight, free.y);
      if (!best || score < bestScore || (score === bestScore && isBetterByBottomLeft(candidate, best))) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) return null;

    const next: Rect[] = [];
    for (const free of this.freeRects) {
      const pieces = splitFreeRect(free, best);
      if (pieces.length === 0) next.push(free);
      else next.push(...pieces);
    }
    this.freeRects = pruneFreeRects(next);

    return { x: best.x, y: best.y, width, height };
  }
}

/**
 * Packs `rects` (never rotated) onto as many `sheetWidth x sheetHeight`
 * sheets as needed with `gap` as border and trailing clearance — identical
 * semantics to `packMaxRects(rects, w, h, gap, gap, false)`. Ties in the
 * sort key keep input order (stable sort), exactly like the legacy sort.
 * A rect larger than the usable sheet is dropped, also like legacy; the
 * caller detects it by count.
 */
export function packOuterRects<T>(
  rects: OuterRect<T>[],
  sheetWidth: number,
  sheetHeight: number,
  gap: number,
  strategy: OuterPackingStrategy
): OuterPlacement<T>[] {
  const usableWidth = sheetWidth - 2 * gap;
  const usableHeight = sheetHeight - 2 * gap;
  const key = SORT_KEYS[strategy.sort];
  const sorted = rects.slice().sort((a, b) => key(b) - key(a));

  const results: OuterPlacement<T>[] = [];
  const sheets: OuterSheet[] = [new OuterSheet(usableWidth, usableHeight, gap)];

  for (const rect of sorted) {
    if (rect.width > usableWidth || rect.height > usableHeight) continue;

    let sheetIndex = sheets.length - 1;
    let placed = sheets[sheetIndex].place(rect.width, rect.height, gap, strategy.heuristic);
    if (!placed) {
      sheets.push(new OuterSheet(usableWidth, usableHeight, gap));
      sheetIndex = sheets.length - 1;
      placed = sheets[sheetIndex].place(rect.width, rect.height, gap, strategy.heuristic);
    }
    if (placed) results.push({ ...placed, sheetIndex, data: rect.data });
  }

  return results;
}
