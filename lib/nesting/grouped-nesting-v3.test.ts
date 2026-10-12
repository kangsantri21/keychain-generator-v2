/**
 * V3A-1 — local slot-aware reflow / direct relocation (experimental, opt-in).
 * `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting } from "./grouped-nesting";
import { generateOrderCandidates } from "./grouped-nesting-candidates";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_HEIGHT_MM, SHEET_MARGIN_MM, SHEET_WIDTH_MM } from "./grouped-nesting-config";
import {
  applySlotReflow,
  improveWithSlotReflow,
  isSlotReflowRequest,
  placeGroup,
  resultFromGroups,
  runGroupedNestingV3,
  validateLayout,
  DEFAULT_SLOT_REFLOW_LIMITS,
  type SlotReflowLimits,
} from "./grouped-nesting-v3";
import { reflowOrderIntoSlot } from "./slot-reflow";
import type { GroupedNestingItem, GroupedNestingResult, GroupPlacement, OrderLayoutCandidate } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

const config = {
  sheetWidth: SHEET_WIDTH_MM,
  sheetHeight: SHEET_HEIGHT_MM,
  partGapMm: PART_GAP_MM,
  orderGapMm: ORDER_GAP_MM,
  sheetMarginMm: SHEET_MARGIN_MM,
};

function makeItems(firstId: number, orderId: number, count: number, width: number, height: number, allowRotation = false): GroupedNestingItem<Payload>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: firstId + i,
    orderId,
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    allowRotation,
    data: { name: `${orderId}-${firstId + i}` },
  }));
}

/** A hand-made grid candidate (`cols` per row, PART_GAP between items) — stands in for a V2 candidate. */
function gridCandidate(items: GroupedNestingItem<Payload>[], cols: number): OrderLayoutCandidate<Payload> {
  const w = items[0].width;
  const h = items[0].height;
  const placements = items.map((item, i) => ({
    item,
    x: (i % cols) * (w + PART_GAP_MM),
    y: Math.floor(i / cols) * (h + PART_GAP_MM),
    width: w,
    height: h,
    rotated: false,
  }));
  const rows = Math.ceil(items.length / cols);
  const width = Math.min(cols, items.length) * w + (Math.min(cols, items.length) - 1) * PART_GAP_MM;
  const height = rows * h + (rows - 1) * PART_GAP_MM;
  const itemArea = items.reduce((sum, item) => sum + item.width * item.height, 0);
  return {
    candidateId: `hand-${items[0].orderId}-c${cols}`,
    orderId: items[0].orderId,
    strategy: `hand grid ${cols}`,
    width,
    height,
    placements,
    metrics: { area: width * height, itemArea, utilizationPercent: (itemArea / (width * height)) * 100 },
  };
}

const place = (candidate: OrderLayoutCandidate<Payload>, x: number, y: number, sheetIndex: number) =>
  placeGroup(candidate, x, y, sheetIndex, { alternatives: [candidate], localCandidate: candidate });

/** A V2-shaped result whose layout is the given hand-made groups (for scenarios V2 itself would not produce). */
function handResult(items: GroupedNestingItem<Payload>[], groups: GroupPlacement<Payload>[]): GroupedNestingResult<Payload> {
  return resultFromGroups(runGroupedNesting(items), groups, config);
}

const EDGE = SHEET_MARGIN_MM + ORDER_GAP_MM; // 13 mm

/** Deterministic LCG batch (same shape as the Phase 2F/2G tests). */
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

/** Scenario C: sheet 0 full; on sheet 1 order 3 lies as a long row under order 2, but fits as a 2x2 block beside it. */
function scenarioHeight() {
  const a = makeItems(0, 1, 1, 276, 436);
  const b = makeItems(1, 2, 1, 150, 100);
  const c = makeItems(2, 3, 4, 55, 40);
  const items = [...a, ...b, ...c];
  const groups = [
    place(gridCandidate(a, 1), EDGE, EDGE, 0),
    place(gridCandidate(b, 1), EDGE, EDGE, 1),
    place(gridCandidate(c, 4), EDGE, EDGE + 100 + ORDER_GAP_MM, 1),
  ];
  return { items, base: handResult(items, groups) };
}

/** Scenario D: order 3 alone on sheet 1 (a tall column) fits, reflowed 2x2, into the strip under order 1 on sheet 0; sheet 2 must become sheet 1. */
function scenarioSheetRemoval() {
  const a = makeItems(0, 1, 1, 276, 300);
  const c = makeItems(1, 3, 4, 80, 60);
  const e = makeItems(5, 5, 1, 276, 400);
  const items = [...a, ...c, ...e];
  const groups = [place(gridCandidate(a, 1), EDGE, EDGE, 0), place(gridCandidate(c, 1), EDGE, EDGE, 1), place(gridCandidate(e, 1), EDGE, EDGE, 2)];
  return { items, base: handResult(items, groups) };
}

const ids = (items: GroupedNestingItem<Payload>[]) => items.map((item) => item.id);

function assertIntegrity(result: GroupedNestingResult<Payload>, items: GroupedNestingItem<Payload>[]) {
  assert.deepEqual(validateLayout(result.groups, config, ids(items)), []);

  // Item integrity, independently of validateLayout.
  const outIds = result.groups.flatMap((g) => g.candidate.placements.map((p) => p.item.id)).sort((x, y) => Number(x) - Number(y));
  assert.deepEqual(outIds, ids(items).slice().sort((x, y) => Number(x) - Number(y)));
  assert.equal(result.items.length, items.length);

  // Order integrity: every order exactly one group, every item in its own order's group.
  const orderIds = result.groups.map((g) => g.orderId);
  assert.equal(new Set(orderIds).size, orderIds.length);
  for (const g of result.groups) for (const item of g.items) assert.equal(item.orderId, g.orderId);

  // Gap / collision.
  for (const g of result.groups) {
    for (const h of result.groups) {
      if (g === h || g.sheetIndex !== h.sheetIndex) continue;
      const apart =
        g.x + g.width + ORDER_GAP_MM <= h.x + 1e-6 ||
        h.x + h.width + ORDER_GAP_MM <= g.x + 1e-6 ||
        g.y + g.height + ORDER_GAP_MM <= h.y + 1e-6 ||
        h.y + h.height + ORDER_GAP_MM <= g.y + 1e-6;
      assert.ok(apart, `groups ${g.orderId}/${h.orderId} closer than ORDER_GAP`);
    }
    for (let i = 0; i < g.items.length; i++) {
      for (let j = i + 1; j < g.items.length; j++) {
        const p = g.items[i];
        const q = g.items[j];
        const overlap = p.x < q.x + q.width && p.x + p.width > q.x && p.y < q.y + q.height && p.y + p.height > q.y;
        assert.ok(!overlap, `items overlap in order ${g.orderId}`);
      }
    }
  }
}

describe("V3A TEST A — real slot reflow", () => {
  test("no V2 candidate fits the slot, but a reflow places EVERY item inside it", () => {
    const items = makeItems(0, 1, 6, 60, 25);
    const v2 = generateOrderCandidates({ orderId: 1, items }, config).candidates;
    assert.ok(v2.every((c) => c.width > 190 || c.height > 55), "precondition: no normal candidate fits 190 x 55");

    const { candidates, attempts } = reflowOrderIntoSlot(items, 190, 55, PART_GAP_MM, { orderId: 1 });
    assert.ok(attempts > 0);
    assert.ok(candidates.length > 0);
    for (const c of candidates) {
      assert.equal(c.source, "SLOT_REFLOW");
      assert.ok(c.width <= 190 && c.height <= 55);
      assert.deepEqual(c.placements.map((p) => p.item.id).sort(), ids(items).sort());
      for (const p of c.placements) {
        assert.equal(p.rotated, false, "rotation not allowed for these items");
        assert.deepEqual([p.width, p.height], [60, 25], "artwork size unchanged");
      }
      for (let i = 0; i < c.placements.length; i++) {
        for (let j = i + 1; j < c.placements.length; j++) {
          const p = c.placements[i];
          const q = c.placements[j];
          const apart =
            p.x + p.width + PART_GAP_MM <= q.x + 1e-6 ||
            q.x + q.width + PART_GAP_MM <= p.x + 1e-6 ||
            p.y + p.height + PART_GAP_MM <= q.y + 1e-6 ||
            q.y + q.height + PART_GAP_MM <= p.y + 1e-6;
          assert.ok(apart, "PART_GAP kept");
        }
      }
    }
  });

  test("a slot that cannot hold every item returns nothing (never a partial order)", () => {
    const items = makeItems(0, 1, 6, 60, 25);
    assert.deepEqual(reflowOrderIntoSlot(items, 100, 55, PART_GAP_MM).candidates, []);
  });
});

describe("V3A TEST B — self slot no-op", () => {
  test("an order put back into its own freed slot is rejected, and the layout stays exactly V2", () => {
    // Two 150 x 50 items cannot sit side by side (302 > 276 usable), so the only
    // arrangement is the stacked one it already has — its freed slot is its own.
    const a = makeItems(0, 1, 2, 150, 50);
    const items = [...a];
    const base = handResult(items, [place(gridCandidate(a, 1), EDGE, EDGE, 0)]);
    const { result, diagnostics } = applySlotReflow(base, config);
    assert.ok(diagnostics.slotsTried >= 1, "its own freed area is offered as a slot");
    assert.ok(diagnostics.rejectedNoOps >= 1);
    assert.equal(diagnostics.acceptedRelocations, 0);
    assert.equal(diagnostics.applied, false);
    assert.equal(result, base);
  });
});

describe("V3A TEST C — global height improvement", () => {
  test("2 sheets stay 2 sheets, sum used height drops, V3A is chosen", () => {
    const { items, base } = scenarioHeight();
    assert.equal(base.summary.sheetCount, 2);
    const { result, diagnostics } = applySlotReflow(base, config);

    assert.equal(diagnostics.applied, true);
    assert.equal(result.summary.sheetCount, 2);
    assert.ok(result.summary.sumUsedHeight < base.summary.sumUsedHeight);
    assert.equal(diagnostics.heightSavedMm, base.summary.sumUsedHeight - result.summary.sumUsedHeight);
    const move = diagnostics.moves[0];
    assert.equal(move.orderId, 3);
    assert.equal(move.source, "SLOT_REFLOW");
    assert.equal(move.toSheetIndex, 1);
    assert.ok(move.after.sumUsedHeight < move.before.sumUsedHeight);
    // Order 3 now sits beside order 2, not under it.
    const moved = result.groups.find((g) => g.orderId === 3)!;
    assert.ok(moved.x >= EDGE + 150 + ORDER_GAP_MM - 1e-6);
    assertIntegrity(result, items);
  });
});

describe("V3A TEST D — sheet removal", () => {
  test("emptying a sheet removes it and renumbers the later sheets", () => {
    const { items, base } = scenarioSheetRemoval();
    assert.equal(base.summary.sheetCount, 3);
    const { result, diagnostics } = applySlotReflow(base, config);

    assert.equal(diagnostics.applied, true);
    assert.equal(diagnostics.sheetsAvoided, 1);
    assert.equal(result.summary.sheetCount, 2);
    assert.deepEqual(result.sheets.map((s) => s.sheetIndex), [0, 1]);
    assert.equal(result.groups.find((g) => g.orderId === 3)!.sheetIndex, 0);
    assert.equal(result.groups.find((g) => g.orderId === 5)!.sheetIndex, 1, "old sheet 2 renumbered to 1");
    for (const item of result.items) assert.ok(item.sheetIndex === 0 || item.sheetIndex === 1);
    assert.ok(diagnostics.moves.some((m) => m.sheetRemoved));
    assertIntegrity(result, items);
  });
});

describe("V3A TEST E — V2 fallback", () => {
  test("when no relocation is strictly better the result IS the V2 result", () => {
    const items = [...makeItems(0, 1, 1, 250, 200), ...makeItems(1, 2, 1, 250, 200), ...makeItems(2, 3, 1, 250, 200)];
    const run = runGroupedNestingV3(items);
    assert.equal(run.diagnostics.applied, false);
    assert.equal(run.result, run.v2);
    assert.deepEqual(run.result, runGroupedNesting(items));
    assert.deepEqual(run.diagnostics.moves, []);
    assert.equal(run.diagnostics.heightSavedMm, 0);
  });

  test("runGroupedNestingV3's V2 result equals plain runGroupedNesting", () => {
    const items = realisticBatch(12, 7);
    assert.deepEqual(runGroupedNestingV3(items).v2, runGroupedNesting(items));
  });
});

describe("V3A TEST F/G/H — item, order and gap integrity", () => {
  test("scenario layouts", () => {
    for (const { items, base } of [scenarioHeight(), scenarioSheetRemoval()]) {
      assertIntegrity(base, items);
      assertIntegrity(applySlotReflow(base, config).result, items);
    }
  });

  test("realistic batches (with and without accepted moves)", () => {
    for (const [orders, seed] of [[12, 7], [20, 2001], [60, 3]] as const) {
      const items = realisticBatch(orders, seed);
      const run = runGroupedNestingV3(items);
      assert.deepEqual(run.diagnostics.finalViolations, []);
      assertIntegrity(run.result, items);
      assert.ok(run.result.summary.sheetCount <= run.v2.summary.sheetCount);
      assert.ok(run.result.summary.sumUsedHeight <= run.v2.summary.sumUsedHeight + 1e-9);
    }
  });

  test("the validator catches a group closer than ORDER_GAP", () => {
    const a = makeItems(0, 1, 1, 50, 50);
    const b = makeItems(1, 2, 1, 50, 50);
    const groups = [place(gridCandidate(a, 1), EDGE, EDGE, 0), place(gridCandidate(b, 1), EDGE + 50 + ORDER_GAP_MM - 1, EDGE, 0)];
    assert.ok(validateLayout(groups, config).some((v) => v.includes("ORDER_GAP")));
  });
});

describe("V3A TEST I — deterministic", () => {
  test("same input and config -> same layout and same counters", () => {
    const strip = (run: ReturnType<typeof runGroupedNestingV3<Payload>>) => ({
      groups: run.result.groups.map((g) => [g.orderId, g.sheetIndex, g.x, g.y, g.width, g.height, g.candidate.candidateId]),
      diagnostics: { ...run.diagnostics, runtimeMs: null },
    });
    const items = realisticBatch(12, 7);
    const first = runGroupedNestingV3(items);
    assert.ok(first.diagnostics.acceptedRelocations > 0, "precondition: this batch exercises a move");
    assert.deepEqual(strip(runGroupedNestingV3(items)), strip(first));
  });
});

describe("V3A TEST J — budget", () => {
  test("every hard limit is respected and the result stays valid", () => {
    const items = realisticBatch(60, 3);
    const v2 = runGroupedNesting(items);
    const limits: SlotReflowLimits = {
      maxPasses: 2,
      maxOrdersPerPass: 2,
      maxForeignSlotsPerOrder: 1,
      maxSelfSlotsPerOrder: 1,
      maxReflowVariants: 3,
      maxTotalEvaluations: 40,
      acceptFragmentationGain: true,
    };
    const { result, diagnostics } = applySlotReflow(v2, config, limits);
    assert.ok(diagnostics.budgetUsed <= limits.maxTotalEvaluations);
    assert.ok(diagnostics.passes <= limits.maxPasses);
    assert.ok(diagnostics.ordersTried <= limits.maxPasses * limits.maxOrdersPerPass);
    assert.ok(diagnostics.slotsTried <= diagnostics.ordersTried * (limits.maxForeignSlotsPerOrder + limits.maxSelfSlotsPerOrder));
    assert.ok(diagnostics.reflowAttempts <= diagnostics.slotsTried * limits.maxReflowVariants);
    assert.equal(diagnostics.budgetUsed, diagnostics.reflowAttempts + diagnostics.layoutEvaluations);
    assertIntegrity(result, items);
  });

  test("a tiny total budget stops the search and falls back to a valid layout", () => {
    const { items, base } = scenarioHeight();
    const { result, diagnostics } = applySlotReflow(base, config, { ...DEFAULT_SLOT_REFLOW_LIMITS, maxTotalEvaluations: 1 });
    assert.ok(diagnostics.budgetUsed <= 1);
    assert.equal(diagnostics.budgetExhausted, true);
    assertIntegrity(result, items);
  });

  test("the improvement pass alone never accepts more moves than passes", () => {
    const { base } = scenarioHeight();
    const { stats } = improveWithSlotReflow(base.groups, config, { ...DEFAULT_SLOT_REFLOW_LIMITS, maxPasses: 1 });
    assert.ok(stats.acceptedRelocations <= 1);
  });
});

describe("V3A TEST K — opt-in only", () => {
  test("V3A runs only for an explicit slotReflow: true request flag", () => {
    assert.equal(isSlotReflowRequest(null), false);
    assert.equal(isSlotReflowRequest({}), false);
    assert.equal(isSlotReflowRequest({ mode: "grouped-v2" }), false);
    assert.equal(isSlotReflowRequest({ slotReflow: "true" }), false);
    assert.equal(isSlotReflowRequest({ slotReflow: true }), true);
  });

  test("production ORDER_GAP stays 8 mm", () => {
    assert.equal(ORDER_GAP_MM, 8);
    assert.equal(PART_GAP_MM, 2);
    assert.equal(SHEET_MARGIN_MM, 5);
  });
});
