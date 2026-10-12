/**
 * V3 exact-fit safety of the free-rectangle carve (`cutFreeRect`,
 * `replayFreeRects`, slot reflow). The legacy/V2 packers are deliberately
 * NOT changed here. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cutFreeRect, packOuterRects, replayFreeRects, LEGACY_OUTER_STRATEGY } from "./outer-maxrects";
import { reflowOrderIntoSlot, hasItemCollision } from "./slot-reflow";
import { runGroupedNesting, resolveConfig } from "./grouped-nesting";
import { placeGroup, validateLayout } from "./grouped-nesting-v3";
import type { GroupedNestingItem } from "./grouped-nesting-types";

type Rect = { x: number; y: number; width: number; height: number };
const GAP = 8;
const overlapsNode = (f: Rect, r: Rect) => f.x < r.x + r.width + GAP && f.x + f.width > r.x && f.y < r.y + r.height + GAP && f.y + f.height > r.y;
const signature = (rects: Rect[]) =>
  rects
    .map((r) => `${r.x.toFixed(6)},${r.y.toFixed(6)},${r.width.toFixed(6)},${r.height.toFixed(6)}`)
    .sort()
    .join("|");

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

describe("V3 exact-fit — cutFreeRect", () => {
  test("1. a node exactly covering the free rect consumes it", () => {
    const free = { x: 8, y: 8, width: 108, height: 108 };
    assert.deepEqual(cutFreeRect(free, { ...free }), { kind: "FULLY_CONSUMED", pieces: [] });
    assert.equal(cutFreeRect(free, { x: 0, y: 0, width: 200, height: 200 }).kind, "FULLY_CONSUMED");
  });

  test("3. no overlap keeps the free rect", () => {
    const free = { x: 8, y: 8, width: 100, height: 100 };
    assert.deepEqual(cutFreeRect(free, { x: 108, y: 8, width: 50, height: 50 }), { kind: "NO_OVERLAP", pieces: [] });
  });

  test("4. partial overlap splits into the uncovered pieces", () => {
    const cut = cutFreeRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 20, y: 30, width: 40, height: 20 });
    assert.equal(cut.kind, "PARTIAL_OVERLAP");
    assert.deepEqual(signature(cut.pieces), signature([
      { x: 0, y: 0, width: 100, height: 30 },
      { x: 0, y: 50, width: 100, height: 50 },
      { x: 0, y: 0, width: 20, height: 100 },
      { x: 60, y: 0, width: 40, height: 100 },
    ]));
  });
});

describe("V3 exact-fit — replayFreeRects", () => {
  const boxedIn = { x: 8, y: 8, width: 100, height: 100 };
  const right = { x: 116, y: 8, width: 100, height: 100 };
  const below = { x: 8, y: 116, width: 208, height: 100 };

  test("1. a rect boxed in exactly by earlier neighbours leaves no phantom slot", () => {
    for (const order of [[boxedIn, right, below], [right, below, boxedIn]]) {
      const free = replayFreeRects(order, 300, 460, GAP);
      for (const r of order) assert.ok(!free.some((f) => overlapsNode(f, r)), "no free rect on an occupied node");
    }
  });

  test("2. realistic floating coordinates: no phantom slot, any replay order", () => {
    const occ = [
      { x: 8, y: 8, width: 161.85399999999998, height: 166.81500000000003 },
      { x: 8, y: 182.81500000000003, width: 137.745, height: 162.001 },
      { x: 177.85399999999998, y: 8, width: 89.198, height: 173.87 },
      { x: 153.745, y: 189.87, width: 124, height: 136.429 },
    ];
    const reference = signature(replayFreeRects(occ, 300, 460, GAP));
    for (const order of [occ.slice().reverse(), [occ[1], occ[2], occ[3], occ[0]], [occ[3], occ[0], occ[2], occ[1]]]) {
      const free = replayFreeRects(order, 300, 460, GAP);
      for (const r of occ) assert.ok(!free.some((f) => overlapsNode(f, r)));
      assert.equal(signature(free), reference, "replay is order independent");
    }
  });

  test("6. remove-K replay on real layouts never yields duplicate occupancy, in any order", () => {
    const config = resolveConfig({});
    for (const [orders, seed] of [[12, 7], [20, 2001]] as const) {
      const groups = runGroupedNesting(realisticBatch(orders, seed)).groups;
      const rects = groups.map((g) => ({ x: g.x - 5, y: g.y - 5, width: g.width, height: g.height, sheetIndex: g.sheetIndex }));
      for (let k = 2; k <= 3; k++) {
        for (let start = 0; start + k <= rects.length; start++) {
          const rest = rects.filter((_, i) => i < start || i >= start + k);
          for (const sheet of [...new Set(rest.map((r) => r.sheetIndex))]) {
            const occ = rest.filter((r) => r.sheetIndex === sheet);
            const pw = config.sheetWidth - 10;
            const ph = config.sheetHeight - 10;
            const forward = replayFreeRects(occ, pw, ph, GAP);
            const backward = replayFreeRects(occ.slice().reverse(), pw, ph, GAP);
            for (const r of occ) assert.ok(!forward.some((f) => overlapsNode(f, r)) && !backward.some((f) => overlapsNode(f, r)));
            assert.equal(signature(forward), signature(backward));
          }
        }
      }
    }
  });

  test("8. deterministic", () => {
    const occ = [right, below, boxedIn];
    assert.deepEqual(replayFreeRects(occ, 300, 460, GAP), replayFreeRects(occ, 300, 460, GAP));
  });
});

describe("V3 exact-fit — identical items", () => {
  const three = [0, 1, 2].map((i) => ({ width: 50, height: 50, data: i }));

  test("5. exact-fit-safe V2 packer never stacks two identical items on the same spot", () => {
    // Usable 104 x 52 holds exactly two 52 x 52 padded nodes.
    const placed = packOuterRects(three, 108, 56, 2, LEGACY_OUTER_STRATEGY, { exactFitSafe: true });
    const keys = placed.map((p) => `${p.sheetIndex}:${p.x},${p.y}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(placed.map((p) => p.sheetIndex), [0, 0, 1]);
  });

  test("5. slot reflow of identical items into an exact slot: no two items collide", () => {
    const items: GroupedNestingItem<{ n: number }>[] = [0, 1, 2, 3].map((i) => ({
      id: i, orderId: 1, width: 50, height: 50, originalWidth: 50, originalHeight: 50, allowRotation: true, data: { n: i },
    }));
    for (const [w, h] of [[102, 102], [206, 50], [50, 206], [102.000001, 102]]) {
      const { candidates } = reflowOrderIntoSlot(items, w, h, 2);
      assert.ok(candidates.length > 0, `${w}x${h} holds 4 items`);
      for (const c of candidates) {
        assert.equal(hasItemCollision(c.placements, 2), false);
        assert.equal(new Set(c.placements.map((p) => `${p.x},${p.y}`)).size, 4);
      }
    }
  });
});

describe("V3 exact-fit — validateLayout", () => {
  test("7. a deliberately overlapping layout is still rejected", () => {
    const config = resolveConfig({});
    const [g] = runGroupedNesting(realisticBatch(1, 3)).groups;
    const twin = placeGroup({ ...g.candidate, orderId: 999 }, g.x, g.y, g.sheetIndex, { alternatives: [], localCandidate: g.candidate });
    assert.ok(validateLayout([g, twin], config).some((v) => v.includes("ORDER_GAP")));
  });
});
