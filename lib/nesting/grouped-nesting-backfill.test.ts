/**
 * PHASE 2H — BEST_EXISTING multi-sheet placement (outer-maxrects.ts) and its
 * integration in the optimizer (grouped-nesting-outer.ts). `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  emptyMultiSheetPackStats,
  packOuterRects,
  withBestExisting,
  LEGACY_OUTER_STRATEGY,
  type OuterPlacement,
} from "./outer-maxrects";
import { DEFAULT_OUTER_PACKING_LIMITS } from "./grouped-nesting-outer";
import { runGroupedNesting } from "./grouped-nesting";
import { compareScores } from "./grouped-nesting-global";
import type { GroupedNestingItem } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

const LAST_ONLY = LEGACY_OUTER_STRATEGY; // BSSF / AREA_DESC
const BEST_EXISTING = withBestExisting(LEGACY_OUTER_STRATEGY);

const rect = (width: number, height: number, name: string) => ({ width, height, data: name });
const sheetCount = (placed: OuterPlacement<string>[]) => new Set(placed.map((p) => p.sheetIndex)).size;

/**
 * Independent fit check (does NOT use the packer): can a w x h rect, with
 * `gap` trailing clearance, sit anywhere on a sheet already holding
 * `placed`? Any feasible spot can be slid left/up until it touches the
 * border or a placed rect's padded edge, so testing those corners is enough.
 */
function fitsOnSheet(placed: OuterPlacement<string>[], w: number, h: number, sheetW: number, sheetH: number, gap: number): boolean {
  // packOuterRects: free space spans [gap, sheet - gap]; a rect needs w + gap of it.
  const xs = [gap, ...placed.map((p) => p.x + p.width + gap)];
  const ys = [gap, ...placed.map((p) => p.y + p.height + gap)];
  for (const x of xs) {
    for (const y of ys) {
      if (x + w + gap > sheetW - gap + 1e-9 || y + h + gap > sheetH - gap + 1e-9) continue;
      const clash = placed.some((p) => x < p.x + p.width + gap && x + w + gap > p.x && y < p.y + p.height + gap && y + h + gap > p.y);
      if (!clash) return true;
    }
  }
  return false;
}

/** Deterministic LCG batch (same generator family as the 2F/2G tests). */
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

describe("PHASE 2H TEST A — backfill prevents a new sheet", () => {
  // 100 x 100 usable, no gap, BSSF + AREA_DESC:
  //   B 100x70 -> sheet 1 (leaves a 100x30 strip)
  //   A 60x100 -> not on sheet 1 -> sheet 2 (leaves a 40-wide column)
  //   C 90x25  -> LAST_ONLY: not on sheet 2 -> opens sheet 3
  //               BEST_EXISTING: fits sheet 1's strip -> stays at 2 sheets
  const rects = [rect(60, 100, "A"), rect(100, 70, "B"), rect(90, 25, "C")];

  test("packer: LAST_ONLY needs 3 sheets, BEST_EXISTING 2", () => {
    const lastOnly = packOuterRects(rects, 100, 100, 0, LAST_ONLY);
    const stats = emptyMultiSheetPackStats();
    const best = packOuterRects(rects, 100, 100, 0, BEST_EXISTING, { stats });

    assert.equal(sheetCount(lastOnly), 3);
    assert.equal(sheetCount(best), 2);
    assert.equal(best.find((p) => p.data === "C")!.sheetIndex, 0, "C backfilled into sheet 1");
    assert.equal(stats.backfills, 1);
    assert.equal(stats.newSheetsAvoided, 1);
  });

  test("engine: with only the legacy strategy allowed, Phase 2H turns 3 sheets into 2", () => {
    const items = rects.map((r, i) => ({
      id: i,
      orderId: i + 1,
      width: r.width,
      height: r.height,
      originalWidth: r.width,
      originalHeight: r.height,
      allowRotation: false,
      data: { name: r.data },
    }));
    const config = { sheetWidth: 100, sheetHeight: 100, orderGapMm: 0, sheetMarginMm: 0 };
    const legacyOnly = { ...DEFAULT_OUTER_PACKING_LIMITS, maxOuterStrategies: 1, maxSortVariants: 1 };
    const result = runGroupedNesting(items, config, undefined, legacyOnly);

    assert.equal(result.optimizer.multiSheet.sheetsBefore, 3);
    assert.equal(result.optimizer.multiSheet.sheetsAfter, 2);
    assert.equal(result.sheets.length, 2);
    assert.equal(result.optimizer.multiSheet.mode, "BEST_EXISTING");
    assert.equal(result.optimizer.multiSheet.newSheetsAvoided, 1);
    assert.equal(result.unfit.length, 0);
  });
});

describe("PHASE 2H TEST B — existing sheet choice", () => {
  test("of two sheets that both fit, the one adding less used height wins (+10 beats +40)", () => {
    // 100 x 200 usable, no gap, BSSF + AREA_DESC:
    //   P  100x150 -> sheet 1 (100x50 strip left at y=150, maxY 150)
    //   Q1  45x60  -> too tall for that strip -> sheet 2 (maxY 60)
    //   Q2  55x30  -> beside Q1 on sheet 2 (adds 0)
    //   X   40x40  -> sheet 1 at y=150: +40 / sheet 2 under Q2 at y=30: 70 - 60 = +10
    const rects = [rect(100, 150, "P"), rect(45, 60, "Q1"), rect(55, 30, "Q2"), rect(40, 40, "X")];
    const placed = packOuterRects(rects, 100, 200, 0, BEST_EXISTING);
    const x = placed.find((p) => p.data === "X")!;

    assert.equal(x.sheetIndex, 1);
    assert.deepEqual([x.x, x.y], [45, 30]);
    const sheet2Height = Math.max(...placed.filter((p) => p.sheetIndex === 1).map((p) => p.y + p.height));
    assert.equal(sheet2Height, 70, "sheet 2 grew by exactly 10 mm");
    assert.equal(Math.max(...placed.filter((p) => p.sheetIndex === 0).map((p) => p.y + p.height)), 150, "sheet 1 untouched");
  });
});

describe("PHASE 2H — the geometric checker itself", () => {
  test("agrees with the packer on exact-fit edges", () => {
    // 300 wide, gap 4: free span is [4, 296] -> a 288-wide rect (288 + 4 trailing) fits exactly, 289 does not.
    assert.equal(fitsOnSheet([], 288, 50, 300, 400, 4), true);
    assert.equal(fitsOnSheet([], 289, 50, 300, 400, 4), false);
    assert.equal(packOuterRects([rect(288, 50, "a")], 300, 400, 4, LAST_ONLY).length, 1);
    assert.equal(packOuterRects([rect(289, 50, "a")], 300, 400, 4, LAST_ONLY).length, 0);
    const one = packOuterRects([rect(200, 100, "a")], 300, 400, 4, LAST_ONLY);
    assert.equal(fitsOnSheet(one, 84, 100, 300, 400, 4), true, "beside it: 4 + 200 + 4 + 84 + 4 = 296");
    // 85 wide is 1 mm too wide beside it (297 > 296) but fits below it (y = 108).
    assert.equal(fitsOnSheet(one, 85, 100, 300, 400, 4), true);
    // 85 x 290: not beside, and below would end at 108 + 290 + 4 = 402 > 396 -> nowhere; the packer agrees (new sheet).
    assert.equal(fitsOnSheet(one, 85, 290, 300, 400, 4), false);
    assert.equal(sheetCount(packOuterRects([rect(200, 100, "a"), rect(85, 290, "b")], 300, 400, 4, LAST_ONLY)), 2);
  });
});

describe("PHASE 2H TEST C — no new sheet while an existing one fits", () => {
  test("every sheet's opener fits no earlier sheet (independent geometric check)", () => {
    let opened = 0;
    for (let seed = 1; seed <= 25; seed++) {
      let state = seed;
      const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
      const rects = Array.from({ length: 6 + Math.floor(rnd() * 20) }, (_, i) => rect(Math.round(20 + rnd() * 120), Math.round(20 + rnd() * 150), `r${i}`));
      const gap = 4;
      const placed = packOuterRects(rects, 300, 400, gap, BEST_EXISTING);

      // Placement order == results order; the first rect seen on sheet k opened it.
      const seen = new Set<number>([0]);
      placed.forEach((p, i) => {
        if (seen.has(p.sheetIndex)) return;
        seen.add(p.sheetIndex);
        opened++;
        const before = placed.slice(0, i);
        for (let k = 0; k < p.sheetIndex; k++) {
          const onSheet = before.filter((q) => q.sheetIndex === k);
          assert.ok(!fitsOnSheet(onSheet, p.width, p.height, 300, 400, gap), `seed ${seed}: ${p.data} opened sheet ${p.sheetIndex + 1} although sheet ${k + 1} had room`);
        }
      });
    }
    assert.ok(opened > 5, "the datasets must actually open extra sheets for this test to mean anything");
  });
});

describe("PHASE 2H TEST D — baseline fallback", () => {
  test("never more sheets, and never more total height on the same sheets, than Phase 2G", () => {
    let usedBestExisting = 0;
    for (const [orders, seed] of [[20, 2001], [20, 2002], [20, 2003], [30, 7], [40, 8], [25, 12]] as const) {
      const items = realisticBatch(orders, seed);
      const phase2g = runGroupedNesting(items, {}, undefined, { ...DEFAULT_OUTER_PACKING_LIMITS, maxBestExistingPackEvaluations: 0 });
      const phase2h = runGroupedNesting(items);
      const ms = phase2h.optimizer.multiSheet;

      assert.ok(compareScores(phase2h.optimizer.finalScore, phase2g.optimizer.finalScore) <= 0, `${orders}/${seed}: worse than 2G`);
      assert.ok(ms.sheetsAfter <= ms.sheetsBefore);
      if (ms.sheetsAfter === ms.sheetsBefore) assert.ok(ms.sumUsedHeightAfter <= ms.sumUsedHeightBefore + 1e-9);
      assert.equal(ms.sheetsBefore, phase2g.summary.sheetCount, "'before' is exactly the 2G result");
      assert.ok(Math.abs(ms.sumUsedHeightBefore - phase2g.summary.sumUsedHeight) < 1e-6);
      assert.ok(Math.abs(ms.sumUsedHeightAfter - phase2h.summary.sumUsedHeight) < 1e-6, "'after' matches the placed layout");
      if (ms.mode === "BEST_EXISTING") usedBestExisting++;
    }
    assert.ok(usedBestExisting > 0, "at least one batch must actually be improved by BEST_EXISTING");
  });

  test("a single-sheet batch is untouched: BEST_EXISTING stage never runs", () => {
    const items = realisticBatch(5, 11);
    const withStage = runGroupedNesting(items);
    const without = runGroupedNesting(items, {}, undefined, { ...DEFAULT_OUTER_PACKING_LIMITS, maxBestExistingPackEvaluations: 0 });
    assert.equal(withStage.sheets.length, 1);
    assert.equal(withStage.optimizer.multiSheet.bestExistingEvaluated, false);
    assert.deepEqual(withStage.metrics, without.metrics);
    assert.deepEqual(withStage.groups.map((g) => [g.orderId, g.x, g.y]), without.groups.map((g) => [g.orderId, g.x, g.y]));
  });
});

describe("PHASE 2H TEST E/F — integrity and overlap on BEST_EXISTING layouts", () => {
  test("one order = one group on one sheet; no group or item overlap per sheet", () => {
    for (const seed of [2001, 2002, 2003, 7, 8]) {
      const result = runGroupedNesting(realisticBatch(20 + (seed % 3) * 5, seed));
      const orderIds = result.groups.map((g) => g.orderId);
      assert.equal(new Set(orderIds).size, orderIds.length, "order split into two groups");

      for (const sheet of result.sheets) {
        for (const group of sheet.groups) {
          for (const placed of group.items) {
            assert.equal(placed.sheetIndex, sheet.sheetIndex);
            assert.equal(placed.orderId, group.orderId);
          }
        }
        const boxes = sheet.groups;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
            assert.ok(!overlap, `seed ${seed}: groups ${a.orderId}/${b.orderId} overlap`);
          }
        }
        const items = sheet.groups.flatMap((g) => g.items);
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            assert.ok(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y), `seed ${seed}: items overlap`);
          }
        }
      }
    }
  });
});

describe("PHASE 2H TEST G — deterministic", () => {
  test("same input -> same sheet assignment, candidates, positions, metrics", () => {
    const summarize = () => {
      const r = runGroupedNesting(realisticBatch(20, 2002));
      return {
        groups: r.groups.map((g) => [g.orderId, g.sheetIndex, g.candidate.candidateId, g.x, g.y]),
        summary: r.summary,
        multiSheet: r.optimizer.multiSheet,
        strategy: r.optimizer.selectedStrategyId,
      };
    };
    assert.deepEqual(summarize(), summarize());
  });
});

describe("PHASE 2H TEST H — sheet removal by relocation", () => {
  test("not needed: the opener of the last sheet fits no earlier sheet even in the FINAL layout", () => {
    // Why no relocation pass exists: earlier sheets only fill up after a sheet
    // is opened, so its opener can never move back and the sheet can never empty.
    for (let seed = 1; seed <= 15; seed++) {
      let state = seed * 3;
      const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
      const rects = Array.from({ length: 10 + Math.floor(rnd() * 15) }, (_, i) => rect(Math.round(20 + rnd() * 120), Math.round(20 + rnd() * 150), `r${i}`));
      const placed = packOuterRects(rects, 300, 400, 4, BEST_EXISTING);
      const last = Math.max(...placed.map((p) => p.sheetIndex));
      if (last === 0) continue;
      const opener = placed.find((p) => p.sheetIndex === last)!;
      for (let k = 0; k < last; k++) {
        assert.ok(!fitsOnSheet(placed.filter((p) => p.sheetIndex === k), opener.width, opener.height, 300, 400, 4));
      }
    }
    assert.equal(runGroupedNesting(realisticBatch(20, 2001)).optimizer.multiSheet.relocationPass, "OFF");
  });
});

describe("PHASE 2H TEST I — many orders", () => {
  for (const orders of [10, 20, 50, 100]) {
    test(`${orders} orders: completes within budgets`, () => {
      const start = performance.now();
      const result = runGroupedNesting(realisticBatch(orders, orders * 13 + 5));
      const elapsedMs = performance.now() - start;
      assert.ok(elapsedMs < 15000, `took ${elapsedMs.toFixed(0)} ms`);
      assert.ok(result.optimizer.outerPackAttempts <= DEFAULT_OUTER_PACKING_LIMITS.maxTotalPackEvaluations);
      assert.ok(result.optimizer.multiSheet.packEvaluations <= DEFAULT_OUTER_PACKING_LIMITS.maxBestExistingPackEvaluations);
      assert.equal(result.groups.length + result.unfitGroups.length, orders);
    });
  }

  test("a tiny BEST_EXISTING budget is respected and still returns a valid layout", () => {
    const items = realisticBatch(25, 4);
    const result = runGroupedNesting(items, {}, undefined, { ...DEFAULT_OUTER_PACKING_LIMITS, maxBestExistingPackEvaluations: 7 });
    assert.ok(result.optimizer.multiSheet.packEvaluations <= 7);
    assert.equal(result.items.length + result.unfit.length, items.length);
  });
});
