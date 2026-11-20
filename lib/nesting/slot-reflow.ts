/**
 * Grouped Nesting V3A-1 (EXPERIMENTAL) — re-arrange one order's items so the
 * whole order fits a given free slot.
 *
 * V2 builds each order's shape first (grouped-nesting-candidates.ts, target
 * WIDTH only) and then looks for a place for it. A human operator works the
 * other way round: they see a free area on the sheet and re-arrange a resi's
 * items to fit THAT area. `reflowOrderIntoSlot` is that second step: it
 * packs every item of one order into a bin sized from the slot's width AND
 * height, with a bounded, deterministic list of variants, and keeps each
 * variant that places EVERY item.
 *
 * Artwork is never resized, distorted, dropped or duplicated: items keep
 * their own width/height and only move (and rotate 90°, only where the
 * rotation rule allows it). PART_GAP is reserved by the packers exactly as
 * in V2. Reuses the existing packers as black boxes: the V2 outer MaxRects
 * (`packOuterRects`, selectable sort + heuristic, no rotation) on
 * pre-oriented items, and the legacy `packMaxRects` for per-item rotation.
 */
import { packMaxRects } from "@/lib/nesting";
import { packOuterRects, type PlacementHeuristic } from "./outer-maxrects";
import { shrinkWrapPlacements } from "./grouped-nesting-candidates";
import type { GroupedNestingItem, GroupItemPlacement, OrderLayoutCandidate } from "./grouped-nesting-types";

export type ReflowSort = "AREA_DESC" | "WIDTH_DESC" | "HEIGHT_DESC" | "MAX_SIDE_DESC";
/**
 * "as-is": every item in its own orientation. "landscape"/"portrait": every
 * rotatable item pre-rotated to that orientation. "free": the legacy packer
 * rotates per item (BSSF + area sort only).
 */
export type ReflowOrientation = "as-is" | "landscape" | "portrait" | "free";

export interface ReflowVariant {
  orientation: ReflowOrientation;
  sort: ReflowSort;
  heuristic: PlacementHeuristic;
  label: string;
}

export const REFLOW_SORTS: ReflowSort[] = ["AREA_DESC", "WIDTH_DESC", "HEIGHT_DESC", "MAX_SIDE_DESC"];
export const REFLOW_HEURISTICS: PlacementHeuristic[] = ["BSSF", "BL"];

/**
 * The rotation rule, isolated so it can be replaced (e.g. by a per-template
 * flag) without touching the engine. V3A-1 uses the V2 rule unchanged
 * (grouped-nesting-candidates.ts): an order may rotate only if EVERY item
 * allows it; otherwise nothing in it rotates.
 */
export type RotationRule = <T>(items: GroupedNestingItem<T>[]) => (item: GroupedNestingItem<T>) => boolean;

export const V2_ROTATION_RULE: RotationRule = (items) => {
  const all = items.length > 0 && items.every((item) => item.allowRotation);
  return () => all;
};

/** Deterministic variant list: "free" first, then each orientation x sort x heuristic. */
export function buildReflowVariants<T>(items: GroupedNestingItem<T>[], rule: RotationRule = V2_ROTATION_RULE): ReflowVariant[] {
  const canRotate = rule(items);
  const anyRotatable = items.some((item) => canRotate(item));
  const orientations: ReflowOrientation[] = anyRotatable ? ["as-is", "landscape", "portrait"] : ["as-is"];
  const variants: ReflowVariant[] = [];
  if (anyRotatable) variants.push({ orientation: "free", sort: "AREA_DESC", heuristic: "BSSF", label: "free/BSSF/AREA_DESC" });
  for (const orientation of orientations) {
    for (const sort of REFLOW_SORTS) {
      for (const heuristic of REFLOW_HEURISTICS) {
        variants.push({ orientation, sort, heuristic, label: `${orientation}/${heuristic}/${sort}` });
      }
    }
  }
  return variants;
}

function orient<T>(item: GroupedNestingItem<T>, orientation: ReflowOrientation, rotatable: boolean): { width: number; height: number; preRotated: boolean } {
  const isPortrait = item.height > item.width;
  const swap =
    rotatable && item.width !== item.height && ((orientation === "landscape" && isPortrait) || (orientation === "portrait" && !isPortrait));
  return swap ? { width: item.height, height: item.width, preRotated: true } : { width: item.width, height: item.height, preRotated: false };
}

const FIT_EPSILON = 1e-6;

/** True if two placements overlap or sit closer than `gap` on both axes. */
export function hasItemCollision(placements: { x: number; y: number; width: number; height: number }[], gap: number): boolean {
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      const apart =
        a.x + a.width + gap <= b.x + FIT_EPSILON ||
        b.x + b.width + gap <= a.x + FIT_EPSILON ||
        a.y + a.height + gap <= b.y + FIT_EPSILON ||
        b.y + b.height + gap <= a.y + FIT_EPSILON;
      if (!apart) return true;
    }
  }
  return false;
}

/**
 * Cheap necessary conditions before any packing: every item fits the slot
 * in an allowed orientation, and the items' padded area fits the slot's
 * padded area (each item reserves width+gap x height+gap inside a
 * (slot+gap) x (slot+gap) region — see `reflowOrderIntoSlot`).
 */
export function slotCanPossiblyHold<T>(
  items: GroupedNestingItem<T>[],
  slotWidth: number,
  slotHeight: number,
  partGap: number,
  rule: RotationRule = V2_ROTATION_RULE
): boolean {
  if (items.length === 0 || slotWidth <= 0 || slotHeight <= 0) return false;
  const canRotate = rule(items);
  const fitsAlone = items.every(
    (item) =>
      (item.width <= slotWidth + FIT_EPSILON && item.height <= slotHeight + FIT_EPSILON) ||
      (canRotate(item) && item.height <= slotWidth + FIT_EPSILON && item.width <= slotHeight + FIT_EPSILON)
  );
  if (!fitsAlone) return false;
  const paddedArea = items.reduce((sum, item) => sum + (item.width + partGap) * (item.height + partGap), 0);
  return paddedArea <= (slotWidth + partGap) * (slotHeight + partGap) + FIT_EPSILON;
}

export interface ReflowResult<T> {
  /** Distinct (by W x H) layouts that hold EVERY item within slotWidth x slotHeight, in variant order. */
  candidates: OrderLayoutCandidate<T>[];
  /** Packings actually run (0 when the pre-filter rejects the slot). */
  attempts: number;
}

/**
 * Packs ALL of one order's `items` into a `slotWidth x slotHeight` area,
 * once per variant (at most `maxVariants`). The bin is the slot plus
 * 3 x partGap — the packers keep `partGap` as a border on each side plus a
 * trailing gap after every item, exactly like the V2 inner pack — so a
 * layout that places every item on the first bin shrink-wraps to at most
 * slotWidth x slotHeight. A variant that cannot place every item is
 * discarded: a partial order is never returned.
 */
export function reflowOrderIntoSlot<T>(
  items: GroupedNestingItem<T>[],
  slotWidth: number,
  slotHeight: number,
  partGap: number,
  options: { orderId?: number | null; maxVariants?: number; rule?: RotationRule } = {}
): ReflowResult<T> {
  const rule = options.rule ?? V2_ROTATION_RULE;
  if (!slotCanPossiblyHold(items, slotWidth, slotHeight, partGap, rule)) return { candidates: [], attempts: 0 };

  const canRotate = rule(items);
  const variants = buildReflowVariants(items, rule).slice(0, Math.max(0, options.maxVariants ?? Infinity));
  const binWidth = slotWidth + 3 * partGap;
  const binHeight = slotHeight + 3 * partGap;
  const n = items.length;
  const itemArea = items.reduce((sum, item) => sum + item.originalWidth * item.originalHeight, 0);
  const orderId = options.orderId ?? items[0]?.orderId ?? null;

  const seen = new Set<string>();
  const candidates: OrderLayoutCandidate<T>[] = [];
  let attempts = 0;

  for (const variant of variants) {
    attempts++;
    let placements: GroupItemPlacement<T>[] | null = null;

    if (variant.orientation === "free") {
      // Per-item rotation only where the rule allows it for every item (V2 all-or-nothing).
      const allowRotation = items.every((item) => canRotate(item));
      const packed = packMaxRects(
        items.map((item) => ({ width: item.width, height: item.height, data: item })),
        binWidth,
        binHeight,
        partGap,
        partGap,
        allowRotation
      );
      if (packed.length === n && packed.every((p) => p.sheetIndex === 0)) {
        placements = packed.map((p) => ({ item: p.data, x: p.x, y: p.y, width: p.width, height: p.height, rotated: p.rotated }));
      }
    } else {
      const oriented = items.map((item) => ({ item, ...orient(item, variant.orientation, canRotate(item)) }));
      const packed = packOuterRects(
        oriented.map((o) => ({ width: o.width, height: o.height, data: o })),
        binWidth,
        binHeight,
        partGap,
        { id: variant.label, heuristic: variant.heuristic, sort: variant.sort },
        { exactFitSafe: true }
      );
      if (packed.length === n && packed.every((p) => p.sheetIndex === 0)) {
        placements = packed.map((p) => ({ item: p.data.item, x: p.x, y: p.y, width: p.width, height: p.height, rotated: p.data.preRotated }));
      }
    }

    // Exact-fit guard: the "free" variant uses the untouched legacy packer, whose carve can leave a
    // phantom free rect on an exact fit; any arrangement with two items closer than PART_GAP is dropped.
    if (!placements || hasItemCollision(placements, partGap)) continue;
    const wrapped = shrinkWrapPlacements(placements);
    if (wrapped.width > slotWidth + FIT_EPSILON || wrapped.height > slotHeight + FIT_EPSILON) continue;

    const signature = `${wrapped.width.toFixed(2)}x${wrapped.height.toFixed(2)}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    const area = wrapped.width * wrapped.height;
    candidates.push({
      candidateId: `order-${orderId ?? "unknown"}:${items.map((item) => String(item.id)).join(",")}#slot-reflow:${variant.label}:${signature}`,
      orderId,
      strategy: `slot-reflow ${variant.label}`,
      source: "SLOT_REFLOW",
      width: wrapped.width,
      height: wrapped.height,
      placements: wrapped.placements,
      metrics: { area, itemArea, utilizationPercent: area > 0 ? (itemArea / area) * 100 : 0 },
    });
  }

  return { candidates, attempts };
}
