/**
 * V3A-2 — foreign slot relocation (experimental, opt-in). `npm test`.
 *
 * Hand-made layouts on the production media (310 x 470, margin 5, ORDER_GAP
 * 8, PART_GAP 2): groups start at 13 mm and a group may reach x + w = 289,
 * y + h = 449.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting } from "./grouped-nesting";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_HEIGHT_MM, SHEET_MARGIN_MM, SHEET_WIDTH_MM } from "./grouped-nesting-config";
import {
  applySlotReflow,
  classifyRelocation,
  placeGroup,
  resultFromGroups,
  runGroupedNestingV3,
  validateLayout,
  DEFAULT_SLOT_REFLOW_LIMITS,
  ORIGIN_TOLERANCE_MM,
} from "./grouped-nesting-v3";
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
const EDGE = SHEET_MARGIN_MM + ORDER_GAP_MM; // 13 mm

function makeItems(firstId: number, orderId: number, count: number, width: number, height: number): GroupedNestingItem<Payload>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: firstId + i,
    orderId,
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    allowRotation: false,
    data: { name: `${orderId}-${firstId + i}` },
  }));
}

/** Hand-made grid candidate (`cols` per row, PART_GAP between items) standing in for the order's V2 shape. */
function gridCandidate(items: GroupedNestingItem<Payload>[], cols: number): OrderLayoutCandidate<Payload> {
  const { width: w, height: h } = items[0];
  const used = Math.min(cols, items.length);
  const rows = Math.ceil(items.length / cols);
  const width = used * w + (used - 1) * PART_GAP_MM;
  const height = rows * h + (rows - 1) * PART_GAP_MM;
  const itemArea = items.length * w * h;
  return {
    candidateId: `hand-${items[0].orderId}-c${cols}`,
    orderId: items[0].orderId,
    strategy: `hand grid ${cols}`,
    width,
    height,
    placements: items.map((item, i) => ({
      item,
      x: (i % cols) * (w + PART_GAP_MM),
      y: Math.floor(i / cols) * (h + PART_GAP_MM),
      width: w,
      height: h,
      rotated: false,
    })),
    metrics: { area: width * height, itemArea, utilizationPercent: (itemArea / (width * height)) * 100 },
  };
}

const place = (items: GroupedNestingItem<Payload>[], cols: number, x: number, y: number, sheetIndex: number) => {
  const candidate = gridCandidate(items, cols);
  return placeGroup(candidate, x, y, sheetIndex, { alternatives: [candidate], localCandidate: candidate });
};

function handLayout(items: GroupedNestingItem<Payload>[], groups: GroupPlacement<Payload>[]): GroupedNestingResult<Payload> {
  const base = resultFromGroups(runGroupedNesting(items), groups, config);
  assert.deepEqual(validateLayout(base.groups, config, items.map((i) => i.id)), [], "hand layout must be valid");
  return base;
}

/** Same sheet: order 3 (a long row under order 2) fits, reflowed 2 x 2, in the free area to the RIGHT of order 2. */
function sameSheetForeign() {
  const p = makeItems(0, 1, 1, 276, 200);
  const q = makeItems(1, 2, 1, 120, 100);
  const r = makeItems(2, 3, 4, 55, 40);
  const items = [...p, ...q, ...r];
  return { items, base: handLayout(items, [place(p, 1, EDGE, EDGE, 0), place(q, 1, EDGE, 221, 0), place(r, 4, EDGE, 329, 0)]) };
}

/** Two sheets: order 3 sets Sheet 2's height under order 2; reflowed into a column it fits beside order 1 on Sheet 1. */
function crossSheet() {
  const p = makeItems(0, 1, 1, 150, 250);
  const q = makeItems(1, 2, 1, 276, 200);
  const r = makeItems(2, 3, 4, 80, 60);
  const items = [...p, ...q, ...r];
  return { items, base: handLayout(items, [place(p, 1, EDGE, EDGE, 0), place(q, 1, EDGE, EDGE, 1), place(r, 2, EDGE, 221, 1)]) };
}

/** Order 3 alone on Sheet 2 (a column) fits beside order 1 on Sheet 1 -> Sheet 2 disappears. */
function sheetElimination() {
  const p = makeItems(0, 1, 1, 150, 250);
  const r = makeItems(1, 3, 4, 80, 60);
  const items = [...p, ...r];
  return { items, base: handLayout(items, [place(p, 1, EDGE, EDGE, 0), place(r, 1, EDGE, EDGE, 1)]) };
}

/**
 * Two valid foreign moves on different sheets: order 20 (Sheet 2, ranked
 * first) saves 38 mm, order 10 (Sheet 1) saves 130 mm. The pass must apply
 * the 130 mm one first.
 */
function twoMoves() {
  const b0 = makeItems(0, 1, 1, 150, 250);
  const y = makeItems(1, 10, 4, 80, 60);
  const a1 = makeItems(5, 2, 1, 200, 100);
  const x = makeItems(6, 20, 2, 60, 30);
  const items = [...b0, ...y, ...a1, ...x];
  return {
    items,
    base: handLayout(items, [place(b0, 1, EDGE, EDGE, 0), place(y, 2, EDGE, 271, 0), place(a1, 1, EDGE, EDGE, 1), place(x, 2, EDGE, 121, 1)]),
  };
}

/**
 * Order 30 (250 x 180, Sheet 2) fits no free area of Sheet 1 at first. Pass 1
 * moves order 10 (a row under order 1) beside order 1; the area it leaves
 * is what lets order 30 come over in pass 2 and empty Sheet 2.
 */
function chained() {
  const p = makeItems(0, 1, 1, 130, 200);
  const y = makeItems(1, 10, 4, 60, 60);
  const z = makeItems(5, 30, 1, 250, 180);
  const items = [...p, ...y, ...z];
  return { items, base: handLayout(items, [place(p, 1, EDGE, EDGE, 0), place(y, 4, EDGE, 221, 0), place(z, 1, EDGE, EDGE, 1)]) };
}

function assertIntegrity(result: GroupedNestingResult<Payload>, items: GroupedNestingItem<Payload>[]) {
  assert.deepEqual(validateLayout(result.groups, config, items.map((i) => i.id)), []);
  const outIds = result.groups.flatMap((g) => g.candidate.placements.map((p) => p.item.id)).map(Number).sort((a, b) => a - b);
  assert.deepEqual(outIds, items.map((i) => Number(i.id)).sort((a, b) => a - b), "no missing / duplicate item");
  const orders = result.groups.map((g) => g.orderId);
  assert.equal(new Set(orders).size, orders.length, "one group per order");
  for (const g of result.groups) {
    for (const item of g.items) {
      assert.equal(item.orderId, g.orderId, "no cross-receipt item");
      assert.equal(item.sheetIndex, g.sheetIndex, "order not split across sheets");
    }
  }
}

describe("V3A-2 TEST A — true foreign relocation", () => {
  test("an order is reflowed and moved to a different free area on the same sheet", () => {
    const { items, base } = sameSheetForeign();
    const { result, diagnostics } = applySlotReflow(base, config);
    const move = diagnostics.moves[0];
    assert.equal(diagnostics.applied, true);
    assert.equal(move.orderId, 3);
    assert.equal(move.type, "FOREIGN_RELOCATION");
    assert.equal(move.source, "SLOT_REFLOW");
    assert.equal(move.toSheetIndex, move.fromSheetIndex);
    assert.ok(Math.abs(move.toX - move.fromX) >= ORIGIN_TOLERANCE_MM || Math.abs(move.toY - move.fromY) >= ORIGIN_TOLERANCE_MM);
    assert.ok(move.toX >= EDGE + 120 + ORDER_GAP_MM - 1e-6, "lands to the right of order 2");
    assert.ok(result.summary.sumUsedHeight < base.summary.sumUsedHeight);
    assert.ok(diagnostics.acceptedForeignRelocation >= 1);
    assertIntegrity(result, items);
  });
});

describe("V3A-2 TEST B — cross-sheet foreign move", () => {
  test("an order from Sheet 2 is placed in a slot of Sheet 1", () => {
    const { items, base } = crossSheet();
    const { result, diagnostics } = applySlotReflow(base, config);
    const move = diagnostics.moves[0];
    assert.equal(move.orderId, 3);
    assert.equal(move.type, "FOREIGN_RELOCATION");
    assert.equal(move.fromSheetIndex, 1);
    assert.equal(move.toSheetIndex, 0);
    assert.equal(result.groups.find((g) => g.orderId === 3)!.sheetIndex, 0);
    assert.equal(result.summary.sheetCount, 2);
    assert.ok(result.summary.sumUsedHeight < base.summary.sumUsedHeight - 100);
    assertIntegrity(result, items);
  });
});

describe("V3A-2 TEST C — sheet elimination", () => {
  test("the last order of Sheet 2 moves to Sheet 1 and Sheet 2 is removed", () => {
    const { items, base } = sheetElimination();
    assert.equal(base.summary.sheetCount, 2);
    const { result, diagnostics } = applySlotReflow(base, config);
    assert.equal(result.summary.sheetCount, 1);
    assert.deepEqual(result.sheets.map((s) => s.sheetIndex), [0]);
    assert.ok(result.items.every((item) => item.sheetIndex === 0));
    assert.equal(diagnostics.moves[0].type, "FOREIGN_RELOCATION");
    assert.equal(diagnostics.moves[0].improvement, "SHEETS");
    assert.equal(diagnostics.moves[0].sheetRemoved, true);
    assert.equal(diagnostics.sheetsAvoided, 1);
    assertIntegrity(result, items);
  });
});

describe("V3A-2 TEST D — self vs foreign classification", () => {
  test("same origin (within tolerance) = SELF_REFLOW; other origin or other sheet = FOREIGN_RELOCATION", () => {
    const old = { sheetIndex: 0, x: 100, y: 50 };
    assert.equal(classifyRelocation(old, { sheetIndex: 0, x: 100, y: 50 }), "SELF_REFLOW");
    assert.equal(classifyRelocation(old, { sheetIndex: 0, x: 100.4, y: 49.7 }), "SELF_REFLOW");
    assert.equal(classifyRelocation(old, { sheetIndex: 0, x: 100 + ORIGIN_TOLERANCE_MM, y: 50 }), "FOREIGN_RELOCATION");
    assert.equal(classifyRelocation(old, { sheetIndex: 0, x: 180, y: 50 }), "FOREIGN_RELOCATION");
    assert.equal(classifyRelocation(old, { sheetIndex: 1, x: 100, y: 50 }), "FOREIGN_RELOCATION");
  });

  test("a reflow at the same origin with a new footprint is reported as SELF_REFLOW", () => {
    // Two 100 x 50 items stacked; side by side (202 x 50) is lower, and the only free area starts at its own origin.
    const a = makeItems(0, 1, 2, 100, 50);
    const base = handLayout(a, [place(a, 1, EDGE, EDGE, 0)]);
    const { diagnostics } = applySlotReflow(base, config);
    const move = diagnostics.moves[0];
    assert.equal(move.type, "SELF_REFLOW");
    assert.deepEqual([move.toX, move.toY], [move.fromX, move.fromY]);
    assert.notDeepEqual([move.newWidth, move.newHeight], [move.fromWidth, move.fromHeight]);
  });
});

describe("V3A-2 TEST E — best move per pass", () => {
  test("the larger saving is applied first even though the smaller one is evaluated first", () => {
    const { items, base } = twoMoves();
    const { result, diagnostics } = applySlotReflow(base, config);
    const [first, second] = diagnostics.moves;
    assert.equal(first.orderId, 10, "130 mm move (order 10) wins pass 1");
    assert.ok(first.heightSavedMm > 100);
    assert.equal(second.orderId, 20, "the 38 mm move follows in pass 2");
    assert.ok(second.heightSavedMm > 30 && second.heightSavedMm < first.heightSavedMm);
    assert.ok(diagnostics.moves.every((m) => m.type === "FOREIGN_RELOCATION"));
    assertIntegrity(result, items);
  });
});

describe("V3A-2 TEST F — second pass uses a slot opened by the first", () => {
  test("free space is rebuilt after move 1, and move 2 lands in the area move 1 vacated", () => {
    const { items, base } = chained();
    const { result, diagnostics } = applySlotReflow(base, config);
    const [first, second] = diagnostics.moves;
    assert.equal(first.orderId, 10);
    assert.equal(first.type, "FOREIGN_RELOCATION");
    assert.equal(second.orderId, 30);
    assert.equal(second.type, "FOREIGN_RELOCATION");
    assert.equal(second.sheetRemoved, true);
    const vacated = { x: first.fromX, y: first.fromY, width: first.fromWidth, height: first.fromHeight };
    const landed = { x: second.toX, y: second.toY, width: second.newWidth, height: second.newHeight };
    const overlap =
      landed.x < vacated.x + vacated.width && landed.x + landed.width > vacated.x && landed.y < vacated.y + vacated.height && landed.y + landed.height > vacated.y;
    assert.ok(overlap, "order 30 uses order 10's old area");
    assert.equal(result.summary.sheetCount, 1);
    assertIntegrity(result, items);
  });
});

describe("V3A-2 TEST G — no foreign benefit", () => {
  test("only a SELF_REFLOW helps: it is used, no foreign move is accepted", () => {
    const a = makeItems(0, 1, 2, 100, 50);
    const base = handLayout(a, [place(a, 1, EDGE, EDGE, 0)]);
    const { diagnostics } = applySlotReflow(base, config);
    assert.equal(diagnostics.acceptedForeignRelocation, 0);
    assert.ok(diagnostics.acceptedSelfReflow >= 1);
  });

  test("nothing helps: the result is the V2 baseline object itself", () => {
    const a = makeItems(0, 1, 2, 150, 50); // cannot sit side by side (302 > 276)
    const base = handLayout(a, [place(a, 1, EDGE, EDGE, 0)]);
    const { result, diagnostics } = applySlotReflow(base, config);
    assert.equal(diagnostics.applied, false);
    assert.equal(result, base);
  });
});

describe("V3A-2 TEST H/I — integrity, gaps and bounds", () => {
  test("every scenario result is valid", () => {
    for (const scenario of [sameSheetForeign, crossSheet, sheetElimination, twoMoves, chained]) {
      const { items, base } = scenario();
      assertIntegrity(applySlotReflow(base, config).result, items);
    }
  });
});

describe("V3A-2 TEST J — determinism", () => {
  test("same input and config -> same moves and layout", () => {
    const strip = (r: ReturnType<typeof applySlotReflow<Payload>>) => ({
      groups: r.result.groups.map((g) => [g.orderId, g.sheetIndex, g.x, g.y, g.width, g.height]),
      diagnostics: { ...r.diagnostics, runtimeMs: null },
    });
    for (const scenario of [twoMoves, chained]) {
      assert.deepEqual(strip(applySlotReflow(scenario().base, config)), strip(applySlotReflow(scenario().base, config)));
    }
  });
});

describe("V3A-2 TEST K — budget", () => {
  test("per-order slot caps and the total cap hold", () => {
    const { base } = twoMoves();
    const limits = { ...DEFAULT_SLOT_REFLOW_LIMITS, maxForeignSlotsPerOrder: 1, maxSelfSlotsPerOrder: 0, maxTotalEvaluations: 30 };
    const { diagnostics } = applySlotReflow(base, config, limits);
    assert.ok(diagnostics.budgetUsed <= 30);
    assert.equal(diagnostics.selfSlotsTried, 0);
    assert.ok(diagnostics.foreignSlotsTried <= diagnostics.ordersTried);
    assert.equal(diagnostics.slotsTried, diagnostics.foreignSlotsTried + diagnostics.selfSlotsTried);
  });

  test("maxPasses caps accepted moves", () => {
    const { base } = twoMoves();
    const { diagnostics } = applySlotReflow(base, config, { ...DEFAULT_SLOT_REFLOW_LIMITS, maxPasses: 1 });
    assert.equal(diagnostics.acceptedRelocations, 1);
    assert.equal(diagnostics.moves[0].orderId, 10);
  });

  test("without the slotReflow flag nothing changes: V3 run's V2 equals plain runGroupedNesting", () => {
    const { items } = twoMoves();
    assert.deepEqual(runGroupedNestingV3(items).v2, runGroupedNesting(items));
  });
});
