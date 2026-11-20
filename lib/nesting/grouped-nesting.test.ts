/**
 * Deterministic tests for Grouped Nesting V2 (Phase 2A) — run via Node's
 * built-in test runner (`node:test`/`node:assert/strict`), zero new
 * dependencies (this project has no test framework installed at all — see
 * the PHASE 1 audit). Run with:
 *
 *   npx tsx --test lib/nesting/grouped-nesting.test.ts
 *
 * or via the "test" script added to package.json.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGroupedNesting, groupItemsByOrder } from "./grouped-nesting";
import type { GroupedNestingItem, GroupedPackedRect } from "./grouped-nesting-types";

interface Payload {
  name: string;
}

let nextId = 0;
function makeItem(orderId: number | null, width: number, height: number, allowRotation = true): GroupedNestingItem<Payload> {
  const id = nextId++;
  return {
    id,
    orderId,
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    allowRotation,
    data: { name: `item-${id}` },
  };
}

/** True area overlap (touching edges are NOT an overlap — matches how a packer's own padding/gap keeps neighbors apart). */
function rectsOverlap(a: GroupedPackedRect<Payload>, b: GroupedPackedRect<Payload>): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertNoOverlaps(items: GroupedPackedRect<Payload>[]): void {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      assert.ok(!rectsOverlap(items[i], items[j]), `items ${i} and ${j} overlap: ${JSON.stringify(items[i])} vs ${JSON.stringify(items[j])}`);
    }
  }
}

describe("groupItemsByOrder", () => {
  test("groups items by orderId, preserving order", () => {
    const items = [makeItem(1, 10, 10), makeItem(2, 10, 10), makeItem(1, 10, 10)];
    const { groups, warnings } = groupItemsByOrder(items);
    assert.equal(groups.length, 2);
    assert.equal(warnings.length, 0);
    const groupA = groups.find((g) => g.orderId === 1)!;
    assert.equal(groupA.items.length, 2);
  });
});

describe("TEST A — two orders, 3 items each", () => {
  test("items stay grouped by order, no cross-order or intra/inter-group overlap", () => {
    const items = [
      makeItem(101, 40, 20),
      makeItem(101, 35, 22),
      makeItem(101, 50, 18),
      makeItem(202, 30, 25),
      makeItem(202, 45, 20),
      makeItem(202, 28, 30),
    ];

    const result = runGroupedNesting(items);

    assert.equal(result.metrics.totalOrders, 2, "expected exactly 2 groups");
    assert.equal(result.groups.length, 2, "both groups must have been placed");
    assert.equal(result.unfit.length, 0);

    for (const group of result.groups) {
      assert.equal(group.items.length, 3, `group for order ${group.orderId} should have all 3 of its own items`);
      for (const item of group.items) {
        assert.equal(item.orderId, group.orderId, "no cross-order placement: every item in a group must report that group's own orderId");
      }
    }

    // No overlap within a group.
    for (const group of result.groups) {
      assertNoOverlaps(group.items);
    }

    // No overlap across groups either (the actual point of Phase 2A).
    assertNoOverlaps(result.items);
  });
});

describe("TEST B — one order, mixed item sizes", () => {
  test("all items placed, valid group bounds, no overlap", () => {
    const items = [makeItem(5, 60, 20), makeItem(5, 20, 20), makeItem(5, 45, 35), makeItem(5, 15, 50)];
    const result = runGroupedNesting(items);

    assert.equal(result.groups.length, 1);
    assert.equal(result.unfit.length, 0);

    const group = result.groups[0];
    assert.equal(group.items.length, 4);
    assert.ok(group.width > 0 && Number.isFinite(group.width));
    assert.ok(group.height > 0 && Number.isFinite(group.height));

    assertNoOverlaps(group.items);
  });
});

describe("TEST C — ten small orders", () => {
  test("group count stays 10 and all fit when the media is large enough", () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(1000 + i, 20, 15));
    const result = runGroupedNesting(items);

    assert.equal(result.metrics.totalOrders, 10);
    assert.equal(result.groups.length, 10, "all 10 tiny orders should fit on the default sheet");
    assert.equal(result.unfit.length, 0);
    assertNoOverlaps(result.items);
  });

  test("identical input produces an identical (deterministic) result", () => {
    const buildItems = () => [
      { orderId: 1, w: 30, h: 20 },
      { orderId: 2, w: 25, h: 25 },
      { orderId: 3, w: 40, h: 15 },
    ].map(({ orderId, w, h }) => ({
      id: `order-${orderId}`,
      orderId,
      width: w,
      height: h,
      originalWidth: w,
      originalHeight: h,
      allowRotation: true,
      data: { name: `order-${orderId}` } as Payload,
    }));

    const resultA = runGroupedNesting(buildItems());
    const resultB = runGroupedNesting(buildItems());

    assert.deepEqual(
      resultA.groups.map((g) => ({ orderId: g.orderId, x: g.x, y: g.y, width: g.width, height: g.height })),
      resultB.groups.map((g) => ({ orderId: g.orderId, x: g.x, y: g.y, width: g.width, height: g.height }))
    );
    assert.deepEqual(resultA.metrics, resultB.metrics);
  });
});

describe("TEST D — missing orderId", () => {
  test("orphaned items are isolated into their own groups, never merged with each other or a real order", () => {
    const items = [
      makeItem(1, 30, 20),
      makeItem(null, 20, 20),
      makeItem(null, 22, 18),
      makeItem(2, 25, 25),
    ];

    const { groups, warnings } = groupItemsByOrder(items);

    assert.equal(groups.length, 4, "2 real orders + 2 isolated orphan groups = 4 groups total");
    assert.ok(warnings.length > 0, "a missing-orderId situation must surface an explicit warning, never pass silently");

    const orphanGroups = groups.filter((g) => g.orderId === null);
    assert.equal(orphanGroups.length, 2, "each orphaned item gets its OWN group");
    for (const orphan of orphanGroups) {
      assert.equal(orphan.items.length, 1, "an orphan group must never absorb more than the one item that produced it");
    }

    const result = runGroupedNesting(items);
    assert.equal(result.metrics.totalOrders, 4);
    assertNoOverlaps(result.items);
  });
});

describe("TEST E — item larger than the media", () => {
  test("returns a clear warning/unfit entry instead of crashing or looping forever", () => {
    const items = [
      makeItem(1, 20, 20),
      makeItem(2, 5000, 5000, false), // far bigger than the sheet in any orientation, rotation off too
    ];

    const start = Date.now();
    const result = runGroupedNesting(items);
    const elapsedMs = Date.now() - start;

    assert.ok(elapsedMs < 5000, "must return promptly, not hang");
    assert.equal(result.unfit.length, 1, "the oversized item must be reported as unfit");
    assert.equal(result.unfit[0].orderId, 2);
    assert.ok(
      result.warnings.some((w) => w.includes("tidak muat")),
      "an oversized item must produce a clear, human-readable warning"
    );
    // The item that DOES fit must still have been placed normally.
    assert.equal(result.groups.length, 1);
    assert.equal(result.groups[0].orderId, 1);
  });
});
