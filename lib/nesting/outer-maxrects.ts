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

/**
 * Inter-group clearance per axis: `x` between side-by-side groups (and the
 * left/right packer border), `y` between stacked groups (and the top/bottom
 * border). A plain number = the same on both axes — the original semantics.
 */
export type AxisGap = number | { x: number; y: number };

export function axisGap(gap: AxisGap): { x: number; y: number } {
  return typeof gap === "number" ? { x: gap, y: gap } : gap;
}

export type PlacementHeuristic = "BSSF" | "BLSF" | "BAF" | "BL";
export type SortStrategy = "AREA_DESC" | "HEIGHT_DESC" | "WIDTH_DESC" | "MAX_SIDE_DESC" | "PERIMETER_DESC";

/**
 * PHASE 2H — how a group that does not fit picks a sheet.
 * LAST_ONLY: try the most recently opened sheet, else open a new one (the
 * legacy/Phase 2G behavior). BEST_EXISTING: try EVERY open sheet and take the
 * best insertion; open a new sheet only when no open sheet can take it.
 */
export type SheetMode = "LAST_ONLY" | "BEST_EXISTING";

export interface OuterPackingStrategy {
  id: string;
  heuristic: PlacementHeuristic;
  sort: SortStrategy;
  /** Omitted = LAST_ONLY. */
  sheetMode?: SheetMode;
}

/** The same heuristic x sort, but placing with BEST_EXISTING (id gets a "+BEST_EXISTING" suffix). */
export function withBestExisting(strategy: OuterPackingStrategy): OuterPackingStrategy {
  return { ...strategy, id: `${strategy.id}+BEST_EXISTING`, sheetMode: "BEST_EXISTING" };
}

/** PHASE 2H — counters filled in by a BEST_EXISTING pack (all zero for LAST_ONLY). */
export interface MultiSheetPackStats {
  /** Open sheets tried (findBest calls) across the whole pack. */
  existingSheetAttempts: number;
  /** Groups placed on a sheet other than the most recently opened one. */
  backfills: number;
  /** Groups the last sheet could NOT take but an earlier sheet could — each one a sheet LAST_ONLY would have opened. */
  newSheetsAvoided: number;
}

export function emptyMultiSheetPackStats(): MultiSheetPackStats {
  return { existingSheetAttempts: 0, backfills: 0, newSheetsAvoided: 0 };
}

/** Default cap on findBest calls in one BEST_EXISTING pack; past it, placement falls back to the last sheet only. */
export const MAX_EXISTING_SHEET_TRIALS = 5000;

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

/**
 * How a used node relates to a free rect. `splitFreeRect` alone cannot tell
 * NO_OVERLAP from FULLY_CONSUMED (it returns [] for both), so a caller that
 * keeps the free rect whenever it gets [] also keeps a free rect the node
 * covers exactly — a phantom slot on top of a placed rect.
 */
export type FreeRectCut = "NO_OVERLAP" | "PARTIAL_OVERLAP" | "FULLY_CONSUMED";

/** Exact-fit-safe classification + split of `free` by `used` (pieces are empty unless PARTIAL_OVERLAP). */
export function cutFreeRect(free: Rect, used: Rect): { kind: FreeRectCut; pieces: Rect[] } {
  const overlaps =
    used.x < free.x + free.width && used.x + used.width > free.x && used.y < free.y + free.height && used.y + used.height > free.y;
  if (!overlaps) return { kind: "NO_OVERLAP", pieces: [] };
  const pieces = splitFreeRect(free, used);
  return pieces.length === 0 ? { kind: "FULLY_CONSUMED", pieces } : { kind: "PARTIAL_OVERLAP", pieces };
}

/** Same as lib/nesting.ts's pruneFreeRects. */
function pruneFreeRects(freeRects: Rect[]): Rect[] {
  const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
  return freeRects.filter((rect, i) => !freeRects.some((other, j) => i !== j && contains(other, rect)));
}

class OuterSheet {
  freeRects: Rect[];
  /** Extent of what is placed so far (unpadded) and its area — for BEST_EXISTING scoring. */
  maxX = 0;
  maxY = 0;
  placedArea = 0;

  constructor(
    usableWidth: number,
    usableHeight: number,
    border: AxisGap,
    /** V3 only: drop a free rect the node covers exactly (see cutFreeRect). Off = the legacy/V2 behavior. */
    private readonly exactFitSafe = false
  ) {
    const b = axisGap(border);
    this.freeRects = [{ x: b.x, y: b.y, width: usableWidth, height: usableHeight }];
  }

  /** Best padded node for a width x height rect, WITHOUT touching this sheet's state. */
  findBest(width: number, height: number, gap: AxisGap, heuristic: PlacementHeuristic): { node: Rect; score: number } | null {
    const g = axisGap(gap);
    const paddedWidth = width + g.x;
    const paddedHeight = height + g.y;
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
    return best ? { node: best, score: bestScore } : null;
  }

  /** Carves a node found by findBest out of this sheet; returns the unpadded placement. */
  commit(node: Rect, width: number, height: number): Rect {
    const next: Rect[] = [];
    for (const free of this.freeRects) {
      if (this.exactFitSafe) {
        const cut = cutFreeRect(free, node);
        if (cut.kind === "NO_OVERLAP") next.push(free);
        else next.push(...cut.pieces);
        continue;
      }
      const pieces = splitFreeRect(free, node);
      if (pieces.length === 0) next.push(free);
      else next.push(...pieces);
    }
    this.freeRects = pruneFreeRects(next);
    this.maxX = Math.max(this.maxX, node.x + width);
    this.maxY = Math.max(this.maxY, node.y + height);
    this.placedArea += width * height;
    return { x: node.x, y: node.y, width, height };
  }

  place(width: number, height: number, gap: AxisGap, heuristic: PlacementHeuristic): Rect | null {
    const found = this.findBest(width, height, gap, heuristic);
    return found ? this.commit(found.node, width, height) : null;
  }
}

/**
 * Packs `rects` (never rotated) onto as many `sheetWidth x sheetHeight`
 * sheets as needed with `gap` as border and trailing clearance — identical
 * semantics to `packMaxRects(rects, w, h, gap, gap, false)` for a single
 * number. With a per-axis gap, x and y each get their own border + trailing
 * clearance. Ties in the
 * sort key keep input order (stable sort), exactly like the legacy sort.
 * A rect larger than the usable sheet is dropped, also like legacy; the
 * caller detects it by count.
 */
export function packOuterRects<T>(
  rects: OuterRect<T>[],
  sheetWidth: number,
  sheetHeight: number,
  gap: AxisGap,
  strategy: OuterPackingStrategy,
  options: {
    stats?: MultiSheetPackStats;
    maxExistingSheetTrials?: number;
    /** V3 only (slot reflow): exact-fit-safe free-rect carving. Omitted/false = unchanged legacy/V2 semantics. */
    exactFitSafe?: boolean;
  } = {}
): OuterPlacement<T>[] {
  const g = axisGap(gap);
  const usableWidth = sheetWidth - 2 * g.x;
  const usableHeight = sheetHeight - 2 * g.y;
  const key = SORT_KEYS[strategy.sort];
  const sorted = rects.slice().sort((a, b) => key(b) - key(a));

  const results: OuterPlacement<T>[] = [];
  const exactFitSafe = options.exactFitSafe ?? false;
  const sheets: OuterSheet[] = [new OuterSheet(usableWidth, usableHeight, gap, exactFitSafe)];

  const bestExisting = strategy.sheetMode === "BEST_EXISTING";
  const maxTrials = options.maxExistingSheetTrials ?? MAX_EXISTING_SHEET_TRIALS;
  const stats = options.stats ?? emptyMultiSheetPackStats();
  let trials = 0;

  for (const rect of sorted) {
    if (rect.width > usableWidth || rect.height > usableHeight) continue;

    if (bestExisting) {
      const placed = placeOnBestExistingSheet(sheets, rect, gap, strategy.heuristic, maxTrials - trials, stats);
      trials += placed.trials;
      if (placed.result) {
        results.push({ ...placed.result.rect, sheetIndex: placed.result.sheetIndex, data: rect.data });
        continue;
      }
      // No open sheet can take it: only now open a new one.
      sheets.push(new OuterSheet(usableWidth, usableHeight, gap, exactFitSafe));
      const fresh = sheets[sheets.length - 1].place(rect.width, rect.height, gap, strategy.heuristic);
      if (fresh) results.push({ ...fresh, sheetIndex: sheets.length - 1, data: rect.data });
      continue;
    }

    let sheetIndex = sheets.length - 1;
    let placed = sheets[sheetIndex].place(rect.width, rect.height, gap, strategy.heuristic);
    if (!placed) {
      sheets.push(new OuterSheet(usableWidth, usableHeight, gap, exactFitSafe));
      sheetIndex = sheets.length - 1;
      placed = sheets[sheetIndex].place(rect.width, rect.height, gap, strategy.heuristic);
    }
    if (placed) results.push({ ...placed, sheetIndex, data: rect.data });
  }

  return results;
}

/**
 * BEST_EXISTING insertion: simulate the rect on every open sheet (findBest
 * never mutates), then commit only the winner. Ranking among sheets that can
 * take it:
 *   1. smallest increase of that sheet's used height (= of the global sum)
 *   2. smallest resulting bounding waste on that sheet (fills its holes)
 *   3. the heuristic's own placement score (tightest fit)
 *   4. lower sheetIndex
 * Once `trialsLeft` runs out only the last sheet is tried (LAST_ONLY).
 */
function placeOnBestExistingSheet(
  sheets: OuterSheet[],
  rect: { width: number; height: number },
  gap: AxisGap,
  heuristic: PlacementHeuristic,
  trialsLeft: number,
  stats: MultiSheetPackStats
): { result: { sheetIndex: number; rect: Rect } | null; trials: number } {
  const lastIndex = sheets.length - 1;
  const firstIndex = trialsLeft >= sheets.length ? 0 : lastIndex;
  let trials = 0;
  let lastSheetFits = false;
  let best: { sheetIndex: number; node: Rect; key: number[] } | null = null;

  for (let sheetIndex = firstIndex; sheetIndex <= lastIndex; sheetIndex++) {
    const sheet = sheets[sheetIndex];
    trials++;
    stats.existingSheetAttempts++;
    const found = sheet.findBest(rect.width, rect.height, gap, heuristic);
    if (!found) continue;
    if (sheetIndex === lastIndex) lastSheetFits = true;

    const newMaxX = Math.max(sheet.maxX, found.node.x + rect.width);
    const newMaxY = Math.max(sheet.maxY, found.node.y + rect.height);
    const heightDelta = newMaxY - sheet.maxY;
    const waste = newMaxX * newMaxY - (sheet.placedArea + rect.width * rect.height);
    const key = [heightDelta, waste, found.score, sheetIndex];

    if (!best || compareKeys(key, best.key) < 0) best = { sheetIndex, node: found.node, key };
  }

  if (!best) return { result: null, trials };
  if (best.sheetIndex !== lastIndex) stats.backfills++;
  if (!lastSheetFits) stats.newSheetsAvoided++;
  return { result: { sheetIndex: best.sheetIndex, rect: sheets[best.sheetIndex].commit(best.node, rect.width, rect.height) }, trials };
}

const KEY_EPSILON = 1e-9;

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    if (Math.abs(diff) > KEY_EPSILON) return diff;
  }
  return 0;
}

/** A free rectangle of the packer's own state (padded space: a W x H rect fits iff W + gap.x <= width and H + gap.y <= height). */
export type FreeRect = Rect;

/**
 * V3A — read-only view of one sheet's free-rectangle state. Replays
 * `occupied` (unpadded placements in the same coordinates `packOuterRects`
 * returns) onto a fresh `OuterSheet` and returns copies of the resulting
 * free rectangles. Uses exact-fit-safe carving (see `cutFreeRect`): with the
 * legacy carve a rect committed after neighbours that box it in exactly left
 * its own node behind as a "free" phantom slot, so the result depended on the
 * replay order. Packing behavior (legacy/V2) is unchanged.
 */
export function replayFreeRects(
  occupied: { x: number; y: number; width: number; height: number }[],
  sheetWidth: number,
  sheetHeight: number,
  gap: AxisGap
): FreeRect[] {
  const g = axisGap(gap);
  const sheet = new OuterSheet(sheetWidth - 2 * g.x, sheetHeight - 2 * g.y, g, true);
  for (const rect of occupied) {
    sheet.commit({ x: rect.x, y: rect.y, width: rect.width + g.x, height: rect.height + g.y }, rect.width, rect.height);
  }
  return sheet.freeRects.map((free) => ({ ...free }));
}
