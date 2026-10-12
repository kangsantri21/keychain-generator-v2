/**
 * V3A-2B — DEV-only search funnel of the V3A slot search: for every
 * (order, slot) pair the search saw, exactly ONE outcome explaining why it
 * stopped where it did. Pure bookkeeping — nothing here feeds back into the
 * search's decisions.
 *
 * Outcome classes:
 *   HARD_GEOMETRY  — physically impossible: the slot cannot hold the order.
 *   HARD_OBJECTIVE — physically possible, but provably never accepted: even
 *                    the order's smallest possible footprint in that slot
 *                    does not beat the current score (a lossless bound).
 *   SOFT           — possible and not ruled out, but never tried because of
 *                    ranking caps or the budget.
 *   TRIED          — packed and evaluated; the outcome says how it ended.
 */
import type { GroupedNestingItem } from "./grouped-nesting-types";
import type { RotationRule } from "./slot-reflow";

export type SlotOutcome =
  // HARD_GEOMETRY
  | "SLOT_DEGENERATE"
  | "SLOT_TOO_NARROW_FOR_ITEM"
  | "SLOT_TOO_SHORT_FOR_ITEM"
  | "ORDER_AREA_EXCEEDS_SLOT"
  // HARD_OBJECTIVE
  | "CANNOT_IMPROVE_OBJECTIVE"
  // SOFT
  | "ORDER_RANK_CUTOFF"
  | "ORDER_NOT_REACHED_BUDGET"
  | "PER_ORDER_SLOT_CAP"
  | "SEARCH_BUDGET"
  // TRIED
  | "NO_ARRANGEMENT_FOUND"
  | "ONLY_NO_OP"
  | "BUDGET_INTERRUPTED"
  | "INVALID_PLACEMENT"
  | "NOT_BETTER"
  | "BETTER_NOT_SELECTED"
  | "ACCEPTED";

export type OutcomeClass = "HARD_GEOMETRY" | "HARD_OBJECTIVE" | "SOFT" | "TRIED";

export const OUTCOME_CLASS: Record<SlotOutcome, OutcomeClass> = {
  SLOT_DEGENERATE: "HARD_GEOMETRY",
  SLOT_TOO_NARROW_FOR_ITEM: "HARD_GEOMETRY",
  SLOT_TOO_SHORT_FOR_ITEM: "HARD_GEOMETRY",
  ORDER_AREA_EXCEEDS_SLOT: "HARD_GEOMETRY",
  CANNOT_IMPROVE_OBJECTIVE: "HARD_OBJECTIVE",
  ORDER_RANK_CUTOFF: "SOFT",
  ORDER_NOT_REACHED_BUDGET: "SOFT",
  PER_ORDER_SLOT_CAP: "SOFT",
  SEARCH_BUDGET: "SOFT",
  NO_ARRANGEMENT_FOUND: "TRIED",
  ONLY_NO_OP: "TRIED",
  BUDGET_INTERRUPTED: "TRIED",
  INVALID_PLACEMENT: "TRIED",
  NOT_BETTER: "TRIED",
  BETTER_NOT_SELECTED: "TRIED",
  ACCEPTED: "TRIED",
};

export const SLOT_OUTCOMES = Object.keys(OUTCOME_CLASS) as SlotOutcome[];

const FIT_EPSILON = 1e-6;

/**
 * The reason `slotCanPossiblyHold` (slot-reflow.ts) rejects a slot, checked
 * in the same order with the same arithmetic; null exactly when it accepts.
 */
export function geometryPruneReason<T>(
  items: GroupedNestingItem<T>[],
  slotWidth: number,
  slotHeight: number,
  partGap: number,
  rule: RotationRule
): SlotOutcome | null {
  if (items.length === 0 || slotWidth <= 0 || slotHeight <= 0) return "SLOT_DEGENERATE";
  const canRotate = rule(items);
  for (const item of items) {
    const upright = item.width <= slotWidth + FIT_EPSILON && item.height <= slotHeight + FIT_EPSILON;
    const turned = canRotate(item) && item.height <= slotWidth + FIT_EPSILON && item.width <= slotHeight + FIT_EPSILON;
    if (upright || turned) continue;
    // Too narrow if no allowed orientation is narrow enough; otherwise one is, but too tall.
    const someWidthFits = item.width <= slotWidth + FIT_EPSILON || (canRotate(item) && item.height <= slotWidth + FIT_EPSILON);
    return someWidthFits ? "SLOT_TOO_SHORT_FOR_ITEM" : "SLOT_TOO_NARROW_FOR_ITEM";
  }
  const paddedArea = items.reduce((sum, item) => sum + (item.width + partGap) * (item.height + partGap), 0);
  return paddedArea <= (slotWidth + partGap) * (slotHeight + partGap) + FIT_EPSILON ? null : "ORDER_AREA_EXCEEDS_SLOT";
}

export type SlotRegion = "SELF_REFLOW" | "FOREIGN_RELOCATION";

/** One (order, slot) pair the search saw in one pass. */
export interface SlotRecord {
  pass: number;
  region: SlotRegion;
  orderId: number | null;
  orderKey: string;
  /** The order's group size when the pair was seen. */
  orderWidth: number;
  orderHeight: number;
  sheetIndex: number;
  /** Sheet coordinates; width/height = usable slot size. */
  slot: { x: number; y: number; width: number; height: number };
  outcome: SlotOutcome;
  /** False when this order was cut by ranking or budget in this pass (its pairs were classified for the funnel only). */
  orderSearched: boolean;
  /** Order padded item area / slot padded area. */
  areaRatio: number;
  /**
   * Optimistic bound (order's smallest possible footprint in this slot) minus
   * the current sum used height, mm (negative = could save that much at
   * best). Null when the geometry check already failed.
   */
  boundDeltaMm: number | null;
  shapeFound: boolean;
  validPlacement: boolean;
  strictlyBetter: boolean;
}

/**
 * Stage counts follow the strength of the reason, not just the order of the
 * code: a pair is HARD_GEOMETRY / HARD_OBJECTIVE whenever that holds, even if
 * its order was also cut by ranking or budget — so SOFT counts only pairs
 * that were genuinely possible and not ruled out.
 *   detected -> geometryFeasible -> objectiveFeasible -> orderReached
 *   (minus ORDER_RANK_CUTOFF / ORDER_NOT_REACHED_BUDGET) -> withinCap
 *   (minus PER_ORDER_SLOT_CAP) -> attempted (minus SEARCH_BUDGET)
 *   -> shapeFound / validPlacement / strictlyBetter / accepted.
 */
export interface FunnelCounts {
  detected: number;
  geometryFeasible: number;
  objectiveFeasible: number;
  orderReached: number;
  withinCap: number;
  attempted: number;
  shapeFound: number;
  validPlacement: number;
  strictlyBetter: number;
  accepted: number;
  hardGeometry: number;
  hardObjective: number;
  soft: number;
  tried: number;
  byReason: Record<SlotOutcome, number>;
}

export interface OrderFunnelSide {
  seen: number;
  geometryFeasible: number;
  objectiveFeasible: number;
  withinCap: number;
  tried: number;
  shapeFound: number;
  valid: number;
  better: number;
  accepted: number;
}

export interface OrderFunnel {
  orderId: number | null;
  orderKey: string;
  /** Size in the layout the search started from. */
  currentWidth: number;
  currentHeight: number;
  area: number;
  /** Passes in which this order was searched (its slots enumerated). */
  passesSearched: number;
  foreign: OrderFunnelSide;
  self: OrderFunnelSide;
}

export interface PrunedCandidate {
  pass: number;
  orderId: number | null;
  sheetIndex: number;
  slot: { x: number; y: number; width: number; height: number };
  orderWidth: number;
  orderHeight: number;
  outcome: SlotOutcome;
  outcomeClass: OutcomeClass;
  /** Position in the "most promising" order below (1 = most promising). */
  rank: number;
  areaRatio: number;
  boundDeltaMm: number | null;
}

export interface SlotFunnel {
  passes: number;
  foreign: FunnelCounts;
  self: FunnelCounts;
  orders: OrderFunnel[];
  /** Up to 10 foreign pairs that were never tried, most promising first: SOFT, then HARD_OBJECTIVE by bound, then HARD_GEOMETRY by area ratio. */
  topPrunedForeign: PrunedCandidate[];
}

export const MAX_TOP_PRUNED = 10;

function emptyCounts(): FunnelCounts {
  return {
    detected: 0,
    geometryFeasible: 0,
    objectiveFeasible: 0,
    orderReached: 0,
    withinCap: 0,
    attempted: 0,
    shapeFound: 0,
    validPlacement: 0,
    strictlyBetter: 0,
    accepted: 0,
    hardGeometry: 0,
    hardObjective: 0,
    soft: 0,
    tried: 0,
    byReason: Object.fromEntries(SLOT_OUTCOMES.map((o) => [o, 0])) as Record<SlotOutcome, number>,
  };
}

function emptySide(): OrderFunnelSide {
  return { seen: 0, geometryFeasible: 0, objectiveFeasible: 0, withinCap: 0, tried: 0, shapeFound: 0, valid: 0, better: 0, accepted: 0 };
}

const ORDER_CUTOFF: SlotOutcome[] = ["ORDER_RANK_CUTOFF", "ORDER_NOT_REACHED_BUDGET"];

/** Builds the funnel from every recorded pair. Stage counts follow the search's real order of checks. */
export function summarizeFunnel(
  records: SlotRecord[],
  orders: { orderId: number | null; orderKey: string; width: number; height: number }[],
  passes: number
): SlotFunnel {
  const sides = { FOREIGN_RELOCATION: emptyCounts(), SELF_REFLOW: emptyCounts() };
  const byOrder = new Map(
    orders.map((o) => [
      o.orderKey,
      {
        orderId: o.orderId,
        orderKey: o.orderKey,
        currentWidth: o.width,
        currentHeight: o.height,
        area: o.width * o.height,
        passes: new Set<number>(),
        foreign: emptySide(),
        self: emptySide(),
      },
    ])
  );

  for (const r of records) {
    const c = sides[r.region];
    const cls = OUTCOME_CLASS[r.outcome];
    c.detected++;
    c.byReason[r.outcome]++;
    if (cls === "HARD_GEOMETRY") c.hardGeometry++;
    else if (cls === "HARD_OBJECTIVE") c.hardObjective++;
    else if (cls === "SOFT") c.soft++;
    else c.tried++;

    const geometryOk = cls !== "HARD_GEOMETRY";
    const objectiveOk = geometryOk && cls !== "HARD_OBJECTIVE";
    const reached = objectiveOk && !ORDER_CUTOFF.includes(r.outcome);
    const capOk = reached && r.outcome !== "PER_ORDER_SLOT_CAP";
    const tried = cls === "TRIED";
    if (geometryOk) c.geometryFeasible++;
    if (objectiveOk) c.objectiveFeasible++;
    if (reached) c.orderReached++;
    if (capOk) c.withinCap++;
    if (tried) c.attempted++;
    if (tried && r.shapeFound) c.shapeFound++;
    if (tried && r.validPlacement) c.validPlacement++;
    if (tried && r.strictlyBetter) c.strictlyBetter++;
    if (r.outcome === "ACCEPTED") c.accepted++;

    const order = byOrder.get(r.orderKey);
    if (!order) continue;
    if (r.orderSearched) order.passes.add(r.pass);
    const side = r.region === "FOREIGN_RELOCATION" ? order.foreign : order.self;
    side.seen++;
    if (geometryOk) side.geometryFeasible++;
    if (objectiveOk) side.objectiveFeasible++;
    if (capOk) side.withinCap++;
    if (tried) side.tried++;
    if (tried && r.shapeFound) side.shapeFound++;
    if (tried && r.validPlacement) side.valid++;
    if (tried && r.strictlyBetter) side.better++;
    if (r.outcome === "ACCEPTED") side.accepted++;
  }

  const classOrder: Record<OutcomeClass, number> = { SOFT: 0, HARD_OBJECTIVE: 1, HARD_GEOMETRY: 2, TRIED: 3 };
  const seen = new Set<string>();
  const topPrunedForeign = records
    .filter((r) => r.region === "FOREIGN_RELOCATION" && OUTCOME_CLASS[r.outcome] !== "TRIED")
    .slice()
    .sort(
      (a, b) =>
        classOrder[OUTCOME_CLASS[a.outcome]] - classOrder[OUTCOME_CLASS[b.outcome]] ||
        (a.boundDeltaMm ?? Infinity) - (b.boundDeltaMm ?? Infinity) ||
        a.areaRatio - b.areaRatio ||
        a.pass - b.pass ||
        a.orderKey.localeCompare(b.orderKey) ||
        a.sheetIndex - b.sheetIndex ||
        a.slot.y - b.slot.y ||
        a.slot.x - b.slot.x
    )
    .filter((r) => {
      const key = `${r.orderKey}|${r.sheetIndex}|${r.slot.x.toFixed(2)}|${r.slot.y.toFixed(2)}|${r.slot.width.toFixed(2)}|${r.slot.height.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TOP_PRUNED)
    .map((r, index) => ({
      pass: r.pass,
      orderId: r.orderId,
      sheetIndex: r.sheetIndex,
      slot: r.slot,
      orderWidth: r.orderWidth,
      orderHeight: r.orderHeight,
      outcome: r.outcome,
      outcomeClass: OUTCOME_CLASS[r.outcome],
      rank: index + 1,
      areaRatio: r.areaRatio,
      boundDeltaMm: r.boundDeltaMm,
    }));

  return {
    passes,
    foreign: sides.FOREIGN_RELOCATION,
    self: sides.SELF_REFLOW,
    orders: [...byOrder.values()].map(({ passes: p, ...rest }) => ({ ...rest, passesSearched: p.size })),
    topPrunedForeign,
  };
}
