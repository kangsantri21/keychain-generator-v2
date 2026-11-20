/**
 * V3A-3 — bounded two-group compound moves / slot consolidation
 * (experimental, opt-in). `npm test`.
 *
 * Hand-made layouts on the production media (310 x 470, margin 5, ORDER_GAP
 * 8, PART_GAP 2): groups start at 13 mm and may reach x + w = 289, y + h = 449.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting, resolveConfig } from "./grouped-nesting";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM } from "./grouped-nesting-config";
import { applySlotReflow, improveWithSlotReflow, placeGroup, resultFromGroups, runGroupedNestingV3, validateLayout } from "./grouped-nesting-v3";
import { compoundStage, improveWithCompoundMoves, isCompoundRequest, DEFAULT_COMPOUND_LIMITS } from "./grouped-nesting-v3-compound";
import type { GroupedNestingItem, GroupedNestingResult, GroupPlacement, OrderLayoutCandidate } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

const config = resolveConfig({});
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
    placements: items.map((item, i) => ({ item, x: (i % cols) * (w + PART_GAP_MM), y: Math.floor(i / cols) * (h + PART_GAP_MM), width: w, height: h, rotated: false })),
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

/**
 * Sheet 1: order 1 with order 2 (a small 60 x 42 stack) in the column beside
 * it, a full-width block below. Sheet 2: a block and order 5 (122 x 45) at
 * the bottom. Order 5 fits the column only if order 2 leaves it; order 2
 * leaving alone changes nothing. Pair: 2 -> beside 5 on Sheet 2, 5 -> the column.
 */
function pairScenario() {
  const p = makeItems(0, 1, 1, 200, 100);
  const a = makeItems(1, 2, 2, 60, 20);
  const q = makeItems(3, 3, 1, 276, 300);
  const r = makeItems(4, 4, 1, 276, 150);
  const b = makeItems(5, 5, 2, 60, 45);
  const items = [...p, ...a, ...q, ...r, ...b];
  return {
    items,
    base: handLayout(items, [
      place(p, 1, EDGE, EDGE, 0),
      place(a, 1, 221, EDGE, 0),
      place(q, 1, EDGE, 121, 0),
      place(r, 1, EDGE, EDGE, 1),
      place(b, 2, EDGE, 171, 1),
    ]),
  };
}

/**
 * Like pairScenario, but order 2 can only leave the column by making Sheet 1
 * 34 mm taller first (8 x 55x12 stack -> 226 x 26 below the block). Run on
 * the compound stage directly: it is a hand-made S0, not a V3A-2 result.
 */
function regressionScenario() {
  const p = makeItems(0, 1, 1, 200, 120);
  const a = makeItems(1, 2, 8, 55, 12);
  const q = makeItems(9, 3, 1, 276, 40);
  const r = makeItems(10, 4, 1, 276, 300);
  const b = makeItems(11, 5, 2, 60, 55);
  const items = [...p, ...a, ...q, ...r, ...b];
  return {
    items,
    base: handLayout(items, [
      place(p, 1, EDGE, EDGE, 0),
      place(a, 1, 221, EDGE, 0),
      place(q, 1, EDGE, 141, 0),
      place(r, 1, EDGE, EDGE, 1),
      place(b, 2, EDGE, 321, 1),
    ]),
  };
}

/** pairScenario with order 2 as tall as order 5: the only pair ends exactly where it started. */
function equalScenario() {
  const p = makeItems(0, 1, 1, 200, 100);
  const a = makeItems(1, 2, 2, 60, 45);
  const q = makeItems(3, 3, 1, 276, 300);
  const r = makeItems(4, 4, 1, 276, 150);
  const b = makeItems(5, 5, 2, 60, 45);
  const items = [...p, ...a, ...q, ...r, ...b];
  return {
    items,
    base: handLayout(items, [
      place(p, 1, EDGE, EDGE, 0),
      place(a, 1, 221, EDGE, 0),
      place(q, 1, EDGE, 121, 0),
      place(r, 1, EDGE, EDGE, 1),
      place(b, 2, EDGE, 171, 1),
    ]),
  };
}

/**
 * Sheet 1: order 1 and order 2 side by side with a 22 mm strip between them
 * and a 30 mm strip right of order 2 — neither holds order 5 (55 mm wide).
 * Sliding order 2 left merges them into one 60 mm column order 5 fills.
 * `alone` puts order 5 alone on Sheet 2 (sheet elimination).
 */
function consolidationScenario(alone: boolean) {
  const l = makeItems(0, 1, 1, 100, 200);
  const a = makeItems(1, 2, 1, 100, 200);
  const f = makeItems(2, 3, 1, 276, 220);
  const r = makeItems(3, 4, 1, 276, 100);
  const b = makeItems(4, 5, 1, 55, 162);
  const items = alone ? [...l, ...a, ...f, ...b] : [...l, ...a, ...f, ...r, ...b];
  const groups = [place(l, 1, EDGE, EDGE, 0), place(a, 1, 151, EDGE, 0), place(f, 1, EDGE, 221, 0)];
  if (!alone) groups.push(place(r, 1, EDGE, EDGE, 1));
  groups.push(place(b, 1, EDGE, alone ? EDGE : 121, 1));
  return { items, base: handLayout(items, groups) };
}

const stage = (limits = DEFAULT_COMPOUND_LIMITS) => compoundStage<Payload>(config, limits);

function assertIntegrity(result: GroupedNestingResult<Payload>, items: GroupedNestingItem<Payload>[]) {
  assert.deepEqual(validateLayout(result.groups, config, items.map((i) => i.id)), [], "bounds, ORDER_GAP, PART_GAP, sizes, integrity");
  const ids = result.groups.flatMap((g) => g.candidate.placements.map((p) => Number(p.item.id))).sort((x, y) => x - y);
  assert.deepEqual(ids, items.map((i) => Number(i.id)).sort((x, y) => x - y), "no missing / duplicate item");
  const orders = result.groups.map((g) => g.orderId);
  assert.equal(new Set(orders).size, orders.length, "one group per receipt");
  for (const g of result.groups) {
    for (const item of g.items) {
      assert.equal(item.orderId, g.orderId, "no receipt mixing");
      assert.equal(item.sheetIndex, g.sheetIndex, "receipt not split across sheets");
    }
  }
}

describe("V3A-3 TEST A — single move fails, pair succeeds", () => {
  test("no single relocation helps, the A+B pair does", () => {
    const { items, base } = pairScenario();
    assert.equal(improveWithSlotReflow(base.groups, config).stats.acceptedRelocations, 0, "precondition: no single move");
    const { result, diagnostics } = applySlotReflow(base, config, undefined, { compound: stage() });
    const c = diagnostics.compound!;
    assert.equal(c.acceptedCompoundMoves >= 1, true);
    const move = c.moves[0];
    assert.equal(move.primary.orderId, 2);
    assert.equal(move.secondary.orderId, 5);
    assert.ok(move.final.sumUsedHeight < move.before.sumUsedHeight - 20);
    assert.equal(diagnostics.applied, true);
    assert.ok(result.summary.sumUsedHeight < base.summary.sumUsedHeight);
    assertIntegrity(result, items);
  });
});

describe("V3A-3 TEST B — temporary regression", () => {
  test("a worse S1 within the intermediate limit leads to the best final state", () => {
    const { items, base } = regressionScenario();
    const generous = improveWithCompoundMoves(base.groups, config, { ...DEFAULT_COMPOUND_LIMITS, maxIntermediatePenaltyMm: 40 });
    const move = generous.diagnostics.moves[0];
    assert.equal(move.primary.orderId, 2);
    assert.equal(move.secondary.orderId, 5);
    assert.ok(move.intermediate.sumUsedHeight > move.before.sumUsedHeight + 30, "S1 is worse than S0");
    assert.ok(move.final.sumUsedHeight < move.before.sumUsedHeight - 25, "S2 beats S0");
    assertIntegrity(resultFromGroups(base, generous.groups, config), items);
  });

  test("the intermediate limit is enforced", () => {
    const { base } = regressionScenario();
    const c = improveWithCompoundMoves(base.groups, config, { ...DEFAULT_COMPOUND_LIMITS, maxIntermediatePenaltyMm: 20 }).diagnostics;
    assert.ok(c.primaryRejectedPenalty > 0);
    for (const move of c.moves) assert.ok(move.intermediate.sumUsedHeight - move.before.sumUsedHeight <= 20 + 1e-6);
  });
});

describe("V3A-3 TEST C — final not better", () => {
  test("a pair that ends level with S0 is rejected and nothing changes", () => {
    const { base } = equalScenario();
    const { result, diagnostics } = applySlotReflow(base, config, undefined, { compound: stage() });
    const c = diagnostics.compound!;
    assert.ok(c.temporaryStatesGenerated > 0, "S1 states were generated");
    assert.equal(c.acceptedCompoundMoves, 0);
    assert.equal(diagnostics.applied, false);
    assert.equal(result, base);
  });
});

describe("V3A-3 TEST D/E — slot consolidation, cross-sheet", () => {
  test("sliding order 2 merges two narrow strips; order 5 from Sheet 2 fills the merged slot", () => {
    const { items, base } = consolidationScenario(false);
    assert.equal(improveWithSlotReflow(base.groups, config).stats.acceptedRelocations, 0, "precondition: neither strip holds order 5");
    const { result, diagnostics } = applySlotReflow(base, config, undefined, { compound: stage() });
    const move = diagnostics.compound!.moves[0];
    assert.equal(move.primary.orderId, 2);
    assert.equal(move.primary.type, "FOREIGN_RELOCATION");
    assert.ok(move.slotEffect.after.largest.area > move.slotEffect.before.largest.area, "a larger usable slot opened");
    assert.equal(move.secondary.orderId, 5);
    assert.equal(move.secondary.fromSheetIndex, 1);
    assert.equal(move.secondary.toSheetIndex, 0, "cross-sheet: Sheet 2 -> Sheet 1");
    const moved = result.groups.find((g) => g.orderId === 5)!;
    assert.equal(moved.sheetIndex, 0);
    assert.ok(result.summary.sumUsedHeight < base.summary.sumUsedHeight - 100);
    assertIntegrity(result, items);
  });
});

describe("V3A-3 TEST F — sheet elimination", () => {
  test("the last group of Sheet 2 comes over: 2 sheets -> 1", () => {
    const { items, base } = consolidationScenario(true);
    assert.equal(base.summary.sheetCount, 2);
    const { result, diagnostics } = applySlotReflow(base, config, undefined, { compound: stage() });
    const move = diagnostics.compound!.moves[0];
    assert.equal(move.sheetRemoved, true);
    assert.equal(move.final.sheetCount, 1);
    assert.equal(result.summary.sheetCount, 1);
    assert.deepEqual(result.sheets.map((s) => s.sheetIndex), [0]);
    assertIntegrity(result, items);
  });
});

describe("V3A-3 TEST G — no mutation", () => {
  test("S0 stays deep-equal whether the compound is rejected or accepted", () => {
    for (const scenario of [equalScenario, pairScenario]) {
      const { base } = scenario();
      const snapshot = structuredClone(base.groups);
      improveWithCompoundMoves(base.groups, config);
      assert.deepEqual(base.groups, snapshot);
    }
  });
});

describe("V3A-3 TEST H/I — integrity, gaps, bounds", () => {
  test("every scenario result is valid", () => {
    for (const { items, base } of [pairScenario(), regressionScenario(), equalScenario(), consolidationScenario(false), consolidationScenario(true)]) {
      assertIntegrity(applySlotReflow(base, config, undefined, { compound: stage() }).result, items);
    }
    assert.deepEqual([ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM], [8, 2, 5]);
  });
});

describe("V3A-3 TEST J — determinism", () => {
  test("same input -> same compound result", () => {
    const strip = (r: ReturnType<typeof applySlotReflow<Payload>>) => ({
      groups: r.result.groups.map((g) => [g.orderId, g.sheetIndex, g.x, g.y, g.width, g.height]),
      compound: { ...r.diagnostics.compound!, runtimeMs: null },
    });
    for (const scenario of [pairScenario, consolidationScenario.bind(null, false)]) {
      const run = () => applySlotReflow(scenario().base, config, undefined, { compound: stage() });
      assert.deepEqual(strip(run()), strip(run()));
    }
  });
});

describe("V3A-3 TEST K — budget", () => {
  test("the hard evaluation cap holds and the result stays valid", () => {
    const { items, base } = pairScenario();
    for (const maxEvaluations of [1, 10, 60]) {
      const { result, diagnostics } = applySlotReflow(base, config, undefined, { compound: stage({ ...DEFAULT_COMPOUND_LIMITS, maxEvaluations }) });
      assert.ok(diagnostics.compound!.budgetUsed <= maxEvaluations);
      assertIntegrity(result, items);
    }
  });

  test("top-K caps hold", () => {
    const { base } = consolidationScenario(false);
    const limits = { ...DEFAULT_COMPOUND_LIMITS, topKPrimary: 2, topKPrimaryVariants: 1, topKSecondary: 1, topKTargetSlots: 1, maxPasses: 1 };
    const c = improveWithCompoundMoves(base.groups, config, limits).diagnostics;
    assert.ok(c.primaryGroupsConsidered <= 2);
    assert.ok(c.temporaryStatesGenerated <= 2);
    assert.ok(c.secondaryGroupsConsidered <= c.temporaryStatesGenerated);
    assert.ok(c.pairAttempts <= c.secondaryGroupsConsidered);
    assert.ok(c.acceptedCompoundMoves <= 1);
  });
});

describe("V3A-3 TEST L/M — regressions", () => {
  test("without the compound stage V3A-2 is unchanged and reports no compound", () => {
    const { base } = pairScenario();
    const plain = applySlotReflow(base, config);
    assert.equal(plain.diagnostics.compound, null);
    assert.equal(plain.result, base, "V3A-2 alone finds nothing here");
  });

  test("V2 inside a compound run equals plain runGroupedNesting; the flag needs slotReflow too", () => {
    const { items } = pairScenario();
    assert.deepEqual(runGroupedNestingV3(items, {}, undefined, { compound: stage() }).v2, runGroupedNesting(items));
    assert.equal(isCompoundRequest({ slotReflowCompound: true }), false);
    assert.equal(isCompoundRequest({ slotReflow: true }), false);
    assert.equal(isCompoundRequest({ slotReflow: true, slotReflowCompound: true }), true);
  });
});
