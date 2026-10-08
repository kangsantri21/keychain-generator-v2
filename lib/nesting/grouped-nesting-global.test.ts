/**
 * PHASE 2D — global candidate selection (grouped-nesting-global.ts).
 * Same runner as the Phase 2A/2B/2C tests: `npm test` (node:test via tsx).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compareScores,
  evaluateOuterLayout,
  selectGlobalCandidates,
  type GlobalOrderInput,
  type OuterPackConfig,
} from "./grouped-nesting-global";
import { runGroupedNesting } from "./grouped-nesting";
import type { GroupedNestingItem, OrderLayoutCandidate } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

/** Zero gaps/margins so the expected layouts below can be worked out by hand. */
const TIGHT: OuterPackConfig = { sheetWidth: 100, sheetHeight: 100, orderGapMm: 0, sheetMarginMm: 0 };

function fake(orderId: number, id: string, width: number, height: number): OrderLayoutCandidate<Payload> {
  return {
    candidateId: `${orderId}:${id}`,
    orderId,
    strategy: id,
    width,
    height,
    placements: [],
    metrics: { area: width * height, itemArea: 0, utilizationPercent: 0 },
  };
}

/** Deterministic LCG so synthetic batches are identical on every run (no Math.random). */
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

describe("PHASE 2D TEST A — global beats local", () => {
  test("picks the slightly larger shapes that fit together over the locally smallest ones", () => {
    // Locally smallest: A = 60x30, B = 30x60 (1800 mm² each) -> side by side 90x60 = 5400 mm².
    // Alternatives: 45x41 each (1845 mm²) -> side by side 90x41 = 3690 mm².
    const orders: GlobalOrderInput<Payload>[] = [
      { local: fake(1, "wide", 60, 30), alternatives: [fake(1, "wide", 60, 30), fake(1, "square", 45, 41)] },
      { local: fake(2, "tall", 30, 60), alternatives: [fake(2, "tall", 30, 60), fake(2, "square", 45, 41)] },
    ];

    const { selected, stats } = selectGlobalCandidates(orders, TIGHT);

    assert.equal(stats.baselineScore.boundingArea, 5400);
    assert.deepEqual(selected.map((c) => c.strategy), ["square", "square"]);
    assert.equal(stats.optimizedScore.boundingArea, 90 * 41);
    assert.equal(stats.usedBaseline, false);
    assert.ok(stats.improvementPercent > 30);
  });
});

describe("PHASE 2D TEST B — baseline fallback", () => {
  test("when no alternative helps, the Phase 2C selection is kept unchanged", () => {
    const orders: GlobalOrderInput<Payload>[] = [
      { local: fake(1, "best", 50, 20), alternatives: [fake(1, "best", 50, 20), fake(1, "worse", 60, 25)] },
      { local: fake(2, "best", 50, 20), alternatives: [fake(2, "best", 50, 20), fake(2, "worse", 55, 30)] },
    ];
    const { selected, stats } = selectGlobalCandidates(orders, TIGHT);

    assert.equal(stats.usedBaseline, true);
    assert.deepEqual(selected, orders.map((o) => o.local));
    assert.equal(stats.improvementPercent, 0);
  });

  test("across many synthetic batches the final layout is never scored worse than Phase 2C", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = runGroupedNesting(syntheticItems(2 + (seed % 9), seed));
      const config = { sheetWidth: 310, sheetHeight: 470, orderGapMm: 8, sheetMarginMm: 5 };
      const finalScore = evaluateOuterLayout(result.groups.map((g) => g.candidate), config).score;
      assert.ok(compareScores(finalScore, result.optimizer.baselineScore) <= 0, `seed ${seed}: worse than baseline`);
    }
  });
});

describe("PHASE 2D TEST C/D/E — integrity after global selection", () => {
  const result = runGroupedNesting(syntheticItems(12, 7));

  test("C — every item stays in its own order's group, and the chosen layout is one of that order's alternatives", () => {
    assert.equal(result.unfit.length, 0);
    for (const group of result.groups) {
      assert.ok(group.alternatives.includes(group.candidate));
      assert.ok(group.alternatives.includes(group.localCandidate));
      for (const item of group.items) assert.equal(item.orderId, group.orderId);
    }
    assert.equal(new Set(result.groups.map((g) => g.orderId)).size, result.groups.length, "one group per order");
  });

  test("D — group rectangles do not overlap on the same sheet", () => {
    for (let i = 0; i < result.groups.length; i++) {
      for (let j = i + 1; j < result.groups.length; j++) {
        const a = result.groups[i];
        const b = result.groups[j];
        if (a.sheetIndex !== b.sheetIndex) continue;
        assert.ok(!rectsOverlap(a, b), `groups ${a.orderId} and ${b.orderId} overlap`);
      }
    }
  });

  test("E — items inside every selected group do not overlap and sit inside the group", () => {
    for (const group of result.groups) {
      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        assert.ok(item.x >= group.x - 1e-9 && item.x + item.width <= group.x + group.width + 1e-9);
        assert.ok(item.y >= group.y - 1e-9 && item.y + item.height <= group.y + group.height + 1e-9);
        for (let j = i + 1; j < group.items.length; j++) assert.ok(!rectsOverlap(item, group.items[j]));
      }
    }
  });
});

describe("PHASE 2D TEST F — deterministic", () => {
  test("same input -> same candidates, positions and metrics", () => {
    const summarize = (r: ReturnType<typeof runGroupedNesting<Payload>>) => ({
      groups: r.groups.map((g) => [g.orderId, g.candidate.candidateId, g.x, g.y, g.sheetIndex]),
      metrics: r.metrics,
      optimizer: r.optimizer,
    });
    assert.deepEqual(summarize(runGroupedNesting(syntheticItems(15, 3))), summarize(runGroupedNesting(syntheticItems(15, 3))));
  });
});

describe("PHASE 2D TEST G — beam bound", () => {
  test("states evaluated never exceed the configured limit", () => {
    const limits = { beamWidth: 64, maxCandidatesPerOrder: 12, maxStatesEvaluated: 40 };
    const result = runGroupedNesting(syntheticItems(20, 11), {}, limits);
    assert.ok(result.optimizer.statesEvaluated <= limits.maxStatesEvaluated, `${result.optimizer.statesEvaluated} > 40`);
    assert.ok(result.optimizer.effectiveBeamWidth <= limits.beamWidth);
  });

  test("a tiny budget still returns a complete, valid layout", () => {
    const limits = { beamWidth: 4, maxCandidatesPerOrder: 3, maxStatesEvaluated: 5 };
    const items = syntheticItems(8, 5);
    const result = runGroupedNesting(items, {}, limits);
    assert.ok(result.optimizer.statesEvaluated <= 5);
    assert.equal(result.items.length + result.unfit.length, items.length);
  });
});

describe("PHASE 2D TEST H — many orders", () => {
  test("100 synthetic orders finish quickly within the default evaluation budget", () => {
    const items = syntheticItems(100, 99);
    const start = performance.now();
    const result = runGroupedNesting(items);
    const elapsedMs = performance.now() - start;

    assert.ok(elapsedMs < 5000, `took ${elapsedMs.toFixed(0)} ms`);
    assert.ok(result.optimizer.statesEvaluated <= 3000);
    assert.equal(result.groups.length, 100);
    assert.equal(result.unfit.length, 0);
  });
});
