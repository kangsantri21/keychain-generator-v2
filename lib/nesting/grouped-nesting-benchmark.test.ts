/**
 * PHASE 2F — spacing benchmark (grouped-nesting-benchmark.ts) and the
 * manual-comparison helper (grouped-nesting-preview.ts). `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BENCHMARK_ORDER_GAPS_MM,
  checkLayoutIntegrity,
  isSpacingBenchmarkRequest,
  recommendSpacing,
  runSpacingBenchmark,
} from "./grouped-nesting-benchmark";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM } from "./grouped-nesting-config";
import { runGroupedNesting } from "./grouped-nesting";
import { compareWithManualHeight } from "./grouped-nesting-preview";
import type { GroupedNestingItem } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

/**
 * Deterministic (LCG, no Math.random) batch mixing what real keychain
 * orders look like: small (1-2 names) and big (6-12 names) orders, short
 * names (~30-45 mm wide) and long names (~70-95 mm), 18-26 mm tall, plus
 * some tall character templates (~26 x 80 mm).
 */
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
        const longName = rnd() < 0.45;
        width = longName ? 70 + rnd() * 25 : 30 + rnd() * 15;
        height = 18 + rnd() * 8;
      }
      items.push({ id: id++, orderId: order, width, height, originalWidth: width, originalHeight: height, allowRotation: true, data: { name: `${order}-${i}` } });
    }
  }
  return items;
}

describe("PHASE 2F TEST A — spacing override", () => {
  test("scenarios run at exactly 8 / 6 / 4 mm and the override actually reaches the layout", () => {
    const items = realisticBatch(10, 5);
    const { scenarios } = runSpacingBenchmark(items);

    assert.deepEqual(scenarios.map((s) => s.orderGapMm), [8, 6, 4]);
    for (const s of scenarios) {
      assert.equal(s.partGapMm, PART_GAP_MM, "part gap unchanged");
      assert.equal(s.sheetMarginMm, SHEET_MARGIN_MM, "sheet margin unchanged");
      assert.equal(s.edgeClearanceMm, SHEET_MARGIN_MM + s.orderGapMm);
      // Nearest group to the media edge sits exactly margin + gap in.
      const minX = Math.min(...s.result.groups.map((g) => g.x));
      const minY = Math.min(...s.result.groups.map((g) => g.y));
      assert.equal(minX, SHEET_MARGIN_MM + s.orderGapMm);
      assert.equal(minY, SHEET_MARGIN_MM + s.orderGapMm);
    }
  });

  test("benchmark is opt-in only for an explicit grouped-v2 + benchmark:true request", () => {
    assert.equal(isSpacingBenchmarkRequest({ mode: "grouped-v2", benchmark: true }), true);
    assert.equal(isSpacingBenchmarkRequest({ mode: "grouped-v2" }), false);
    assert.equal(isSpacingBenchmarkRequest({ mode: "grouped-v2", benchmark: "true" }), false);
    assert.equal(isSpacingBenchmarkRequest({ benchmark: true }), false, "never for legacy");
    assert.equal(isSpacingBenchmarkRequest(null), false);
  });
});

describe("PHASE 2F TEST B — default preservation", () => {
  test("production default stays 8 mm and a normal run equals the 8 mm scenario", () => {
    assert.equal(ORDER_GAP_MM, 8);
    assert.equal(BENCHMARK_ORDER_GAPS_MM[0], 8, "first scenario is the production default");

    const items = realisticBatch(8, 2);
    const normal = runGroupedNesting(items);
    const { scenarios, recommendation } = runSpacingBenchmark(items);

    assert.deepEqual(normal.metrics, scenarios[0].result.metrics);
    assert.deepEqual(
      normal.groups.map((g) => [g.orderId, g.x, g.y]),
      scenarios[0].result.groups.map((g) => [g.orderId, g.x, g.y])
    );
    assert.equal(recommendation.productionDefaultOrderGapMm, 8);
    // Running the benchmark must not leak into later normal runs.
    assert.deepEqual(runGroupedNesting(items).metrics, normal.metrics);
    assert.equal(Math.min(...runGroupedNesting(items).groups.map((g) => g.x)), SHEET_MARGIN_MM + 8);
  });
});

describe("PHASE 2F TEST C — no overlap in any spacing scenario", () => {
  test("integrity check passes for every gap across several realistic batches", () => {
    for (const [orders, seed] of [[5, 1], [10, 2], [20, 3], [12, 9]] as const) {
      for (const s of runSpacingBenchmark(realisticBatch(orders, seed)).scenarios) {
        assert.ok(s.integrity.ok, `${orders} orders seed ${seed} gap ${s.orderGapMm}: ${s.integrity.violations.join("; ")}`);
      }
    }
  });

  test("the integrity check itself catches a group placed closer than the gap", () => {
    const result = runGroupedNesting(realisticBatch(3, 4));
    assert.ok(checkLayoutIntegrity(result, 8).ok);
    const [a, b] = result.groups;
    const moved = { ...result, groups: [a, { ...b, x: a.x + a.width + 3, y: a.y }, ...result.groups.slice(2)] };
    assert.equal(checkLayoutIntegrity(moved, 8).ok, false);
  });
});

describe("PHASE 2F TEST D — deterministic", () => {
  test("the same scenarios produce identical results", () => {
    const summarize = (items: GroupedNestingItem<Payload>[]) => {
      const { scenarios, recommendation } = runSpacingBenchmark(items);
      return {
        recommendation,
        scenarios: scenarios.map((s) => ({
          gap: s.orderGapMm,
          metrics: s.result.metrics,
          optimizer: s.result.optimizer,
          groups: s.result.groups.map((g) => [g.orderId, g.candidate.candidateId, g.x, g.y]),
        })),
      };
    };
    assert.deepEqual(summarize(realisticBatch(10, 7)), summarize(realisticBatch(10, 7)));
  });
});

describe("PHASE 2F TEST E — benchmark isolation", () => {
  test("the benchmark module is pure: no DB/IO imports, input items untouched", () => {
    const source = readFileSync(fileURLToPath(new URL("./grouped-nesting-benchmark.ts", import.meta.url)), "utf8");
    assert.ok(!/from\s+["']@\/lib\/db|drizzle|stagingItems|better-sqlite3|node:fs/.test(source), "no persistence imports");

    const items = realisticBatch(6, 3);
    const snapshot = JSON.stringify(items);
    runSpacingBenchmark(items);
    assert.equal(JSON.stringify(items), snapshot);
  });

  test("in the API route the benchmark runs inside the dry-run grouped-v2 branch, before any DB write", () => {
    const route = readFileSync(fileURLToPath(new URL("../../app/api/staging/nest/route.ts", import.meta.url)), "utf8");
    const benchmarkAt = route.indexOf("runSpacingBenchmark(");
    const branchReturnAt = route.indexOf("return NextResponse.json({", benchmarkAt);
    const firstInsertAt = route.indexOf("db.insert(stagingItems)");
    const firstStatusUpdateAt = route.indexOf("db.update(orders)");
    assert.ok(benchmarkAt > route.indexOf('resolveNestingMode(body) === "grouped-v2"'), "inside the grouped-v2 branch");
    assert.ok(branchReturnAt > benchmarkAt && branchReturnAt < firstInsertAt && branchReturnAt < firstStatusUpdateAt, "returns before any write");
  });
});

describe("PHASE 2F TEST F — manual comparison formula", () => {
  test("difference mm and % follow (app - manual) / manual * 100", () => {
    assert.deepEqual(compareWithManualHeight(210, 200), { differenceMm: 10, differencePercent: 5 });
    assert.deepEqual(compareWithManualHeight(190, 200), { differenceMm: -10, differencePercent: -5 });
    const r = compareWithManualHeight(208.4, 215.2)!;
    assert.ok(Math.abs(r.differenceMm - -6.8) < 1e-9);
    assert.ok(Math.abs(r.differencePercent - (-6.8 / 215.2) * 100) < 1e-9);
  });

  test("an empty or invalid manual value yields no comparison instead of a bogus number", () => {
    assert.equal(compareWithManualHeight(200, NaN), null);
    assert.equal(compareWithManualHeight(200, 0), null);
    assert.equal(compareWithManualHeight(200, -5), null);
  });
});

describe("PHASE 2F TEST G — scale", () => {
  for (const orders of [5, 10, 20]) {
    test(`${orders} realistic orders: all three scenarios finish, valid, bounded`, () => {
      const items = realisticBatch(orders, orders * 31);
      const start = performance.now();
      const { scenarios, recommendation } = runSpacingBenchmark(items);
      const elapsedMs = performance.now() - start;

      assert.ok(elapsedMs < 10000, `took ${elapsedMs.toFixed(0)} ms`);
      for (const s of scenarios) {
        assert.equal(s.result.groups.length + new Set(s.result.unfit.map((u) => u.orderId)).size, orders);
        assert.ok(s.result.optimizer.outerPackAttempts <= 12000);
        assert.ok(s.integrity.ok);
      }
      assert.ok(BENCHMARK_ORDER_GAPS_MM.includes(recommendation.recommendedOrderGapMm as 8 | 6 | 4));
    });
  }
});

describe("PHASE 2F — recommendation rules", () => {
  test("keeps the default when smaller gaps do not lower used height, prefers the larger gap on ties", () => {
    const fake = (orderGapMm: number, usedHeight: number, ok = true) =>
      ({
        orderGapMm,
        usedHeight,
        edgeClearanceMm: SHEET_MARGIN_MM + orderGapMm,
        heightSavedVsDefaultMm: 200 - usedHeight,
        heightSavedVsDefaultPercent: ((200 - usedHeight) / 200) * 100,
        sheetCount: 1,
        integrity: { ok, violations: [] },
        result: { unfit: [] },
      }) as never;
    assert.equal(recommendSpacing([fake(8, 200), fake(6, 200), fake(4, 200)]).recommendedOrderGapMm, 8);
    assert.equal(recommendSpacing([fake(8, 200), fake(6, 190), fake(4, 190)]).recommendedOrderGapMm, 6);
    assert.equal(recommendSpacing([fake(8, 200), fake(6, 195), fake(4, 180, false)]).recommendedOrderGapMm, 6, "invalid scenario never recommended");
  });
});
