/**
 * PHASE 2C — inner-order candidate generation (grouped-nesting-candidates.ts).
 * Same runner as the Phase 2A/2B tests: `npm test` (node:test via tsx).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildInnerPackAttempts,
  generateOrderCandidates,
  maxGroupSize,
  MAX_INNER_CANDIDATE_ATTEMPTS,
  packOrderAttempt,
  pruneDominatedCandidates,
  shrinkWrapPlacements,
  type InnerPackConfig,
} from "./grouped-nesting-candidates";
import { runGroupedNesting } from "./grouped-nesting";
import type { GroupedNestingItem, GroupItemPlacement, OrderGroup, OrderLayoutCandidate } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

const CONFIG: InnerPackConfig = { sheetWidth: 310, sheetHeight: 470, partGapMm: 2, orderGapMm: 8, sheetMarginMm: 5 };

let nextId = 0;
function makeItem(orderId: number | null, width: number, height: number, allowRotation = true): GroupedNestingItem<Payload> {
  const id = nextId++;
  return { id, orderId, width, height, originalWidth: width, originalHeight: height, allowRotation, data: { name: `item-${id}` } };
}

/** Mirrors the long-strip keychain mix that exposed the Phase 2B whitespace (TEST-V2-A shape). */
function mixedStripOrder(orderId: number): OrderGroup<Payload> {
  const sizes: [number, number][] = [
    [80, 20], [80, 20], [80, 20], [78.3, 20], [75.9, 20], [65.7, 20],
    [54.1, 21.4], [57, 20], [57, 20], [53.6, 20], [47.9, 20],
  ];
  return { orderId, items: sizes.map(([w, h]) => makeItem(orderId, w, h)) };
}

function overlaps(a: GroupItemPlacement<Payload>, b: GroupItemPlacement<Payload>): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertValidCandidate(candidate: OrderLayoutCandidate<Payload>, group: OrderGroup<Payload>): void {
  assert.equal(candidate.placements.length, group.items.length, `${candidate.strategy}: every item placed exactly once`);
  assert.deepEqual(
    candidate.placements.map((p) => p.item.id).sort(),
    group.items.map((item) => item.id).sort(),
    `${candidate.strategy}: exactly this order's items, nothing else`
  );
  for (let i = 0; i < candidate.placements.length; i++) {
    const p = candidate.placements[i];
    assert.ok(p.x >= -1e-9 && p.y >= -1e-9, `${candidate.strategy}: normalized to (0,0)`);
    assert.ok(p.x + p.width <= candidate.width + 1e-9 && p.y + p.height <= candidate.height + 1e-9, `${candidate.strategy}: inside bounds`);
    const expected = p.rotated ? [p.item.height, p.item.width] : [p.item.width, p.item.height];
    assert.deepEqual([p.width, p.height], expected, `${candidate.strategy}: footprint matches rotated flag`);
    for (let j = i + 1; j < candidate.placements.length; j++) {
      assert.ok(!overlaps(p, candidate.placements[j]), `${candidate.strategy}: items ${i} and ${j} overlap`);
    }
  }
}

describe("PHASE 2C TEST A — shrink wrap", () => {
  test("a 300 mm local bin holding at most ~120 mm of items never reports a 300 mm group", () => {
    const group: OrderGroup<Payload> = { orderId: 1, items: [makeItem(1, 38, 20), makeItem(1, 38, 20), makeItem(1, 38, 20)] };

    for (const orientation of ["free", "landscape", "portrait"] as const) {
      const candidate = packOrderAttempt(group, CONFIG, { orientation, targetWidth: 300, label: orientation }, 0);
      assert.ok(candidate);
      // Even laid out in one row, 3 x 38 + 2 gaps = 118 mm is the most these items can span.
      assert.ok(candidate.width <= 118, `${orientation}: group width ${candidate.width} must come from item extent, not the bin`);
      assert.equal(candidate.width, Math.max(...candidate.placements.map((p) => p.x + p.width)));
      assert.equal(candidate.height, Math.max(...candidate.placements.map((p) => p.y + p.height)));
    }
  });

  test("shrinkWrapPlacements normalizes to (0,0) and measures only the used extent", () => {
    const item = makeItem(1, 10, 10);
    const wrapped = shrinkWrapPlacements([
      { item, x: 50, y: 70, width: 10, height: 10, rotated: false },
      { item, x: 62, y: 70, width: 10, height: 10, rotated: false },
    ]);
    assert.equal(wrapped.width, 22);
    assert.equal(wrapped.height, 10);
    assert.deepEqual(wrapped.placements.map((p) => [p.x, p.y]), [[0, 0], [12, 0]]);
  });
});

describe("PHASE 2C TEST B — multiple candidates", () => {
  test("a mixed-size order produces more than one unique Pareto candidate, within the attempt cap", () => {
    const group = mixedStripOrder(1);
    const attempts = buildInnerPackAttempts(group, CONFIG);
    const { candidates, selected } = generateOrderCandidates(group, CONFIG);

    assert.ok(attempts.length <= MAX_INNER_CANDIDATE_ATTEMPTS);
    assert.ok(candidates.length > 1, `expected >1 candidate, got ${candidates.length}`);
    const signatures = new Set(candidates.map((c) => `${c.width.toFixed(2)}x${c.height.toFixed(2)}`));
    assert.equal(signatures.size, candidates.length, "no duplicate dimensions survive");
    assert.ok(selected && candidates.includes(selected));
  });

  test("selected layout is never worse than the Phase 2A unbounded layout and fits the media", () => {
    const group = mixedStripOrder(1);
    const baseline = packOrderAttempt(group, CONFIG, { orientation: "free", targetWidth: null, label: "unbounded" }, 0);
    const { selected } = generateOrderCandidates(group, CONFIG);

    assert.ok(baseline && selected);
    assert.ok(selected.metrics.area <= baseline.metrics.area + 1e-6);
    const limit = maxGroupSize(CONFIG);
    assert.ok(selected.width <= limit.width && selected.height <= limit.height);
  });

  test("an order with a non-rotatable item only tries the as-is orientation", () => {
    const group: OrderGroup<Payload> = { orderId: 1, items: [makeItem(1, 40, 20), makeItem(1, 20, 50, false)] };
    const attempts = buildInnerPackAttempts(group, CONFIG);
    assert.ok(attempts.every((a) => a.orientation === "free"));
    for (const candidate of generateOrderCandidates(group, CONFIG).candidates) {
      assert.ok(candidate.placements.every((p) => !p.rotated), "no item may be rotated");
    }
  });
});

describe("PHASE 2C TEST C — dominance pruning", () => {
  function fake(width: number, height: number): OrderLayoutCandidate<Payload> {
    return {
      candidateId: `${width}x${height}`,
      orderId: 1,
      strategy: "fake",
      width,
      height,
      placements: [],
      metrics: { area: width * height, itemArea: 0, utilizationPercent: 0 },
    };
  }

  test("dominated candidates are dropped, distinct trade-offs are kept", () => {
    const wideShort = fake(100, 40);
    const balanced = fake(70, 60);
    const narrowTall = fake(40, 110);
    const dominated = fake(100, 60); // >= balanced on both axes, larger on width
    const dominatedTie = fake(70, 65); // same width as balanced, taller

    const kept = pruneDominatedCandidates([wideShort, dominated, balanced, dominatedTie, narrowTall]);
    assert.deepEqual(kept, [wideShort, balanced, narrowTall]);
  });
});

describe("PHASE 2C TEST D — no overlap", () => {
  test("every surviving candidate (not just the selected one) is a valid, overlap-free layout", () => {
    const groups = [
      mixedStripOrder(1),
      { orderId: 2, items: [makeItem(2, 26.2, 80), makeItem(2, 26.2, 80), makeItem(2, 26.2, 68), makeItem(2, 47.2, 26.2), makeItem(2, 80, 26.2)] },
      { orderId: 3, items: [makeItem(3, 60, 20), makeItem(3, 20, 20), makeItem(3, 45, 35), makeItem(3, 15, 50)] },
    ];
    for (const group of groups) {
      for (const candidate of generateOrderCandidates(group, CONFIG).candidates) {
        assertValidCandidate(candidate, group);
      }
    }
  });
});

describe("PHASE 2C TEST E — order integrity", () => {
  test("no cross-order placement in the selected layout or in any stored alternative", () => {
    const items = [...mixedStripOrder(10).items, makeItem(20, 30, 80), makeItem(20, 30, 80), makeItem(20, 50, 25), makeItem(30, 32, 80)];
    const result = runGroupedNesting(items);

    assert.equal(result.groups.length, 3);
    assert.equal(result.unfit.length, 0);
    for (const group of result.groups) {
      assert.ok(group.alternatives.includes(group.candidate));
      for (const item of group.items) assert.equal(item.orderId, group.orderId);
      for (const alternative of group.alternatives) {
        assert.equal(alternative.orderId, group.orderId);
        for (const placement of alternative.placements) assert.equal(placement.item.orderId, group.orderId);
      }
    }
  });
});

describe("PHASE 2C TEST F — deterministic", () => {
  test("identical input produces identical candidates and selection", () => {
    const build = () =>
      [[80, 20], [57, 20], [54.1, 21.4], [47.9, 20], [26.2, 80]].map(([w, h], i) => ({
        id: `item-${i}`,
        orderId: 7,
        width: w,
        height: h,
        originalWidth: w,
        originalHeight: h,
        allowRotation: true,
        data: { name: `item-${i}` },
      }));
    const summarize = (r: ReturnType<typeof generateOrderCandidates<Payload>>) => ({
      selected: r.selected?.candidateId,
      candidates: r.candidates.map((c) => ({
        id: c.candidateId,
        w: c.width,
        h: c.height,
        placements: c.placements.map((p) => [p.item.id, p.x, p.y, p.rotated]),
      })),
    });

    const a = generateOrderCandidates({ orderId: 7, items: build() }, CONFIG);
    const b = generateOrderCandidates({ orderId: 7, items: build() }, CONFIG);
    assert.deepEqual(summarize(a), summarize(b));
  });
});
