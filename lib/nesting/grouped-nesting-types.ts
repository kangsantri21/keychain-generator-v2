/**
 * Grouped Nesting V2 (Phase 2A) — internal data types.
 *
 * Deliberately reuses `NestableRect`/`PackedRect` from the LEGACY engine
 * (../nesting.ts) via TS interface extension wherever the shape already
 * fits, instead of redeclaring structurally-identical fields — per the
 * audit's finding that the legacy engine's public surface must not change,
 * and per the instruction not to duplicate types that can be reused safely.
 * This file imports ONLY types from ../nesting.ts (erased at compile time),
 * never its implementation — so nothing here can affect legacy behavior.
 */
import type { NestableRect, PackedRect } from "@/lib/nesting";
import type { Pt } from "./shape-outline";
import type { OuterOptimizerStats } from "./grouped-nesting-outer";

/**
 * One nestable unit going into Grouped Nesting — the "Order" (resi) it
 * belongs to is now a first-class field, not just opaque `data` payload the
 * packer ignores (which is the legacy engine's own limitation this module
 * exists to fix). `width`/`height` are what the packing primitive actually
 * uses (currently always equal to `originalWidth`/`originalHeight` in Phase
 * 2A — no pre-pack inflation, learned from the legacy padding rework: gaps
 * belong in the packing call's own padding parameters, not baked into the
 * item's own dimensions, since that breaks under rotation - see keychain-
 * geometry.ts's ITEM_PADDING_RIGHT_MM/BOTTOM_MM doc comment for the full
 * story). `originalWidth`/`originalHeight` stay the immutable source of
 * truth for reconstructing the real artwork size regardless of what future
 * phases do with `width`/`height`.
 */
export interface GroupedNestingItem<T> extends NestableRect<T> {
  id: string | number;
  /** Which resi/order this item belongs to. `null` = missing/unknown — see `groupItemsByOrder`'s own doc comment for why that is never silently merged with anything else. */
  orderId: number | null;
  originalWidth: number;
  originalHeight: number;
  allowRotation: boolean;
  /**
   * Cut outline in unrotated artwork millimetres. When any item in a
   * production run carries one, the shape-block packer is used instead of
   * the box packer. Missing on every older fixture, which keeps the box path.
   */
  outline?: Pt[][];
  /** Printed once beside the receipt frame. Shape-block packing only. */
  receiptCode?: string;
}

/** All items sharing one `orderId` (or one orphaned item with a missing orderId — see `groupItemsByOrder`). */
export interface OrderGroup<T> {
  orderId: number | null;
  items: GroupedNestingItem<T>[];
}

/** One item's placement RELATIVE to its own candidate's (0,0) origin — not yet positioned on the sheet. */
export interface GroupItemPlacement<T> {
  item: GroupedNestingItem<T>;
  x: number;
  y: number;
  /** On-candidate footprint width — already swapped with height if `rotated` (matches PackedRect's own convention). */
  width: number;
  height: number;
  rotated: boolean;
}

/**
 * One deterministic, compact inner-packing result for a single OrderGroup —
 * "candidate" because Phase 2A only ever produces exactly one (no
 * multi-candidate optimization yet, per the phase's own explicit scope),
 * but the type leaves room for that without a breaking change later.
 */
export interface OrderLayoutCandidate<T> {
  candidateId: string;
  orderId: number | null;
  /** Which Phase 2C attempt produced this layout (e.g. "unbounded", "landscape w1.25") — dev diagnostics only. */
  strategy: string;
  /** V3A — "SLOT_REFLOW" when the layout was packed to fit a free slot (slot-reflow.ts); absent = a normal V2 candidate. */
  source?: "NORMAL" | "SLOT_REFLOW";
  /** Tight bounding box of this candidate's own packed items (already normalized to a (0,0) origin) — NOT the sheet size. */
  width: number;
  height: number;
  /** Relative to this candidate's own (0,0) origin — see `GroupPlacement.items` for the absolute (on-sheet) version. */
  placements: GroupItemPlacement<T>[];
  metrics: {
    area: number;
    itemArea: number;
    utilizationPercent: number;
  };
}

/** One OrderGroup's candidate, now positioned on the actual production sheet. */
export interface GroupPlacement<T> {
  orderId: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  sheetIndex: number;
  candidate: OrderLayoutCandidate<T>;
  /** Every Pareto-surviving inner layout for this order (includes `candidate`) — kept so Phase 2D can choose by inter-order fit. */
  alternatives: OrderLayoutCandidate<T>[];
  /** Phase 2C's independent local pick for this order — `candidate` differs from it when Phase 2D chose another shape for a better global layout. */
  localCandidate: OrderLayoutCandidate<T>;
  /** Absolute (on-sheet) placements — `candidate.placements` shifted by (x, y) (and re-oriented if the whole group itself was rotated as a block). */
  items: GroupedPackedRect<T>[];
}

/**
 * One item's final ON-SHEET placement — structurally a superset of the
 * legacy `PackedRect<T>` (same x/y/width/height/rotated/sheetIndex/data
 * fields, same meaning) so any caller that only knows about `PackedRect`
 * can consume this as-is; the extra `orderId`/`group*` fields are additive,
 * never a replacement for existing ones.
 */
export interface GroupedPackedRect<T> extends PackedRect<T> {
  orderId: number | null;
  groupX: number;
  groupY: number;
  groupWidth: number;
  groupHeight: number;
}

export interface GroupedNestingMetrics {
  totalItems: number;
  totalOrders: number;
  /**
   * Tight bounding box actually consumed by placed content, from the sheet's
   * own (0,0) corner — NOT the full configured sheet size. One sheet: that
   * sheet's box. Several sheets (PHASE 2G): `usedWidth` = widest sheet,
   * `usedHeight` = SUM of per-sheet used heights, `usedArea` = sum of
   * per-sheet boxes — see `GroupedNestingResult.sheets`/`summary` for the
   * per-sheet breakdown. (Before 2G these were a max over every item
   * regardless of sheet, which could report >100% utilization.)
   */
  usedWidth: number;
  usedHeight: number;
  usedArea: number;
  /** Sum of `originalWidth * originalHeight` for every SUCCESSFULLY PLACED item (excludes `unfit`). */
  totalItemArea: number;
  /** `totalItemArea / usedArea * 100` — rectangle-based (no true-shape/artwork-silhouette utilization, per this phase's explicit scope). */
  packingUtilizationPercent: number;
  /** `100 - packingUtilizationPercent`. */
  wastePercent: number;
}

/** PHASE 2G — one physical media sheet. Coordinates of its groups/items are local to this sheet. */
export interface PackedSheet<T> {
  sheetIndex: number;
  width: number;
  height: number;
  groups: GroupPlacement<T>[];
  orderCount: number;
  itemCount: number;
  itemArea: number;
  usedWidth: number;
  usedHeight: number;
  /** height - usedHeight: the reusable full-width strip left below the layout. */
  remainingFullWidthHeight: number;
  /** width - usedWidth. */
  sideFragmentWidth: number;
  /** itemArea / (usedWidth * usedHeight) * 100. */
  utilizationPercent: number;
  wastePercent: number;
}

/** PHASE 2G — totals across every sheet (never "the tallest sheet" standing in for the total). */
export interface MultiSheetSummary {
  sheetCount: number;
  totalOrders: number;
  totalItems: number;
  totalUnfitItems: number;
  sumUsedHeight: number;
  /** sum(sheetHeight - sheet.usedHeight). */
  totalRemainingFullWidthHeight: number;
  /** sum(sheetWidth - sheet.usedWidth). */
  totalSideFragmentWidth: number;
  /** sheetCount * sheetWidth * sheetHeight. */
  totalSheetArea: number;
  totalItemArea: number;
  /** totalItemArea / totalSheetArea * 100 — material actually covered by item rectangles. */
  overallMaterialUtilizationPercent: number;
  averageUsedHeight: number;
  maxUsedHeight: number;
  minUsedHeight: number;
}

/** Explicit reason an order group could not be placed (never split across sheets, never dropped silently). */
export interface UnfitGroup {
  orderId: number | null;
  reason: "ORDER_GROUP_TOO_LARGE_FOR_SHEET";
  width: number;
  height: number;
  itemCount: number;
}

export interface GroupedNestingResult<T> {
  /** PHASE 2G — per-sheet view of `groups` (same objects), ordered by sheetIndex. */
  sheets: PackedSheet<T>[];
  summary: MultiSheetSummary;
  unfitGroups: UnfitGroup[];
  groups: GroupPlacement<T>[];
  /** Flattened `groups[].items`, all groups combined — the shape most callers actually want (mirrors legacy `packMaxRects`'s own flat return). */
  items: GroupedPackedRect<T>[];
  metrics: GroupedNestingMetrics;
  /** Non-fatal notices (e.g. items with a missing orderId isolated into their own group) — never silent. */
  warnings: string[];
  /** Items that could not be placed at all (e.g. larger than the sheet in every orientation) — never silently dropped without a trace, unlike legacy `packMaxRects`. */
  unfit: GroupedNestingItem<T>[];
  /** PHASE 2D/2E global candidate-selection + outer-strategy diagnostics. */
  optimizer: OuterOptimizerStats;
}
