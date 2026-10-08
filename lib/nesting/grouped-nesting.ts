/**
 * Grouped Nesting V2 — Phase 2A core foundation.
 *
 * Fixes the audit's central finding (see PHASE 1 report): the legacy engine
 * (../nesting.ts's `packMaxRects`) receives `orderId` as opaque `data` it
 * never reads, and sorts every item by area alone — so items from
 * different resi end up interleaved on the sheet with nothing enforcing
 * adjacency. This module makes `orderId` a first-class grouping key
 * instead: every item is grouped by order FIRST (`groupItemsByOrder`),
 * each order's items are packed into one compact local "candidate"
 * (`packOrderGroup` — the INNER pack), then every order's candidate is
 * treated as a single rectangle and packed onto the real sheet
 * (`packGroupsOntoSheet` — the OUTER pack). Items from the same order can
 * therefore never end up split across the sheet with another order's items
 * wedged between them.
 *
 * Deliberately reuses the legacy `packMaxRects` as an unmodified black box
 * for BOTH the inner and outer pack — per the audit, `packMaxRects` is also
 * called directly by the "Bahan Mahar" module
 * (app/mahar-nesting/page.tsx), so its signature/behavior must not change;
 * calling it (not editing it) carries zero risk to that module or to the
 * legacy keychain flow, which keeps using it exactly as before.
 *
 * Phase 2A scope (see the PHASE 2A instructions this module was built
 * against for the full list): ONE deterministic candidate per order (Phase
 * 2C since replaced this with a bounded multi-candidate inner pack — see
 * grouped-nesting-candidates.ts), rectangle-only outer packing (no group
 * rotation, no true-shape/polygon nesting), no per-item OR per-group
 * receipt-label rendering, no persistence wiring — this module is a pure,
 * standalone computation with no I/O and no side effects.
 */
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import { generateOrderCandidates } from "./grouped-nesting-candidates";
import { DEFAULT_GLOBAL_SEARCH_LIMITS, type GlobalSearchLimits } from "./grouped-nesting-global";
import { optimizeOuterLayout, DEFAULT_OUTER_PACKING_LIMITS, type OuterPackingLimits } from "./grouped-nesting-outer";
import { packOuterRects, LEGACY_OUTER_STRATEGY, type OuterPackingStrategy } from "./outer-maxrects";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, PART_GAP_MM, ORDER_GAP_MM, SHEET_MARGIN_MM } from "./grouped-nesting-config";
import type {
  GroupedNestingItem,
  OrderGroup,
  OrderLayoutCandidate,
  GroupPlacement,
  GroupedPackedRect,
  GroupedNestingMetrics,
  GroupedNestingResult,
} from "./grouped-nesting-types";

export type {
  GroupedNestingItem,
  OrderGroup,
  OrderLayoutCandidate,
  GroupItemPlacement,
  GroupPlacement,
  GroupedPackedRect,
  GroupedNestingMetrics,
  GroupedNestingResult,
} from "./grouped-nesting-types";

export interface GroupedNestingConfig {
  sheetWidth: number;
  sheetHeight: number;
  partGapMm: number;
  orderGapMm: number;
  sheetMarginMm: number;
}

export type GroupedNestingConfigOverrides = Partial<GroupedNestingConfig>;

function resolveConfig(overrides: GroupedNestingConfigOverrides): GroupedNestingConfig {
  return {
    sheetWidth: overrides.sheetWidth ?? SHEET_WIDTH_MM,
    sheetHeight: overrides.sheetHeight ?? SHEET_HEIGHT_MM,
    partGapMm: overrides.partGapMm ?? PART_GAP_MM,
    orderGapMm: overrides.orderGapMm ?? ORDER_GAP_MM,
    sheetMarginMm: overrides.sheetMarginMm ?? SHEET_MARGIN_MM,
  };
}

/**
 * Groups items by `orderId` — pure function, no packing happens here.
 *
 * An item with a missing `orderId` (`null`/`undefined`) is NEVER folded
 * into a shared "unknown order" bucket with other such items: each becomes
 * its own singleton group, keyed by that item's own `id`, so two orphaned
 * items are guaranteed to end up in two different groups (and therefore
 * never treated as if they were adjacency-related to each other). This is
 * the explicit, non-silent behavior the audit called for — the alternative
 * (merging every orphan into one big anonymous group) would recreate
 * exactly the "items from unrelated things end up next to each other"
 * problem this whole module exists to fix, just for a different case.
 * Every orphan also produces one aggregated entry in `warnings` (not one
 * warning per item, to avoid flooding the caller for a large batch).
 */
export function groupItemsByOrder<T>(items: GroupedNestingItem<T>[]): { groups: OrderGroup<T>[]; warnings: string[] } {
  const warnings: string[] = [];
  const groupsByKey = new Map<string, OrderGroup<T>>();
  let missingOrderIdCount = 0;

  for (const item of items) {
    if (item.orderId === null || item.orderId === undefined) {
      missingOrderIdCount++;
      const key = `missing-order-id:${String(item.id)}`;
      groupsByKey.set(key, { orderId: null, items: [item] });
      continue;
    }

    const key = `order:${item.orderId}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groupsByKey.set(key, { orderId: item.orderId, items: [item] });
    }
  }

  if (missingOrderIdCount > 0) {
    warnings.push(
      `${missingOrderIdCount} item tanpa orderId ditemukan — masing-masing diperlakukan sebagai grup individual terpisah, TIDAK digabung satu sama lain maupun ke order manapun.`
    );
  }

  return { groups: [...groupsByKey.values()], warnings };
}

/**
 * Inner pack for a single order. Phase 2A packed once against an unbounded
 * virtual bin; Phase 2C (grouped-nesting-candidates.ts) instead generates a
 * bounded set of layouts (target width x orientation policy, plus that same
 * Phase 2A layout as a baseline), shrink-wraps each to its TRUE used bounds,
 * prunes duplicates and Pareto-dominated layouts, and selects one —
 * `candidate`. `candidates` is the whole surviving Pareto set, kept for
 * Phase 2D.
 *
 * Rotation stays all-or-nothing per group: if even one item disallows it,
 * only the as-is orientation is tried, never a per-item mix.
 *
 * Deliberately does NOT reserve any receipt-label clearance — Phase 2A's
 * `PART_GAP_MM` is a plain production safety gap only (see grouped-
 * nesting-config.ts's own doc comment for why it's a different constant
 * from legacy's label-aware `ITEM_PADDING_BOTTOM_MM`), and no label is
 * rendered or reserved for at all at this layer.
 */
export function packOrderGroup<T>(
  group: OrderGroup<T>,
  config: GroupedNestingConfig
): {
  candidate: OrderLayoutCandidate<T> | null;
  candidates: OrderLayoutCandidate<T>[];
  attemptCount: number;
  unfit: GroupedNestingItem<T>[];
} {
  if (group.items.length === 0) {
    return { candidate: null, candidates: [], attemptCount: 0, unfit: [] };
  }

  const { selected, candidates, attemptCount } = generateOrderCandidates(group, config);

  // Every attempt's bin is sized to always hold every item, so this only
  // triggers if the packer itself misbehaves — reported, never hidden.
  if (!selected) {
    return { candidate: null, candidates: [], attemptCount, unfit: group.items };
  }

  return { candidate: selected, candidates, attemptCount, unfit: [] };
}

/**
 * Outer pack: treats every order's candidate as ONE rectangle and packs
 * those rectangles onto the real production sheet — reuses legacy
 * `packMaxRects` again, this time against the sheet shrunk by
 * `2 * config.sheetMarginMm` (so the sheet's own physical border can be
 * tuned independently of `config.orderGapMm`, the gap the SAME
 * `packMaxRects` call reserves between neighboring group rectangles), then
 * shifts every result back out by `sheetMarginMm` to restore real sheet
 * coordinates. `packMaxRects`'s own multi-sheet behavior (spilling extra
 * candidates onto `sheetIndex` 1, 2, ...) comes along for free and is
 * exposed as-is on `GroupPlacement.sheetIndex`.
 *
 * Group rotation is deliberately OFF (whole-group blocks are never rotated
 * 90° in Phase 2A) — rotating a multi-item group's bounding box would also
 * require re-deriving every child item's relative placement, which is
 * explicitly out of this phase's scope (see this module's top doc comment).
 *
 * Any candidate `packMaxRects` couldn't fit on any sheet (bigger than the
 * usable area in either orientation) is silently dropped BY packMaxRects
 * itself (its own documented behavior) — this function detects that by
 * diffing input candidates against what came back, and surfaces every
 * dropped one as `unfitCandidates` instead of letting it vanish untraced.
 */
export function packGroupsOntoSheet<T>(
  candidates: OrderLayoutCandidate<T>[],
  config: GroupedNestingConfig,
  contextByCandidateId: Map<string, { alternatives: OrderLayoutCandidate<T>[]; local: OrderLayoutCandidate<T> }> = new Map(),
  strategy: OuterPackingStrategy = LEGACY_OUTER_STRATEGY
): { groups: GroupPlacement<T>[]; unfitCandidates: OrderLayoutCandidate<T>[] } {
  if (candidates.length === 0) {
    return { groups: [], unfitCandidates: [] };
  }

  const usableWidth = config.sheetWidth - 2 * config.sheetMarginMm;
  const usableHeight = config.sheetHeight - 2 * config.sheetMarginMm;

  const rects: NestableRect<OrderLayoutCandidate<T>>[] = candidates.map((candidate) => ({
    width: candidate.width,
    height: candidate.height,
    data: candidate,
  }));

  // Legacy strategy -> the untouched legacy packer, byte-for-byte the Phase
  // 2A-2D behavior. Any other Phase 2E strategy -> the V2 packer, which has
  // identical placement semantics (no rotation, so `rotated` is always false).
  const packed =
    strategy.id === LEGACY_OUTER_STRATEGY.id
      ? packMaxRects(rects, usableWidth, usableHeight, config.orderGapMm, config.orderGapMm, false)
      : packOuterRects(rects, usableWidth, usableHeight, config.orderGapMm, strategy).map((p) => ({ ...p, rotated: false }));

  const placedCandidateIds = new Set(packed.map((p) => p.data.candidateId));
  const unfitCandidates = candidates.filter((c) => !placedCandidateIds.has(c.candidateId));

  const groups: GroupPlacement<T>[] = packed.map((p) => {
    const groupX = p.x + config.sheetMarginMm;
    const groupY = p.y + config.sheetMarginMm;
    const candidate = p.data;

    const items: GroupedPackedRect<T>[] = candidate.placements.map((placement) => ({
      x: groupX + placement.x,
      y: groupY + placement.y,
      width: placement.width,
      height: placement.height,
      rotated: placement.rotated,
      sheetIndex: p.sheetIndex,
      data: placement.item.data,
      orderId: candidate.orderId,
      groupX,
      groupY,
      groupWidth: candidate.width,
      groupHeight: candidate.height,
    }));

    return {
      orderId: candidate.orderId,
      x: groupX,
      y: groupY,
      width: candidate.width,
      height: candidate.height,
      rotated: p.rotated,
      sheetIndex: p.sheetIndex,
      candidate,
      alternatives: contextByCandidateId.get(candidate.candidateId)?.alternatives ?? [candidate],
      localCandidate: contextByCandidateId.get(candidate.candidateId)?.local ?? candidate,
      items,
    };
  });

  return { groups, unfitCandidates };
}

/**
 * Top-level entry point: group -> inner pack -> outer pack -> flatten +
 * metrics. Pure function, no I/O, no persistence — see this module's own
 * top doc comment for Phase 2A's deliberately narrow scope.
 */
export function runGroupedNesting<T>(
  items: GroupedNestingItem<T>[],
  overrides: GroupedNestingConfigOverrides = {},
  searchLimits: GlobalSearchLimits = DEFAULT_GLOBAL_SEARCH_LIMITS,
  outerLimits: OuterPackingLimits = DEFAULT_OUTER_PACKING_LIMITS
): GroupedNestingResult<T> {
  const config = resolveConfig(overrides);

  const { groups: orderGroups, warnings } = groupItemsByOrder(items);

  const orderInputs: { local: OrderLayoutCandidate<T>; alternatives: OrderLayoutCandidate<T>[] }[] = [];
  const contextByCandidateId = new Map<string, { alternatives: OrderLayoutCandidate<T>[]; local: OrderLayoutCandidate<T> }>();
  const unfit: GroupedNestingItem<T>[] = [];

  for (const group of orderGroups) {
    const { candidate, candidates: alternatives, unfit: groupUnfit } = packOrderGroup(group, config);
    if (candidate) {
      const context = { local: candidate, alternatives };
      orderInputs.push(context);
      for (const alternative of alternatives) contextByCandidateId.set(alternative.candidateId, context);
      contextByCandidateId.set(candidate.candidateId, context);
    }
    unfit.push(...groupUnfit);
  }

  // PHASE 2D/2E: pick one candidate per order AND the outer packing
  // strategy by global outer-layout score — never worse than Phase 2D, which
  // is never worse than the Phase 2C local picks (see grouped-nesting-
  // outer.ts). `selected` keeps orderInputs' order, so packGroupsOntoSheet
  // below packs exactly the layout that was scored.
  const { selected: candidates, strategy, stats: optimizer } = optimizeOuterLayout(orderInputs, config, searchLimits, outerLimits);

  const { groups, unfitCandidates } = packGroupsOntoSheet(candidates, config, contextByCandidateId, strategy);

  for (const candidate of unfitCandidates) {
    unfit.push(...candidate.placements.map((placement) => placement.item));
    warnings.push(
      `Grup order ${candidate.orderId ?? "(tanpa orderId)"} berukuran ${candidate.width.toFixed(1)}x${candidate.height.toFixed(1)}mm tidak muat di media manapun (${config.sheetWidth}x${config.sheetHeight}mm) — dilewati, bukan dipaksakan.`
    );
  }

  const flatItems = groups.flatMap((g) => g.items);

  const usedWidth = flatItems.length > 0 ? Math.max(...flatItems.map((item) => item.x + item.width)) : 0;
  const usedHeight = flatItems.length > 0 ? Math.max(...flatItems.map((item) => item.y + item.height)) : 0;
  const usedArea = usedWidth * usedHeight;
  const totalItemArea = groups.reduce((sum, g) => sum + g.candidate.metrics.itemArea, 0);

  const metrics: GroupedNestingMetrics = {
    totalItems: items.length,
    totalOrders: orderGroups.length,
    usedWidth,
    usedHeight,
    usedArea,
    totalItemArea,
    packingUtilizationPercent: usedArea > 0 ? (totalItemArea / usedArea) * 100 : 0,
    wastePercent: usedArea > 0 ? 100 - (totalItemArea / usedArea) * 100 : 0,
  };

  assertGroupOrderIntegrity(groups);

  return { groups, items: flatItems, metrics, warnings, unfit, optimizer };
}

/**
 * PHASE 2B boundary semantics guarantee: "one box = one resi/order" — every
 * item inside a `GroupPlacement` must report that SAME group's own
 * `orderId`, never another one's. This is already true by construction
 * (`packGroupsOntoSheet` only ever builds a group's `items` from that same
 * group's own `candidate.placements`, which in turn only ever came from
 * that same order's own `packOrderGroup` call — there is no code path that
 * could cross-assign), so this is a cheap, always-on regression guard, not
 * a workaround for a known gap: if this ever throws, something upstream
 * broke the one invariant this whole module exists to enforce, and that
 * should fail loudly (a thrown error -> Next.js turns it into a 500) rather
 * than silently ship a sheet with mixed-order groups.
 */
export function assertGroupOrderIntegrity<T>(groups: GroupPlacement<T>[]): void {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.orderId !== group.orderId) {
        throw new Error(
          `Grouped Nesting integrity violation: item with orderId ${item.orderId} found inside group for orderId ${group.orderId}. This must never happen — every item in a group must belong to that exact order.`
        );
      }
    }
  }
}
