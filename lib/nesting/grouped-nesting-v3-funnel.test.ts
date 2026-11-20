/**
 * V3A-2B — DEV search funnel of the V3A slot search. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting } from "./grouped-nesting";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM } from "./grouped-nesting-config";
import { applySlotReflow, runGroupedNestingV3, DEFAULT_SLOT_REFLOW_LIMITS, type SlotReflowDiagnostics, type SlotReflowLimits } from "./grouped-nesting-v3";
import { geometryPruneReason, OUTCOME_CLASS, SLOT_OUTCOMES, type FunnelCounts } from "./grouped-nesting-v3-funnel";
import { slotCanPossiblyHold, V2_ROTATION_RULE } from "./slot-reflow";
import type { GroupedNestingItem } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

function realisticBatch(orderCount: number, seed: number): GroupedNestingItem<Payload>[] {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const items: GroupedNestingItem<Payload>[] = [];
  let id = 0;
  for (let order = 1; order <= orderCount; order++) {
    const big = rnd() < 0.4;
    const count = big ? 6 + Math.floor(rnd() * 7) : 1 + Math.floor(rnd() * 2);
    const character = rnd() < 0.25;
    for (let i = 0; i < count; i++) {
      let width: number;
      let height: number;
      if (character) {
        width = 24 + rnd() * 6;
        height = 70 + rnd() * 12;
      } else {
        width = rnd() < 0.45 ? 70 + rnd() * 25 : 30 + rnd() * 15;
        height = 18 + rnd() * 8;
      }
      items.push({ id: id++, orderId: order, width, height, originalWidth: width, originalHeight: height, allowRotation: true, data: { name: `${order}-${i}` } });
    }
  }
  return items;
}

function item(id: number, width: number, height: number, allowRotation = false): GroupedNestingItem<Payload> {
  return { id, orderId: 1, width, height, originalWidth: width, originalHeight: height, allowRotation, data: { name: String(id) } };
}

const config = { sheetWidth: 310, sheetHeight: 470, partGapMm: PART_GAP_MM, orderGapMm: ORDER_GAP_MM, sheetMarginMm: SHEET_MARGIN_MM };
const BATCHES: [number, number][] = [
  [8, 11],
  [12, 7],
  [20, 2001],
  [60, 3],
];

function assertReconciles(c: FunnelCounts) {
  const sumReasons = SLOT_OUTCOMES.reduce((sum, o) => sum + c.byReason[o], 0);
  assert.equal(sumReasons, c.detected, "every pair has exactly one reason");
  assert.equal(c.hardGeometry + c.hardObjective + c.soft + c.tried, c.detected);
  const byClass = (cls: string) => SLOT_OUTCOMES.filter((o) => OUTCOME_CLASS[o] === cls).reduce((sum, o) => sum + c.byReason[o], 0);
  assert.equal(byClass("HARD_GEOMETRY"), c.hardGeometry);
  assert.equal(byClass("HARD_OBJECTIVE"), c.hardObjective);
  assert.equal(byClass("SOFT"), c.soft);
  assert.equal(byClass("TRIED"), c.tried);
  assert.equal(c.geometryFeasible, c.detected - c.hardGeometry);
  assert.equal(c.objectiveFeasible, c.geometryFeasible - c.hardObjective);
  assert.equal(c.orderReached, c.objectiveFeasible - c.byReason.ORDER_RANK_CUTOFF - c.byReason.ORDER_NOT_REACHED_BUDGET);
  assert.equal(c.withinCap, c.orderReached - c.byReason.PER_ORDER_SLOT_CAP);
  assert.equal(c.attempted, c.withinCap - c.byReason.SEARCH_BUDGET);
  assert.equal(c.attempted, c.tried);
  assert.equal(c.shapeFound, c.attempted - c.byReason.NO_ARRANGEMENT_FOUND);
  assert.ok(c.validPlacement <= c.shapeFound);
  assert.ok(c.strictlyBetter <= c.validPlacement);
  assert.equal(c.accepted, c.byReason.ACCEPTED);
}

function assertMatchesSearch(d: SlotReflowDiagnostics) {
  const f = d.funnel!;
  assert.equal(f.foreign.attempted, d.foreignSlotsTried);
  assert.equal(f.self.attempted, d.selfSlotsTried);
  assert.equal(f.foreign.accepted, d.acceptedForeignRelocation);
  assert.equal(f.self.accepted, d.acceptedSelfReflow);
  // When every ranked order was searched, the funnel saw exactly the pairs the search enumerated;
  // otherwise it also classifies the pairs of cut-off orders.
  const detected = f.foreign.detected + f.self.detected;
  if (d.ordersConsidered === d.ordersTried) assert.equal(detected, d.slotsDetected);
  else assert.ok(detected > d.slotsDetected);
}

describe("V3A-2B TEST A — every pruned pair has a reason", () => {
  test("reason totals equal detected pairs, and every top-pruned entry is a non-tried reason", () => {
    for (const [orders, seed] of BATCHES) {
      const d = runGroupedNestingV3(realisticBatch(orders, seed)).diagnostics;
      assert.ok(d.funnel);
      for (const c of [d.funnel.foreign, d.funnel.self]) assertReconciles(c);
      for (const candidate of d.funnel.topPrunedForeign) {
        assert.ok(SLOT_OUTCOMES.includes(candidate.outcome));
        assert.notEqual(candidate.outcomeClass, "TRIED");
      }
      assert.ok(d.funnel.topPrunedForeign.length <= 10);
    }
  });
});

describe("V3A-2B TEST B — funnel counters reconcile", () => {
  test("stage chain and search counters agree (default limits)", () => {
    for (const [orders, seed] of BATCHES) {
      const d = runGroupedNestingV3(realisticBatch(orders, seed)).diagnostics;
      assertMatchesSearch(d);
      assert.equal(d.slotsPruned, d.slotsDetected - d.slotsTried);
    }
  });

  test("still reconciles when caps and budget cut the search", () => {
    const v2 = runGroupedNesting(realisticBatch(60, 3));
    const limits: SlotReflowLimits = { ...DEFAULT_SLOT_REFLOW_LIMITS, maxOrdersPerPass: 3, maxForeignSlotsPerOrder: 1, maxSelfSlotsPerOrder: 0, maxTotalEvaluations: 30 };
    const d = applySlotReflow(v2, config, limits).diagnostics;
    for (const c of [d.funnel!.foreign, d.funnel!.self]) assertReconciles(c);
    assert.equal(d.funnel!.foreign.attempted, d.foreignSlotsTried);
    assert.equal(d.funnel!.self.attempted, 0);
  });
});

describe("V3A-2B TEST C — hard vs soft classification", () => {
  test("outcome classes", () => {
    for (const o of ["SLOT_DEGENERATE", "SLOT_TOO_NARROW_FOR_ITEM", "SLOT_TOO_SHORT_FOR_ITEM", "ORDER_AREA_EXCEEDS_SLOT"] as const) {
      assert.equal(OUTCOME_CLASS[o], "HARD_GEOMETRY");
    }
    assert.equal(OUTCOME_CLASS.CANNOT_IMPROVE_OBJECTIVE, "HARD_OBJECTIVE");
    for (const o of ["ORDER_RANK_CUTOFF", "ORDER_NOT_REACHED_BUDGET", "PER_ORDER_SLOT_CAP", "SEARCH_BUDGET"] as const) assert.equal(OUTCOME_CLASS[o], "SOFT");
  });

  test("geometry reasons are exactly the slotCanPossiblyHold rejections", () => {
    const sets = [[item(0, 60, 25)], [item(0, 60, 25), item(1, 40, 80)], [item(0, 30, 90, true), item(1, 50, 20, true), item(2, 50, 20, true)]];
    for (const items of sets) {
      for (let w = -10; w <= 200; w += 7.5) {
        for (let h = -10; h <= 200; h += 7.5) {
          const reason = geometryPruneReason(items, w, h, PART_GAP_MM, V2_ROTATION_RULE);
          assert.equal(reason === null, slotCanPossiblyHold(items, w, h, PART_GAP_MM, V2_ROTATION_RULE), `${w}x${h}`);
          if (reason) assert.equal(OUTCOME_CLASS[reason], "HARD_GEOMETRY");
        }
      }
    }
    const one = [item(0, 60, 25)];
    assert.equal(geometryPruneReason(one, 0, 50, PART_GAP_MM, V2_ROTATION_RULE), "SLOT_DEGENERATE");
    assert.equal(geometryPruneReason(one, 50, 50, PART_GAP_MM, V2_ROTATION_RULE), "SLOT_TOO_NARROW_FOR_ITEM");
    assert.equal(geometryPruneReason(one, 100, 20, PART_GAP_MM, V2_ROTATION_RULE), "SLOT_TOO_SHORT_FOR_ITEM");
    assert.equal(geometryPruneReason([item(0, 60, 25), item(1, 60, 25)], 61, 30, PART_GAP_MM, V2_ROTATION_RULE), "ORDER_AREA_EXCEEDS_SLOT");
  });

  test("caps and budget produce SOFT reasons, only for pairs that passed geometry and the bound", () => {
    const v2 = runGroupedNesting(realisticBatch(60, 3));
    const capped = applySlotReflow(v2, config, { ...DEFAULT_SLOT_REFLOW_LIMITS, maxOrdersPerPass: 2, maxForeignSlotsPerOrder: 0 }).diagnostics.funnel!;
    const softOf = (f: typeof capped) => f.foreign.soft + f.self.soft;
    assert.ok(softOf(capped) > 0, "ranking cutoff yields SOFT pairs");
    assert.equal(capped.foreign.soft + capped.foreign.hardGeometry + capped.foreign.hardObjective, capped.foreign.detected, "no foreign pair tried");
    assert.equal(capped.foreign.attempted, 0, "maxForeignSlotsPerOrder 0 -> no foreign slot tried");
    const budget = applySlotReflow(v2, config, { ...DEFAULT_SLOT_REFLOW_LIMITS, maxTotalEvaluations: 1 }).diagnostics.funnel!;
    const budgetReasons = (c: typeof budget.foreign) => c.byReason.ORDER_NOT_REACHED_BUDGET + c.byReason.SEARCH_BUDGET + c.byReason.BUDGET_INTERRUPTED;
    assert.ok(budgetReasons(budget.foreign) + budgetReasons(budget.self) > 0, "budget cut is visible");
    for (const funnel of [capped, budget]) {
      for (const c of funnel.topPrunedForeign) if (c.outcomeClass === "SOFT") assert.notEqual(c.boundDeltaMm, null);
    }
  });
});

describe("V3A-2B TEST D/E — tracing never changes the result", () => {
  test("trace on vs off: identical layout, moves and search counters", () => {
    for (const [orders, seed] of BATCHES) {
      const items = realisticBatch(orders, seed);
      const on = runGroupedNestingV3(items, {}, undefined, { trace: true });
      const off = runGroupedNestingV3(items, {}, undefined, { trace: false });
      assert.deepEqual(on.result, off.result);
      assert.deepEqual({ ...on.diagnostics, funnel: null, runtimeMs: null }, { ...off.diagnostics, runtimeMs: null });
      assert.equal(off.diagnostics.funnel, null);
    }
  });
});

describe("V3A-2B TEST F — V2 default unchanged", () => {
  test("the V2 result inside a V3 run equals plain runGroupedNesting", () => {
    const items = realisticBatch(20, 2001);
    assert.deepEqual(runGroupedNestingV3(items).v2, runGroupedNesting(items));
  });
});
