/**
 * Grouped Nesting V2 — Phase 2C inner-order candidate generation.
 *
 * Phase 2A/2B packed each order ONCE against an effectively unbounded
 * virtual bin (sum-of-widths x sum-of-heights). Its result was already
 * shrink-wrapped to the true used bounds, but with no width constraint the
 * legacy BSSF scoring has no reason to form compact rows: items end up in
 * an L-shape with mixed orientations (e.g. 20x80 strips standing next to
 * 80x20 strips), leaving large holes INSIDE the group's bounding box. On
 * the Phase 2B validation dataset this measured 44.8% / 54.9% internal
 * utilization for the two worst orders.
 *
 * This module instead generates a small, bounded, deterministic set of
 * layouts per order — varying the bin's TARGET WIDTH (around the square
 * root of the order's padded item area) and a uniform ORIENTATION policy —
 * shrink-wraps each one, drops duplicates and Pareto-dominated layouts, and
 * picks one with a transparent score. Every surviving candidate is kept so
 * a later phase can choose between them based on how orders fit together.
 *
 * Still reuses the legacy `packMaxRects` unmodified as a black box (see
 * grouped-nesting.ts's top doc comment for why it must not change) — the
 * candidates differ only in the bin size and pre-oriented item footprints
 * passed in. No sort-order variation: `packMaxRects` always sorts by area
 * internally, and adding a second packer just for that is out of scope.
 */
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import type { GroupedNestingItem, GroupItemPlacement, OrderGroup, OrderLayoutCandidate } from "./grouped-nesting-types";

export interface InnerPackConfig {
  sheetWidth: number;
  sheetHeight: number;
  partGapMm: number;
  orderGapMm: number;
  sheetMarginMm: number;
}

/** "free" lets the packer rotate per item; "landscape"/"portrait" pre-rotate every item to one uniform orientation. */
export type OrientationMode = "free" | "landscape" | "portrait";

export interface InnerPackAttempt {
  orientation: OrientationMode;
  /** null = the Phase 2A unbounded virtual bin (kept as one attempt so 2C can never pick something worse than 2A). */
  targetWidth: number | null;
  label: string;
}

/** Target widths as multiples of sqrt(sum of padded item area) — narrow, square, and two progressively wider shapes. */
export const TARGET_WIDTH_MULTIPLIERS = [0.75, 1, 1.25, 1.5] as const;

/** 1 unbounded baseline + up to 3 orientation modes x 4 target widths. */
export const MAX_INNER_CANDIDATE_ATTEMPTS = 1 + 3 * TARGET_WIDTH_MULTIPLIERS.length;

/**
 * Largest group width/height the OUTER pack (`packGroupsOntoSheet`) can
 * actually place: it shrinks the sheet by `sheetMarginMm` per side, then
 * `packMaxRects` reserves `orderGapMm` as a border on each side plus one
 * trailing `orderGapMm` after the group itself.
 */
export function maxGroupSize(config: InnerPackConfig): { width: number; height: number } {
  return {
    width: config.sheetWidth - 2 * config.sheetMarginMm - 3 * config.orderGapMm,
    height: config.sheetHeight - 2 * config.sheetMarginMm - 3 * config.orderGapMm,
  };
}

/**
 * Shrink-wraps placements to their TRUE used bounds: shifts every placement
 * so the minimum x/y land on 0, and reports width/height as the extent of
 * what was actually placed — never the bin it was packed into. No extra
 * inner padding is added: the group boundary is a preview-only aid and
 * PART_GAP_MM between items is already reserved by the packer itself.
 */
export function shrinkWrapPlacements<T>(placements: GroupItemPlacement<T>[]): {
  placements: GroupItemPlacement<T>[];
  width: number;
  height: number;
} {
  if (placements.length === 0) return { placements: [], width: 0, height: 0 };

  const minX = Math.min(...placements.map((p) => p.x));
  const minY = Math.min(...placements.map((p) => p.y));
  const maxX = Math.max(...placements.map((p) => p.x + p.width));
  const maxY = Math.max(...placements.map((p) => p.y + p.height));

  return {
    placements: placements.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY })),
    width: maxX - minX,
    height: maxY - minY,
  };
}

function footprint<T>(item: GroupedNestingItem<T>, orientation: OrientationMode): { width: number; height: number; preRotated: boolean } {
  const isPortrait = item.height > item.width;
  if (orientation === "landscape" && isPortrait) return { width: item.height, height: item.width, preRotated: true };
  if (orientation === "portrait" && !isPortrait && item.width !== item.height) {
    return { width: item.height, height: item.width, preRotated: true };
  }
  return { width: item.width, height: item.height, preRotated: false };
}

/** Builds the bounded, deterministic attempt list for one order (see MAX_INNER_CANDIDATE_ATTEMPTS). */
export function buildInnerPackAttempts<T>(group: OrderGroup<T>, config: InnerPackConfig): InnerPackAttempt[] {
  const allowRotation = group.items.length > 0 && group.items.every((item) => item.allowRotation);
  const orientations: OrientationMode[] = allowRotation ? ["free", "landscape", "portrait"] : ["free"];

  const gap = config.partGapMm;
  const paddedArea = group.items.reduce((sum, item) => sum + (item.width + gap) * (item.height + gap), 0);
  const squareSide = Math.sqrt(paddedArea);
  const maxWidth = maxGroupSize(config).width;

  const attempts: InnerPackAttempt[] = [{ orientation: "free", targetWidth: null, label: "unbounded" }];

  for (const orientation of orientations) {
    // Narrowest target that still lets every item fit in this orientation policy.
    const minWidth = Math.max(
      ...group.items.map((item) => {
        if (orientation === "free") return allowRotation ? Math.min(item.width, item.height) : item.width;
        return footprint(item, orientation).width;
      })
    );

    for (const multiplier of TARGET_WIDTH_MULTIPLIERS) {
      // minWidth wins over maxWidth: an item wider than the media still gets
      // a layout here, and the outer pack reports it as unfit (never hidden).
      const targetWidth = Math.max(minWidth, Math.min(maxWidth, squareSide * multiplier));
      attempts.push({ orientation, targetWidth, label: `${orientation} w${multiplier}` });
    }
  }

  return attempts;
}

/**
 * Packs one order with one attempt's bin width + orientation policy, then
 * shrink-wraps. Returns null if the attempt failed to place every item on
 * a single bin (should not happen — the bin height always fits one column
 * of every item — but a partial layout must never be accepted as a group).
 */
export function packOrderAttempt<T>(
  group: OrderGroup<T>,
  config: InnerPackConfig,
  attempt: InnerPackAttempt,
  index: number
): OrderLayoutCandidate<T> | null {
  const gap = config.partGapMm;
  const n = group.items.length;
  if (n === 0) return null;

  const groupAllowsRotation = group.items.every((item) => item.allowRotation);
  const packerRotation = attempt.orientation === "free" && groupAllowsRotation;

  const oriented = group.items.map((item) => ({ item, ...footprint(item, attempt.orientation) }));
  const preRotatedById = new Map(oriented.map((o) => [o.item.id, o.preRotated]));

  // packMaxRects reserves `gap` as a border on every side plus one trailing
  // `gap` after each item, hence the (n + 2) * gap — see grouped-nesting.ts's
  // packOrderGroup history for the off-by-one this caused in Phase 2A.
  const sum = (pick: (item: GroupedNestingItem<T>) => number) => group.items.reduce((total, item) => total + pick(item), 0);
  const unbounded = attempt.targetWidth === null;
  // Unbounded = exactly the Phase 2A virtual bin. Bounded = target width
  // (+ both borders + one trailing gap) and tall enough for a single column
  // of every item in its longest orientation, so it never spills.
  const binWidth = unbounded ? sum((item) => item.width) + (n + 2) * gap : attempt.targetWidth! + 3 * gap;
  const binHeight = unbounded
    ? sum((item) => item.height) + (n + 2) * gap
    : sum((item) => Math.max(item.width, item.height)) + (n + 2) * gap;

  const rects: NestableRect<GroupedNestingItem<T>>[] = oriented.map((o) => ({ width: o.width, height: o.height, data: o.item }));
  const packed = packMaxRects(rects, binWidth, binHeight, gap, gap, packerRotation);

  if (packed.length !== n || packed.some((p) => p.sheetIndex !== 0)) return null;

  const wrapped = shrinkWrapPlacements(
    packed.map((p) => ({
      item: p.data,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      rotated: (preRotatedById.get(p.data.id) ?? false) !== p.rotated,
    }))
  );

  const itemArea = group.items.reduce((sum, item) => sum + item.originalWidth * item.originalHeight, 0);
  const area = wrapped.width * wrapped.height;

  return {
    candidateId: `order-${group.orderId ?? "unknown"}:${group.items.map((item) => String(item.id)).join(",")}#${index}`,
    orderId: group.orderId,
    strategy: attempt.label,
    width: wrapped.width,
    height: wrapped.height,
    placements: wrapped.placements,
    metrics: {
      area,
      itemArea,
      utilizationPercent: area > 0 ? (itemArea / area) * 100 : 0,
    },
  };
}

/** Same width x height (to 0.01 mm) = same candidate for selection purposes; the first one generated wins. */
export function dedupeCandidates<T>(candidates: OrderLayoutCandidate<T>[]): OrderLayoutCandidate<T>[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const signature = `${c.width.toFixed(2)}x${c.height.toFixed(2)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

/** A is dominated if some B is no wider AND no taller, and strictly smaller in at least one. */
export function pruneDominatedCandidates<T>(candidates: OrderLayoutCandidate<T>[]): OrderLayoutCandidate<T>[] {
  return candidates.filter(
    (a) =>
      !candidates.some(
        (b) => b !== a && b.width <= a.width && b.height <= a.height && (b.width < a.width || b.height < a.height)
      )
  );
}

const AREA_EPSILON = 1e-6;

/**
 * Phase 2C local selection, in priority order:
 *   0. fits the media at all (see `maxGroupSize`) — a slightly larger layout
 *      that fits always beats a smaller one the outer pack must reject.
 *   1. minimum bounding area
 *   2. less extreme aspect ratio (max side / min side)
 *   3. minimum max(width, height)
 *   4. generation order (keeps the result deterministic on exact ties)
 */
export function selectOrderCandidate<T>(
  candidates: OrderLayoutCandidate<T>[],
  config: InnerPackConfig
): OrderLayoutCandidate<T> | null {
  const limit = maxGroupSize(config);
  const fits = (c: OrderLayoutCandidate<T>) => c.width <= limit.width && c.height <= limit.height;
  const aspect = (c: OrderLayoutCandidate<T>) => Math.max(c.width, c.height) / Math.max(Math.min(c.width, c.height), AREA_EPSILON);

  let best: OrderLayoutCandidate<T> | null = null;
  for (const c of candidates) {
    if (!best) {
      best = c;
      continue;
    }
    if (fits(c) !== fits(best)) {
      if (fits(c)) best = c;
      continue;
    }
    const areaDiff = c.metrics.area - best.metrics.area;
    if (Math.abs(areaDiff) > AREA_EPSILON) {
      if (areaDiff < 0) best = c;
      continue;
    }
    const aspectDiff = aspect(c) - aspect(best);
    if (Math.abs(aspectDiff) > AREA_EPSILON) {
      if (aspectDiff < 0) best = c;
      continue;
    }
    if (Math.max(c.width, c.height) < Math.max(best.width, best.height)) best = c;
  }
  return best;
}

/**
 * Full Phase 2C inner pipeline for one order: attempts -> pack + shrink-wrap
 * each -> dedupe -> Pareto prune -> select. `candidates` is the surviving
 * Pareto set (always includes `selected`), kept for Phase 2D.
 */
export function generateOrderCandidates<T>(
  group: OrderGroup<T>,
  config: InnerPackConfig
): { selected: OrderLayoutCandidate<T> | null; candidates: OrderLayoutCandidate<T>[]; attemptCount: number } {
  const attempts = buildInnerPackAttempts(group, config);
  const packed = attempts
    .map((attempt, index) => packOrderAttempt(group, config, attempt, index))
    .filter((c): c is OrderLayoutCandidate<T> => c !== null);

  const candidates = pruneDominatedCandidates(dedupeCandidates(packed));
  return { selected: selectOrderCandidate(candidates, config), candidates, attemptCount: attempts.length };
}
