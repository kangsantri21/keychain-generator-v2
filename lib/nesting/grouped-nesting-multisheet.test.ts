/**
 * PHASE 2G — multi-sheet model, metrics, objective, benchmark and preview
 * partitioning. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting } from "./grouped-nesting";
import { compareScores, scoreOuterPlacements } from "./grouped-nesting-global";
import { runSpacingBenchmark } from "./grouped-nesting-benchmark";
import { ORDER_GAP_MM, SHEET_HEIGHT_MM, SHEET_MARGIN_MM, SHEET_WIDTH_MM } from "./grouped-nesting-config";
import { buildHeaderMetrics, compareWithManualMultiSheet, partitionBySheet, type GroupedV2PreviewSheet } from "./grouped-nesting-preview";
import type { GroupedNestingItem } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

function item(id: number, orderId: number, width: number, height: number, allowRotation = false): GroupedNestingItem<Payload> {
  return { id, orderId, width, height, originalWidth: width, originalHeight: height, allowRotation, data: { name: `${orderId}-${id}` } };
}

/**
 * 3 orders x one 250 x 200 item, no rotation. Sheet 310 x 470, margin 5,
 * order gap 8 -> groups start at 13 mm and a sheet holds two stacked
 * (13 + 200 + 8 + 200 = 421 <= 465) but not three -> exactly 2 sheets.
 */
const threeBigOrders = () => [item(0, 1, 250, 200), item(1, 2, 250, 200), item(2, 3, 250, 200)];

/** Deterministic LCG batch (same shape as the Phase 2F benchmark tests). */
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

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const EDGE = SHEET_MARGIN_MM + ORDER_GAP_MM; // 13 mm

describe("PHASE 2G TEST A — two sheets", () => {
  test("3 big orders -> 2 sheets, local coordinates, ownership and no overlap per sheet", () => {
    const result = runGroupedNesting(threeBigOrders());

    assert.equal(result.sheets.length, 2);
    assert.deepEqual(result.sheets.map((s) => s.sheetIndex), [0, 1]);
    assert.deepEqual(result.sheets.map((s) => s.groups.length), [2, 1]);
    assert.equal(result.unfit.length, 0);

    for (const sheet of result.sheets) {
      // Local coordinates: every sheet starts at the same edge offset, never 470 + something.
      assert.equal(Math.min(...sheet.groups.map((g) => g.y)), EDGE);
      for (const group of sheet.groups) {
        assert.equal(group.sheetIndex, sheet.sheetIndex);
        assert.ok(group.y + group.height <= SHEET_HEIGHT_MM - SHEET_MARGIN_MM);
        for (const placed of group.items) assert.equal(placed.sheetIndex, sheet.sheetIndex);
      }
      const sheetItems = sheet.groups.flatMap((g) => g.items);
      for (let i = 0; i < sheetItems.length; i++) {
        for (let j = i + 1; j < sheetItems.length; j++) assert.ok(!overlaps(sheetItems[i], sheetItems[j]));
      }
    }
    // Flat placements kept for existing callers.
    assert.equal(result.items.length, 3);
    assert.equal(result.groups.length, 3);
  });
});

describe("PHASE 2G TEST B — no cross-sheet group", () => {
  test("every order lives in exactly one group, wholly on one sheet", () => {
    for (const seed of [2001, 2002, 2003]) {
      const result = runGroupedNesting(realisticBatch(20, seed));
      assert.ok(result.sheets.length >= 2, `seed ${seed} should spill (got ${result.sheets.length})`);
      const sheetOfOrder = new Map<number | null, number>();
      for (const group of result.groups) {
        assert.ok(!sheetOfOrder.has(group.orderId), `order ${group.orderId} appears in two groups`);
        sheetOfOrder.set(group.orderId, group.sheetIndex);
        for (const placed of group.items) {
          assert.equal(placed.sheetIndex, group.sheetIndex, "item on a different sheet than its group");
          assert.equal(placed.orderId, group.orderId);
        }
      }
      assert.equal(result.sheets.reduce((sum, s) => sum + s.itemCount, 0), result.items.length, "no item lost or duplicated");
    }
  });
});

describe("PHASE 2G TEST C — per-sheet metrics", () => {
  test("used size, remaining strip, side fragment and utilization per sheet", () => {
    const [first, second] = runGroupedNesting(threeBigOrders()).sheets;

    // Sheet 1: two groups stacked -> bottom at 13 + 200 + 8 + 200.
    assert.equal(first.usedWidth, EDGE + 250);
    assert.equal(first.usedHeight, EDGE + 200 + ORDER_GAP_MM + 200);
    assert.equal(first.remainingFullWidthHeight, SHEET_HEIGHT_MM - first.usedHeight);
    assert.equal(first.sideFragmentWidth, SHEET_WIDTH_MM - first.usedWidth);
    assert.equal(first.itemArea, 2 * 250 * 200);
    assert.ok(Math.abs(first.utilizationPercent - (100000 / (263 * 421)) * 100) < 1e-9);
    assert.ok(Math.abs(first.wastePercent - (100 - first.utilizationPercent)) < 1e-9);
    assert.equal(first.orderCount, 2);
    assert.equal(first.itemCount, 2);

    // Sheet 2: one group.
    assert.equal(second.usedHeight, EDGE + 200);
    assert.equal(second.remainingFullWidthHeight, SHEET_HEIGHT_MM - (EDGE + 200));
    assert.equal(second.orderCount, 1);
  });
});

describe("PHASE 2G TEST D — global summary", () => {
  test("sums across sheets instead of the tallest sheet", () => {
    const result = runGroupedNesting(threeBigOrders());
    const s = result.summary;
    assert.equal(s.sheetCount, 2);
    assert.equal(s.totalOrders, 3);
    assert.equal(s.totalItems, 3);
    assert.equal(s.totalUnfitItems, 0);
    assert.equal(s.sumUsedHeight, 421 + 213);
    assert.equal(s.totalRemainingFullWidthHeight, (470 - 421) + (470 - 213));
    assert.equal(s.totalSideFragmentWidth, 2 * (310 - 263));
    assert.equal(s.totalSheetArea, 2 * 310 * 470);
    assert.equal(s.totalItemArea, 3 * 250 * 200);
    assert.ok(Math.abs(s.overallMaterialUtilizationPercent - (150000 / (2 * 310 * 470)) * 100) < 1e-9);
    assert.equal(s.maxUsedHeight, 421);
    assert.equal(s.minUsedHeight, 213);
    assert.equal(s.averageUsedHeight, (421 + 213) / 2);

    // Legacy-shaped metrics are now sheet-aware: never >100% utilization.
    assert.equal(result.metrics.usedHeight, s.sumUsedHeight);
    assert.ok(result.metrics.packingUtilizationPercent <= 100);
  });

  test("a one-sheet result keeps exactly the pre-2G single-sheet numbers", () => {
    const result = runGroupedNesting(realisticBatch(5, 11));
    assert.equal(result.sheets.length, 1);
    const maxBottom = Math.max(...result.items.map((i) => i.y + i.height));
    const maxRight = Math.max(...result.items.map((i) => i.x + i.width));
    assert.equal(result.metrics.usedHeight, maxBottom);
    assert.equal(result.metrics.usedWidth, maxRight);
    assert.equal(result.summary.sumUsedHeight, maxBottom);
    assert.equal(result.metrics.usedArea, maxBottom * maxRight);
  });

  test("the >100% utilization bug is gone on a real spill", () => {
    const result = runGroupedNesting(realisticBatch(20, 2001));
    assert.ok(result.sheets.length >= 2);
    assert.ok(result.metrics.packingUtilizationPercent <= 100, `${result.metrics.packingUtilizationPercent}`);
    assert.ok(result.summary.overallMaterialUtilizationPercent <= 100);
  });
});

describe("PHASE 2G TEST E — multi-sheet objective", () => {
  const layout = (...sheets: [number, number][]) =>
    scoreOuterPlacements(
      sheets.map(([width, height], sheetIndex) => ({ x: 0, y: 0, width, height, sheetIndex })),
      sheets.length,
      300
    );

  test("a valid 1-sheet layout beats any 2-sheet layout, even a much shorter one", () => {
    assert.ok(compareScores(layout([290, 440]), layout([100, 50], [100, 50])) < 0);
  });

  test("same sheet count -> smaller SUM of used heights wins (not the tallest sheet)", () => {
    const tallButLowSum = layout([200, 400], [200, 50]); // max 400, sum 450
    const evenButHighSum = layout([200, 300], [200, 300]); // max 300, sum 600
    assert.equal(tallButLowSum.usedHeight, 450);
    assert.equal(evenButHighSum.usedHeight, 600);
    assert.ok(compareScores(tallButLowSum, evenButHighSum) < 0);
  });

  test("final layout is never worse than the Phase 2D/2C baselines on multi-sheet batches", () => {
    for (const seed of [2001, 2002, 2003]) {
      const { optimizer } = runGroupedNesting(realisticBatch(20, seed));
      assert.ok(compareScores(optimizer.finalScore, optimizer.phase2dScore) <= 0);
      assert.ok(compareScores(optimizer.phase2dScore, optimizer.phase2cScore) <= 0);
    }
  });
});

describe("PHASE 2G TEST F — multi-sheet benchmark", () => {
  test("8/6/4 scenarios report sheet count and summed heights, not the tallest sheet", () => {
    const { scenarios } = runSpacingBenchmark(threeBigOrders());
    assert.deepEqual(scenarios.map((s) => s.orderGapMm), [8, 6, 4]);
    for (const s of scenarios) {
      assert.equal(s.sheetCount, s.result.summary.sheetCount);
      assert.equal(s.usedHeight, s.result.summary.sumUsedHeight);
      assert.equal(s.remainingFullWidthHeight, s.result.summary.totalRemainingFullWidthHeight);
      assert.equal(s.sideFragmentWidth, s.result.summary.totalSideFragmentWidth);
      assert.equal(s.overallMaterialUtilizationPercent, s.result.summary.overallMaterialUtilizationPercent);
      assert.ok(s.integrity.ok);
    }
    assert.equal(scenarios[0].sheetCount, 2);
    assert.equal(scenarios[0].usedHeight, 421 + 213);
  });

  test("manual multi-sheet comparison: sheets and total height", () => {
    assert.deepEqual(compareWithManualMultiSheet({ sheetCount: 2, sumUsedHeight: 634 }, { sheetCount: 2, totalUsedHeight: 600 }), {
      sheetDifference: 0,
      heightDifferenceMm: 34,
      heightDifferencePercent: (34 / 600) * 100,
    });
    assert.equal(compareWithManualMultiSheet({ sheetCount: 2, sumUsedHeight: 634 }, { sheetCount: NaN, totalUsedHeight: 600 }), null);
    assert.equal(compareWithManualMultiSheet({ sheetCount: 2, sumUsedHeight: 634 }, { sheetCount: 2, totalUsedHeight: NaN }), null);
  });
});

describe("PHASE 2G TEST G — preview partition", () => {
  test("each sheet's canvas gets only its own items and groups, nothing lost or duplicated", () => {
    const result = runGroupedNesting(realisticBatch(20, 2002));
    const partitions = partitionBySheet(result.items, result.groups, result.sheets);

    assert.equal(partitions.length, result.sheets.length);
    for (const partition of partitions) {
      assert.ok(partition.items.every((i) => i.sheetIndex === partition.sheetIndex));
      assert.ok(partition.groups.every((g) => g.sheetIndex === partition.sheetIndex));
      assert.equal(partition.metrics?.sheetIndex, partition.sheetIndex);
    }
    assert.equal(partitions.reduce((sum, p) => sum + p.items.length, 0), result.items.length);
    assert.equal(partitions.reduce((sum, p) => sum + p.groups.length, 0), result.groups.length);
  });
});

describe("PHASE 2G TEST H — group too large", () => {
  test("an order bigger than a whole sheet is reported unfit with a reason, never split, and others still place", () => {
    // 40 non-rotatable 90 x 60 items: > 216,000 mm² of items, far more than one 310 x 470 sheet.
    const huge = Array.from({ length: 40 }, (_, i) => item(i, 99, 90, 60));
    const items = [...huge, item(100, 1, 50, 20), item(101, 2, 40, 25)];

    const start = performance.now();
    const result = runGroupedNesting(items);
    assert.ok(performance.now() - start < 5000, "returns promptly");

    assert.equal(result.unfitGroups.length, 1);
    assert.deepEqual(
      { orderId: result.unfitGroups[0].orderId, reason: result.unfitGroups[0].reason, itemCount: result.unfitGroups[0].itemCount },
      { orderId: 99, reason: "ORDER_GROUP_TOO_LARGE_FOR_SHEET", itemCount: 40 }
    );
    assert.ok(result.warnings.some((w) => w.startsWith("ORDER_GROUP_TOO_LARGE_FOR_SHEET")));
    assert.equal(result.unfit.length, 40, "the whole order is unfit, not part of it");
    assert.ok(result.items.every((i) => i.orderId !== 99), "no piece of the huge order was placed");
    assert.deepEqual(result.groups.map((g) => g.orderId).sort(), [1, 2]);
    assert.equal(result.summary.totalUnfitItems, 40);
  });
});

describe("PHASE 2G TEST I — deterministic", () => {
  test("same input -> same sheet assignment, positions and metrics", () => {
    const summarize = (seed: number) => {
      const r = runGroupedNesting(realisticBatch(20, seed));
      return {
        sheets: r.sheets.map((s) => ({ ...s, groups: s.groups.map((g) => [g.orderId, g.x, g.y, g.candidate.candidateId]) })),
        summary: r.summary,
        metrics: r.metrics,
      };
    };
    assert.deepEqual(summarize(2003), summarize(2003));
  });
});

describe("PHASE 2G — preview header metrics", () => {
  /** Only the fields the header reads, taken straight from an engine result. */
  const headerOf = (result: ReturnType<typeof runGroupedNesting<Payload>>) =>
    new Map(
      buildHeaderMetrics({ metrics: result.metrics, summary: result.summary, unfitCount: result.unfit.length } as unknown as GroupedV2PreviewSheet).map(
        (line) => [line.label, line.value]
      )
    );

  test("1 sheet: the existing header, unchanged", () => {
    const result = runGroupedNesting(realisticBatch(5, 11));
    const header = headerOf(result);
    assert.deepEqual([...header.keys()], ["Mode", "Orders", "Items", "Unfit", "Used Width", "Used Height", "Utilization", "Waste"]);
    assert.equal(header.get("Used Height"), `${result.metrics.usedHeight.toFixed(1)} mm`);
    assert.equal(header.get("Utilization"), `${result.metrics.packingUtilizationPercent.toFixed(1)}%`);
  });

  test("2 sheets: Sum Used Height + material utilization over the fixed sheets, no generic Utilization/Waste", () => {
    const result = runGroupedNesting(threeBigOrders());
    const header = headerOf(result);

    for (const generic of ["Used Height", "Utilization", "Waste"]) assert.ok(!header.has(generic), `generic "${generic}" must not appear`);
    assert.equal(header.get("Sheet Count"), "2");

    const sum = result.sheets.reduce((total, sheet) => total + sheet.usedHeight, 0);
    assert.equal(sum, 421 + 213);
    assert.equal(header.get("Sum Used Height"), `${sum.toFixed(1)} mm`);

    const material = (result.summary.totalItemArea / (2 * SHEET_WIDTH_MM * SHEET_HEIGHT_MM)) * 100;
    assert.equal(header.get("Overall Material Utilization"), `${material.toFixed(1)}%`);
    assert.equal(header.get("Total Remaining Full-Width"), `${((470 - 421) + (470 - 213)).toFixed(1)} mm`);

    // The bounding-box ratio is still available, but only under its explicit diagnostic label.
    assert.equal(header.get("Bounding Utilization (Diagnostic)"), `${result.metrics.packingUtilizationPercent.toFixed(1)}%`);
    assert.notEqual(header.get("Bounding Utilization (Diagnostic)"), header.get("Overall Material Utilization"));
  });
});
