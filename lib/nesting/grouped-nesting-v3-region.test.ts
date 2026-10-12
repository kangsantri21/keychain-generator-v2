/**
 * V3A-4 FAST — local region repack + bounded beam (experimental, opt-in).
 * `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting, resolveConfig } from "./grouped-nesting";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM } from "./grouped-nesting-config";
import { applySlotReflow, improveWithSlotReflow, placeGroup, runGroupedNestingV3, usableRects, validateLayout } from "./grouped-nesting-v3";
import { compoundStage, improveWithCompoundMoves } from "./grouped-nesting-v3-compound";
import {
  improveWithRegionRepack,
  isRegionImprovement,
  isRegionRequest,
  regionObjective,
  regionStage,
  FAST_REGION_LIMITS,
  type RegionObjective,
} from "./grouped-nesting-v3-region";
import { replayFreeRects } from "./outer-maxrects";
import { realBatch8Orders } from "./test-fixtures/real-batch-8-orders";
import type { GroupedNestingItem, GroupedNestingResult, GroupPlacement, OrderLayoutCandidate } from "./grouped-nesting-types";

const config = resolveConfig({});
const EDGE = SHEET_MARGIN_MM + ORDER_GAP_MM;

// Receipt order ids in the real batch: TEST-V2-A = 82, TEST-V2-C = 84, TEST-V2-H = 89.
const A = 82;
const C = 84;
const H = 89;

function fullRun<T>(items: GroupedNestingItem<T>[]) {
  return runGroupedNestingV3(items, {}, undefined, { compound: compoundStage(config), region: regionStage(config) });
}

function assertIntegrity<T>(result: GroupedNestingResult<T>, items: GroupedNestingItem<T>[]) {
  assert.deepEqual(validateLayout(result.groups, config, items.map((i) => i.id)), [], "bounds, ORDER_GAP, PART_GAP, sizes, integrity");
  const ids = result.groups.flatMap((g) => g.candidate.placements.map((p) => Number(p.item.id))).sort((x, y) => x - y);
  assert.deepEqual(ids, items.map((i) => Number(i.id)).sort((x, y) => x - y), "every item exactly once");
  assert.equal(result.items.length, items.length);
  const orders = result.groups.map((g) => g.orderId);
  assert.equal(new Set(orders).size, orders.length, "one group per receipt");
  for (const g of result.groups) for (const item of g.items) assert.equal(item.orderId, g.orderId);
}

function realisticBatch(orderCount: number, seed: number): GroupedNestingItem<{ n: number }>[] {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const items: GroupedNestingItem<{ n: number }>[] = [];
  let id = 0;
  for (let order = 1; order <= orderCount; order++) {
    const big = rnd() < 0.4;
    const count = big ? 6 + Math.floor(rnd() * 7) : 1 + Math.floor(rnd() * 2);
    const character = rnd() < 0.25;
    for (let i = 0; i < count; i++) {
      const width = character ? 24 + rnd() * 6 : rnd() < 0.45 ? 70 + rnd() * 25 : 30 + rnd() * 15;
      const height = character ? 70 + rnd() * 12 : 18 + rnd() * 8;
      items.push({ id: id++, orderId: order, width, height, originalWidth: width, originalHeight: height, allowRotation: true, data: { n: id } });
    }
  }
  return items;
}

describe("V3A-4 TEST 1/2/3 — real batch: 3-receipt cross-sheet swap with reshape", () => {
  const items = realBatch8Orders();
  const run = fullRun(items);
  const region = run.diagnostics.region!;

  test("single and compound moves are exhausted on the V3A-3 layout", () => {
    const v3a3 = runGroupedNestingV3(items, {}, undefined, { compound: compoundStage(config) }).result.groups;
    assert.equal(improveWithSlotReflow(v3a3, config).stats.acceptedRelocations, 0);
    assert.equal(improveWithCompoundMoves(v3a3, config).diagnostics.acceptedCompoundMoves, 0);
  });

  test("the first accepted region is {A, C, H}: found by the search, strictly better (643.6 -> 627.5)", () => {
    const first = region.accepted[0];
    assert.deepEqual(first.receipts.map((r) => r.orderId).sort(), [A, C, H]);
    assert.ok(Math.abs(first.before.sumHeight - 643.627) < 0.01);
    assert.ok(first.after.sumHeight < 627.6);
    assert.ok(region.candidateRegionsDetected > region.regionsEvaluated, "regions are ranked, not all evaluated");
  });

  test("swap across sheets: A and H trade sheets, A is reshaped for H's old place", () => {
    const byId = new Map(region.accepted[0].receipts.map((r) => [r.orderId, r]));
    const a = byId.get(A)!;
    const h = byId.get(H)!;
    assert.equal(a.changedSheet, true);
    assert.equal(h.changedSheet, true);
    assert.equal(a.toSheetIndex, h.fromSheetIndex);
    assert.equal(h.toSheetIndex, a.fromSheetIndex);
    assert.equal(a.reshaped, true);
    assert.match(a.strategy, /slot-reflow/);
  });

  test("final layout is valid, keeps 2 sheets and every item", () => {
    assert.ok(run.diagnostics.final.sumUsedHeight <= 627.5 + 0.01);
    assert.equal(run.result.summary.sheetCount, 2);
    assertIntegrity(run.result, items);
  });
});

describe("V3A-4 TEST 4/5 — region rebuild and exact fit", () => {
  test("rebuilt free space equals a from-scratch replay and has no phantom slot", () => {
    const groups = runGroupedNesting(realBatch8Orders()).groups;
    const rects = usableRects(groups, config);
    const removed = [0, 3];
    const fixed = rects.filter((_, i) => !removed.includes(i));
    for (const sheet of [0, 1]) {
      const occ = fixed.filter((r) => r.sheetIndex === sheet);
      const free = replayFreeRects(occ, 300, 460, ORDER_GAP_MM);
      const sig = (rs: { x: number; y: number; width: number; height: number }[]) => rs.map((r) => `${r.x},${r.y},${r.width},${r.height}`).sort().join("|");
      assert.equal(sig(free), sig(replayFreeRects(occ.slice().reverse(), 300, 460, ORDER_GAP_MM)), "same free space in any replay order");
      for (const f of free) {
        for (const r of occ) {
          const hit = f.x < r.x + r.width + ORDER_GAP_MM && f.x + f.width > r.x && f.y < r.y + r.height + ORDER_GAP_MM && f.y + f.height > r.y;
          assert.equal(hit, false, "no free rect on an occupied node");
        }
      }
    }
    assert.equal(fullRun(realBatch8Orders()).diagnostics.region!.phantomSlotsDetected, 0);
  });

  test("a boxed-in exact-fit layout is repacked without overlap", () => {
    const mk = (id: number, orderId: number, w: number, h: number): GroupedNestingItem<{ n: number }> => ({
      id, orderId, width: w, height: h, originalWidth: w, originalHeight: h, allowRotation: false, data: { n: id },
    });
    const items = [mk(0, 1, 100, 100), mk(1, 2, 100, 100), mk(2, 3, 208, 100), mk(3, 4, 60, 40), mk(4, 4, 60, 40)];
    const single = (it: GroupedNestingItem<{ n: number }>[], cols: number): OrderLayoutCandidate<{ n: number }> => {
      const w = it[0].width;
      const h = it[0].height;
      const used = Math.min(cols, it.length);
      const rows = Math.ceil(it.length / cols);
      const width = used * w + (used - 1) * PART_GAP_MM;
      const height = rows * h + (rows - 1) * PART_GAP_MM;
      return {
        candidateId: `hand-${it[0].orderId}`,
        orderId: it[0].orderId,
        strategy: "hand",
        width,
        height,
        placements: it.map((item, i) => ({ item, x: (i % cols) * (w + PART_GAP_MM), y: Math.floor(i / cols) * (h + PART_GAP_MM), width: w, height: h, rotated: false })),
        metrics: { area: width * height, itemArea: it.length * w * h, utilizationPercent: 100 },
      };
    };
    const place = (it: GroupedNestingItem<{ n: number }>[], cols: number, x: number, y: number) => {
      const c = single(it, cols);
      return placeGroup(c, x, y, 0, { alternatives: [c], localCandidate: c });
    };
    const groups: GroupPlacement<{ n: number }>[] = [
      place([items[0]], 1, EDGE, EDGE),
      place([items[1]], 1, EDGE + 108, EDGE),
      place([items[2]], 1, EDGE, EDGE + 108),
      place([items[3], items[4]], 1, EDGE, EDGE + 216),
    ];
    assert.deepEqual(validateLayout(groups, config), []);
    const out = improveWithRegionRepack(groups, config);
    assert.deepEqual(validateLayout(out.groups, config, items.map((i) => i.id)), []);
    assert.equal(out.diagnostics.phantomSlotsDetected, 0);
  });
});

describe("V3A-4 TEST 6/7/8/11 — integrity on many batches", () => {
  test("no overlap, receipts intact, item count kept, never more sheets", () => {
    for (const [orders, seed] of [[8, 11], [12, 7], [20, 2001], [30, 5]] as const) {
      const items = realisticBatch(orders, seed);
      const run = fullRun(items);
      assertIntegrity(run.result, items);
      assert.ok(run.result.summary.sheetCount <= run.v2.summary.sheetCount);
      const r = run.diagnostics.region!;
      assert.ok(r.final.sheets <= r.baseline.sheets);
      assert.ok(r.final.sumHeight <= r.baseline.sumHeight + 1e-6);
    }
  });
});

describe("V3A-4 TEST 9 — determinism", () => {
  test("same input -> same region result", () => {
    const strip = (r: ReturnType<typeof fullRun<{ itemId: number }>>) => ({
      groups: r.result.groups.map((g) => [g.orderId, g.sheetIndex, g.x, g.y, g.width, g.height, g.candidate.candidateId]),
      region: { ...r.diagnostics.region!, runtimeMs: null },
    });
    assert.deepEqual(strip(fullRun(realBatch8Orders())), strip(fullRun(realBatch8Orders())));
  });
});

describe("V3A-4 TEST 10 — no-op when nothing is better", () => {
  test("returns the input layout itself", () => {
    const groups = runGroupedNesting(realisticBatch(1, 3)).groups;
    const out = improveWithRegionRepack(groups, config);
    assert.equal(out.groups, groups);
    assert.equal(out.diagnostics.acceptedRegions, 0);
  });

  test("objective: more height or more sheets is never an improvement, whatever the area", () => {
    const base: RegionObjective = { sheets: 2, sumHeight: 600, maxRemainder: 100, sideFragments: 40, boundingArea: 100000 };
    assert.equal(isRegionImprovement({ ...base, sumHeight: 600.5, boundingArea: 1 }, base), false);
    assert.equal(isRegionImprovement({ ...base, sheets: 3, sumHeight: 1 }, base), false);
    assert.equal(isRegionImprovement({ ...base, sumHeight: 599 }, base), true);
    assert.equal(isRegionImprovement({ ...base, maxRemainder: 120 }, base), true);
    assert.equal(isRegionImprovement(base, base), false);
    assert.equal(regionObjective([], config).sheets, 0);
  });
});

describe("V3A-4 TEST 12/13/14 — regressions", () => {
  const items = realBatch8Orders();

  test("V2 without flags: identical to plain runGroupedNesting (665.3 mm)", () => {
    const v2 = runGroupedNesting(items);
    assert.ok(Math.abs(v2.summary.sumUsedHeight - 665.262) < 0.001);
    assert.deepEqual(fullRun(items).v2, v2);
  });

  test("V3A-2 without compound/region stays 646.2 mm", () => {
    const run = runGroupedNestingV3(items);
    assert.ok(Math.abs(run.result.summary.sumUsedHeight - 646.228) < 0.001);
    assert.equal(run.diagnostics.region, null);
  });

  test("V3A-3 without region stays 643.6 mm", () => {
    const run = runGroupedNestingV3(items, {}, undefined, { compound: compoundStage(config) });
    assert.ok(Math.abs(run.result.summary.sumUsedHeight - 643.627) < 0.001);
    assert.equal(run.diagnostics.region, null);
  });

  test("region stage only on explicit slotReflow + slotReflowRegion; limits are FAST", () => {
    assert.equal(isRegionRequest({ slotReflowRegion: true }), false);
    assert.equal(isRegionRequest({ slotReflow: true }), false);
    assert.equal(isRegionRequest({ slotReflow: true, slotReflowRegion: true }), true);
    assert.deepEqual(
      [FAST_REGION_LIMITS.maxPasses, FAST_REGION_LIMITS.maxRegionSize, FAST_REGION_LIMITS.maxRegionsPerPass, FAST_REGION_LIMITS.beamWidth, FAST_REGION_LIMITS.maxVariantsPerTarget],
      [3, 3, 12, 4, 6]
    );
    assert.deepEqual([ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM], [8, 2, 5]);
  });

  test("budget cap holds", () => {
    const v2 = runGroupedNesting(items);
    const out = applySlotReflow(v2, config, undefined, { region: regionStage(config, { ...FAST_REGION_LIMITS, maxEvaluations: 200 }) });
    assert.ok(out.diagnostics.region!.budgetUsed <= 200 + FAST_REGION_LIMITS.maxReflowVariants);
    assertIntegrity(out.result, items);
  });
});
