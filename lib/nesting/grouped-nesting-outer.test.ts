/**
 * PHASE 2E — multi-heuristic outer packing (outer-maxrects.ts +
 * grouped-nesting-outer.ts). Same runner as the earlier phases: `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { packMaxRects } from "@/lib/nesting";
import { packOuterRects, LEGACY_OUTER_STRATEGY, OUTER_PACKING_STRATEGIES } from "./outer-maxrects";
import { optimizeOuterLayout, packSelection, DEFAULT_OUTER_PACKING_LIMITS } from "./grouped-nesting-outer";
import { compareScores, scoreOuterPlacements, type GlobalOrderInput, type OuterPackConfig } from "./grouped-nesting-global";
import { runGroupedNesting } from "./grouped-nesting";
import type { GroupedNestingItem, OrderLayoutCandidate } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

/** Zero gaps/margins so expected layouts can be worked out by hand. */
const TIGHT: OuterPackConfig = { sheetWidth: 100, sheetHeight: 100, orderGapMm: 0, sheetMarginMm: 0 };

/** One fixed-shape order per rect: only the outer strategy can change the layout. */
function fixedOrders(sizes: [number, number][]): GlobalOrderInput<Payload>[] {
  return sizes.map(([width, height], index) => {
    const candidate: OrderLayoutCandidate<Payload> = {
      candidateId: `${index + 1}:only`,
      orderId: index + 1,
      strategy: "only",
      width,
      height,
      placements: [],
      metrics: { area: width * height, itemArea: width * height, utilizationPercent: 100 },
    };
    return { local: candidate, alternatives: [candidate] };
  });
}

function scoreWith(orders: GlobalOrderInput<Payload>[], strategyId: string) {
  const strategy = OUTER_PACKING_STRATEGIES.find((s) => s.id === strategyId)!;
  return scoreOuterPlacements(packSelection(orders.map((o) => o.local), TIGHT, strategy), orders.length, TIGHT.sheetWidth);
}

/** Deterministic LCG — no Math.random. */
function syntheticItems(orderCount: number, seed: number): GroupedNestingItem<Payload>[] {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const items: GroupedNestingItem<Payload>[] = [];
  let id = 0;
  for (let order = 1; order <= orderCount; order++) {
    const count = 1 + Math.floor(rnd() * 8);
    for (let i = 0; i < count; i++) {
      const width = 40 + rnd() * 40;
      const height = 18 + rnd() * 10;
      items.push({ id: id++, orderId: order, width, height, originalWidth: width, originalHeight: height, allowRotation: true, data: { name: `${order}-${i}` } });
    }
  }
  return items;
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("PHASE 2E — V2 packer parity", () => {
  test("BSSF + AREA_DESC reproduces legacy packMaxRects placement-for-placement, multi-sheet included", () => {
    let state = 7;
    const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 100; trial++) {
      const rects = Array.from({ length: 1 + Math.floor(rnd() * 40) }, (_, i) => ({
        width: Math.round(10 + rnd() * 150),
        height: Math.round(10 + rnd() * 150),
        data: i,
      }));
      const legacy = packMaxRects(rects, 300, 460, 8, 8, false).map((p) => [p.data, p.x, p.y, p.width, p.height, p.sheetIndex]);
      const v2 = packOuterRects(rects, 300, 460, 8, LEGACY_OUTER_STRATEGY).map((p) => [p.data, p.x, p.y, p.width, p.height, p.sheetIndex]);
      assert.deepEqual(v2, legacy, `trial ${trial}`);
    }
  });
});

describe("PHASE 2E TEST A — heuristic difference", () => {
  test("picks the placement heuristic that beats legacy BSSF on the same sort", () => {
    // AREA_DESC both times: BSSF ends at 100x90, Bottom-Left at 100x70.
    const orders = fixedOrders([[40, 70], [60, 20], [40, 20]]);
    const legacy = scoreWith(orders, "BSSF/AREA_DESC");
    const bottomLeft = scoreWith(orders, "BL/AREA_DESC");
    assert.equal(legacy.boundingArea, 9000);
    assert.equal(bottomLeft.boundingArea, 7000);

    const { strategy, stats } = optimizeOuterLayout(orders, TIGHT);
    assert.notEqual(strategy.id, LEGACY_OUTER_STRATEGY.id);
    assert.ok(stats.finalScore.boundingArea <= 7000);
    assert.equal(compareScores(stats.finalScore, scoreWith(orders, strategy.id)), 0, "reported score is the chosen strategy's own");
    assert.ok(stats.improvementVsPhase2DPercent > 0);
  });
});

describe("PHASE 2E TEST B — sorting matters", () => {
  const orders = fixedOrders([[30, 20], [20, 10], [10, 30]]);

  test("with the heuristic pinned to BSSF, the sort order alone decides — the lowest layout wins", () => {
    // BSSF: AREA_DESC ends 30x60, HEIGHT_DESC 30x50, WIDTH_DESC 60x30.
    assert.equal(scoreWith(orders, "BSSF/AREA_DESC").usedHeight, 60);
    assert.equal(scoreWith(orders, "BSSF/HEIGHT_DESC").usedHeight, 50);
    assert.equal(scoreWith(orders, "BSSF/WIDTH_DESC").usedHeight, 30);

    const bssfOnly = { ...DEFAULT_OUTER_PACKING_LIMITS, maxOuterStrategies: 1 };
    const { strategy, stats } = optimizeOuterLayout(orders, TIGHT, undefined, bssfOnly);
    assert.equal(strategy.id, "BSSF/WIDTH_DESC");
    assert.equal(stats.finalScore.usedHeight, 30);
  });

  test("unrestricted, the result is the best any heuristic x sort pair can do", () => {
    // Several pairs reach height 30; among those BAF/AREA_DESC (40x30 = 1200 mm²) has the least area.
    const { stats } = optimizeOuterLayout(orders, TIGHT);
    assert.equal(stats.finalScore.boundingArea, 1200);
    for (const s of OUTER_PACKING_STRATEGIES) assert.ok(compareScores(stats.finalScore, scoreWith(orders, s.id)) <= 0, s.id);
  });
});

describe("PHASE 2E TEST C — fallback", () => {
  test("when no strategy beats legacy, the Phase 2D/2C layout and legacy strategy are kept", () => {
    const orders = fixedOrders([[50, 50], [50, 50], [50, 50], [50, 50]]); // a perfect 2x2 tile under every strategy
    const { selected, strategy, stats } = optimizeOuterLayout(orders, TIGHT);
    assert.equal(strategy.id, LEGACY_OUTER_STRATEGY.id);
    assert.equal(stats.candidateSource, "phase2c");
    assert.deepEqual(selected, orders.map((o) => o.local));
    assert.equal(stats.improvementVsPhase2DPercent, 0);
  });

  test("across synthetic batches the final layout never scores worse than Phase 2D or 2C", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const result = runGroupedNesting(syntheticItems(2 + (seed % 9), seed));
      const actual = scoreOuterPlacements(
        result.groups.map((g) => ({ x: g.x - 5, y: g.y - 5, width: g.width, height: g.height, sheetIndex: g.sheetIndex })),
        result.groups.length + result.unfit.length,
        310 - 2 * 5
      );
      assert.equal(compareScores(actual, result.optimizer.finalScore), 0, `seed ${seed}: placed layout matches the reported score`);
      assert.ok(compareScores(actual, result.optimizer.phase2dScore) <= 0, `seed ${seed}: worse than 2D`);
      assert.ok(compareScores(result.optimizer.phase2dScore, result.optimizer.phase2cScore) <= 0, `seed ${seed}: 2D worse than 2C`);
    }
  });
});

describe("PHASE 2E TEST D/E — integrity under non-legacy strategies", () => {
  test("D — no group overlap and E — no cross-order placement, for every seed", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const items = syntheticItems(4 + (seed % 10), seed * 13);
      const result = runGroupedNesting(items);
      assert.equal(result.items.length + result.unfit.length, items.length);

      for (let i = 0; i < result.groups.length; i++) {
        const group = result.groups[i];
        for (const item of group.items) {
          assert.equal(item.orderId, group.orderId, "cross-order placement");
          assert.ok(item.x >= group.x - 1e-9 && item.x + item.width <= group.x + group.width + 1e-9, "item outside its group");
          assert.ok(item.y >= group.y - 1e-9 && item.y + item.height <= group.y + group.height + 1e-9, "item outside its group");
        }
        for (let j = i + 1; j < result.groups.length; j++) {
          const other = result.groups[j];
          if (group.sheetIndex === other.sheetIndex) assert.ok(!rectsOverlap(group, other), `seed ${seed}: groups overlap`);
        }
      }
      assert.equal(new Set(result.groups.map((g) => g.orderId)).size, result.groups.length, "one group per order");
    }
  });
});

describe("PHASE 2E TEST F — deterministic", () => {
  test("same input -> same strategy, sort, candidates, positions and metrics", () => {
    const summarize = (r: ReturnType<typeof runGroupedNesting<Payload>>) => ({
      strategy: [r.optimizer.selectedHeuristic, r.optimizer.selectedSort, r.optimizer.candidateSource],
      groups: r.groups.map((g) => [g.orderId, g.candidate.candidateId, g.x, g.y, g.sheetIndex]),
      items: r.items.map((i) => [i.x, i.y, i.rotated]),
      metrics: r.metrics,
      optimizer: r.optimizer,
    });
    assert.deepEqual(summarize(runGroupedNesting(syntheticItems(12, 21))), summarize(runGroupedNesting(syntheticItems(12, 21))));
  });
});

describe("PHASE 2E TEST G — budget", () => {
  test("outer pack attempts never exceed maxTotalPackEvaluations", () => {
    for (const maxTotalPackEvaluations of [1, 5, 60, 400]) {
      const limits = { ...DEFAULT_OUTER_PACKING_LIMITS, maxTotalPackEvaluations };
      const items = syntheticItems(15, 4);
      const result = runGroupedNesting(items, {}, undefined, limits);
      assert.ok(result.optimizer.outerPackAttempts <= maxTotalPackEvaluations, `${result.optimizer.outerPackAttempts} > ${maxTotalPackEvaluations}`);
      assert.equal(result.items.length + result.unfit.length, items.length, "still a complete layout");
    }
  });

  test("per-state attempts respect maxOuterAttemptsPerState and the strategy/sort caps", () => {
    const limits = { ...DEFAULT_OUTER_PACKING_LIMITS, maxOuterStrategies: 2, maxSortVariants: 2, maxOuterAttemptsPerState: 3, maxTotalPackEvaluations: 12000 };
    const result = runGroupedNesting(syntheticItems(6, 8), {}, undefined, limits);
    assert.equal(result.optimizer.strategiesTried, 4);
    assert.ok(result.optimizer.attemptsPerState <= 3);
    assert.ok(["BSSF", "BAF"].includes(result.optimizer.selectedHeuristic));
    assert.ok(["AREA_DESC", "HEIGHT_DESC"].includes(result.optimizer.selectedSort));
  });
});

describe("PHASE 2E TEST H — many orders", () => {
  test("100 synthetic orders finish quickly within the default pack budget", () => {
    const start = performance.now();
    const result = runGroupedNesting(syntheticItems(100, 99));
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 10000, `took ${elapsedMs.toFixed(0)} ms`);
    assert.ok(result.optimizer.outerPackAttempts <= DEFAULT_OUTER_PACKING_LIMITS.maxTotalPackEvaluations);
    assert.equal(result.groups.length, 100);
    assert.equal(result.unfit.length, 0);
  });
});
