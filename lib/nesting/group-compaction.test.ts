/**
 * Production group compaction (group-compaction.ts): receipts slide left/up
 * as rigid blocks to the minimum gaps (x 2, y 8). `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FIDUCIAL_CLEARANCE_MM, ORDER_GAP_MM, PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, outerSpacing } from "./grouped-nesting-config";
import { fiducialDistance, receiptBoxes, summarizeSheet, validatePlacedSheets } from "@/lib/production-gate";
import { compactRigidRects, PRODUCTION_COMPACTION_BOUNDS, type RigidRect } from "./group-compaction";
import { compactionTags } from "@/lib/staging-overlay";
import { resolveConfig } from "./grouped-nesting";
import { runGroupedNestingV3 } from "./grouped-nesting-v3";
import { compoundStage } from "./grouped-nesting-v3-compound";
import { regionStage } from "./grouped-nesting-v3-region";
import { PRODUCTION_SPACING_OVERRIDES, runProductionNesting } from "./production-nesting";
import { realBatch5Orders } from "./test-fixtures/real-batch-5-orders";
import { realBatch8Orders } from "./test-fixtures/real-batch-8-orders";
import { STAGING_BATCH_RECEIPT_CODES, stagingBatch5Orders } from "./test-fixtures/staging-batch-5-orders";

const B = PRODUCTION_COMPACTION_BOUNDS;
const EPS = 1e-6;
const rect = (key: number, x: number, y: number, w: number, h: number, sheet = 0): RigidRect => ({ key, sheet, x, y, w, h });
const byKey = (rects: RigidRect[], key: number) => rects.find((r) => r.key === key)!;

/** Every pair on a sheet keeps the Production receipt gap: x >= 2 side by side or y >= 2 stacked. */
function assertSpaced(rects: RigidRect[]) {
  for (const a of rects) {
    for (const b of rects) {
      if (a.key >= b.key || a.sheet !== b.sheet) continue;
      const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      assert.ok(dx >= PRODUCTION_GROUP_GAP_X_MM - EPS || dy >= PRODUCTION_GROUP_GAP_Y_MM - EPS, `${a.key}/${b.key}: dx ${dx} dy ${dy}`);
    }
  }
}

/** No receipt can move left or up any further (fixed point). */
function assertCompacted(rects: RigidRect[]) {
  const again = compactRigidRects(rects, B);
  for (const m of again.moves) assert.deepEqual(m.status, ["BLOCKED"], `receipt ${m.key} could still move`);
}

describe("Group compaction — synthetic", () => {
  test("bounds: first receipt at 5 mm from the left, 13 mm from the top; Production receipt gaps x 2 / y 2", () => {
    assert.deepEqual(B, { minX: 5, minY: 13, gapX: 2, gapY: 2 });
  });

  test("1. two receipts far apart side by side end exactly GROUP_GAP_X (2 mm) apart", () => {
    const { rects, moves } = compactRigidRects([rect(1, 5, 13, 50, 30), rect(2, 100, 13, 40, 30)], B);
    assert.equal(byKey(rects, 2).x, 5 + 50 + 2);
    assert.deepEqual(moves[1].status, ["COMPACTED_X"]);
    assert.equal(moves[1].blockedLeftBy, 1);
  });

  test("2. two stacked receipts end exactly PRODUCTION_GROUP_GAP_Y (2 mm) apart — not 8", () => {
    const { rects, moves } = compactRigidRects([rect(1, 5, 13, 50, 30), rect(2, 5, 80, 50, 30)], B);
    assert.equal(byKey(rects, 2).y, 13 + 30 + 2);
    assert.deepEqual(moves[1].status, ["COMPACTED_Y"]);
    assert.equal(moves[1].blockedUpBy, 1);
  });

  test("3. a receipt blocked by others stops at the blocker — no overlap, gaps kept, bigger gaps allowed", () => {
    const input = [rect(1, 5, 13, 50, 30), rect(2, 5, 51, 30, 30), rect(3, 120, 40, 40, 30)];
    const { rects } = compactRigidRects(input, B);
    assert.equal(byKey(rects, 3).x, 57, "blocked by receipt 1 (the wider one), not receipt 2");
    assert.ok(byKey(rects, 3).x - (byKey(rects, 2).x + byKey(rects, 2).w) > PRODUCTION_GROUP_GAP_X_MM, "gap to receipt 2 is allowed to stay larger");
    assertSpaced(rects);
    assertCompacted(rects);
  });

  test("4a. a Y move opens an X move", () => {
    // Pinned column: narrow T on top, wide A below. C starts in A's rows (X stops at A + 2 = 47),
    // rises to the top edge, and only THEN can slide further left, up to T + 2 = 17.
    const input = [rect(1, 5, 13, 10, 20), rect(2, 5, 35, 40, 40), rect(3, 100, 60, 30, 15)];
    const { rects, moves, rounds } = compactRigidRects(input, B);
    assert.deepEqual([byKey(rects, 1).x, byKey(rects, 1).y, byKey(rects, 2).x, byKey(rects, 2).y], [5, 13, 5, 35], "column stays");
    assert.deepEqual([byKey(rects, 3).x, byKey(rects, 3).y], [17, 13]);
    assert.deepEqual(moves[2].status, ["COMPACTED_X", "COMPACTED_Y"]);
    assert.ok(rounds >= 2, "needs X -> Y -> X");
    assertSpaced(rects);
    assertCompacted(rects);
  });

  test("4b. an X move opens a Y move", () => {
    // Under A (pinned by W) C could only rise to 53 + 2 = 55; after sliding left it rises to W + 2 = 25.
    const input = [rect(1, 5, 13, 33, 10), rect(2, 40, 13, 40, 40), rect(3, 60, 100, 30, 15)];
    const { rects } = compactRigidRects(input, B);
    assert.deepEqual([byKey(rects, 2).x, byKey(rects, 2).y], [40, 13], "A stays");
    assert.deepEqual([byKey(rects, 3).x, byKey(rects, 3).y], [5, 25]);
    assertSpaced(rects);
    assertCompacted(rects);
  });

  test("groups on different sheets never block each other", () => {
    const { rects } = compactRigidRects([rect(1, 5, 13, 100, 100, 0), rect(2, 50, 50, 20, 20, 1)], B);
    assert.deepEqual([byKey(rects, 2).x, byKey(rects, 2).y], [5, 13]);
  });

  test("5. fiducials stay safe even with a frame that would reach them", () => {
    const { rects } = compactRigidRects([rect(1, 20, 20, 10, 10)], { minX: 0, minY: 0, gapX: 2, gapY: 8 });
    const r = byKey(rects, 1);
    assert.ok(fiducialDistance({ posX: r.x, posY: r.y, width: r.w, height: r.h }) >= FIDUCIAL_CLEARANCE_MM - EPS);
  });

  test("10. deterministic, input untouched", () => {
    const input = [rect(1, 5, 60, 40, 40), rect(2, 100, 50, 30, 15), rect(3, 200, 200, 20, 20)];
    const snapshot = JSON.stringify(input);
    assert.deepEqual(compactRigidRects(input, B), compactRigidRects(input, B));
    assert.equal(JSON.stringify(input), snapshot);
  });
});

describe("Group compaction — in Production Nesting", () => {
  const fixtures = [
    { name: "28 item / 5 resi", items: realBatch5Orders() },
    { name: "71 item / 8 resi", items: realBatch8Orders() },
    { name: "27 item / 5 resi (Staging)", items: stagingBatch5Orders() },
  ].map((f) => {
    const config = resolveConfig(PRODUCTION_SPACING_OVERRIDES);
    const packed = runGroupedNestingV3(f.items, PRODUCTION_SPACING_OVERRIDES, undefined, { trace: false, compound: compoundStage(config), region: regionStage(config) }).result;
    return { ...f, packed, run: runProductionNesting(f.items) };
  });

  test("the real Staging batch (27 items / 5 receipts) compacts Test091 and PROD-APPEND-TEST left; 216.269 mm", () => {
    const { run } = fixtures[2];
    const moved = run.compaction.filter((m) => m.status[0] !== "BLOCKED");
    assert.deepEqual(
      moved.map((m) => [STAGING_BATCH_RECEIPT_CODES[m.orderId!], m.status.join("+"), Math.round(m.dx * 100) / 100, m.dy]).sort(),
      [["PROD-APPEND-TEST", "COMPACTED_X", -5.4, 0], ["Test091", "COMPACTED_X", -2.38, 0]]
    );
    assert.equal(run.sheetCount, 1);
    assert.ok(Math.abs(run.sumUsedHeight - 216.269) < 0.01, String(run.sumUsedHeight));
    // Receipts end up stacked at exactly the 2 mm receipt gap where geometry allows it.
    const boxes = receiptBoxes(run.placements.map((p) => ({ ...p, orderId: p.orderId! })));
    const stackedAt2 = boxes.some((a) => boxes.some((b) => a !== b && Math.abs(b.rect.y - (a.rect.y + a.rect.h) - 2) < 1e-6 && Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) > Math.max(a.rect.x, b.rect.x)));
    assert.ok(stackedAt2);
  });

  test("experimental V3 checkpoint path (no Production wrapper) is unchanged and does not compact", () => {
    const items = realBatch8Orders();
    const cfg = resolveConfig({});
    const v3 = runGroupedNestingV3(items, {}, undefined, { trace: false, compound: compoundStage(cfg), region: regionStage(cfg) });
    assert.ok(Math.abs(v3.result.summary.sumUsedHeight - 620.065) < 0.01);
    assert.deepEqual(outerSpacing(cfg), { marginX: 5, marginY: 5, gapX: 8, gapY: 8 });
    assert.equal(ORDER_GAP_MM, 8);
  });

  for (const f of fixtures) {
    test(`${f.name}: 7./8. group geometry and item coordinates relative to the group identical`, () => {
      const before = new Map(f.packed.groups.map((g) => [g.orderId, g]));
      for (const g of f.run.result.groups) {
        const b = before.get(g.orderId)!;
        assert.equal(g.sheetIndex, b.sheetIndex);
        assert.deepEqual([g.width, g.height], [b.width, b.height]);
        const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
        const rel = (x: typeof g) => x.items.map((i) => [r6(i.x - x.x), r6(i.y - x.y), i.width, i.height, i.rotated, i.data]);
        assert.deepEqual(rel(g), rel(b));
      }
    });

    test(`${f.name}: objective never worse (sheet count, used height per sheet, used width)`, () => {
      assert.equal(f.run.result.summary.sheetCount, f.packed.summary.sheetCount);
      f.run.result.sheets.forEach((s, i) => {
        assert.ok(s.usedHeight <= f.packed.sheets[i].usedHeight + EPS);
        assert.ok(s.usedWidth <= f.packed.sheets[i].usedWidth + EPS);
      });
    });

    test(`${f.name}: 5./6./9. gate clean (0 overlap/duplicate/missing/outside, margins, fiducials), fully compacted`, () => {
      assert.equal(f.run.ok, true, f.run.errors.join("; "));
      const placed = f.run.placements.map((p, k) => ({
        key: String(k), orderId: p.orderId!, sheet: p.sheetIndex, posX: p.posX, posY: p.posY, width: p.width, height: p.height, rotated: p.rotated,
        expectedWidth: p.rotated ? p.height : p.width, expectedHeight: p.rotated ? p.width : p.height,
      }));
      assert.deepEqual(validatePlacedSheets(placed, placed.map((p) => p.key), "production").errors, []);
      for (const p of placed) {
        assert.ok(p.posX >= 5 - EPS && p.posY >= 13 - EPS);
        assert.ok(fiducialDistance(p) >= FIDUCIAL_CLEARANCE_MM - EPS);
      }
      for (const s of new Set(placed.map((p) => p.sheet))) {
        const boxes = receiptBoxes(placed.filter((p) => p.sheet === s)).map((b) => rect(b.orderId, b.rect.x, b.rect.y, b.rect.w, b.rect.h));
        assertCompacted(boxes);
        assert.ok(summarizeSheet(placed.filter((p) => p.sheet === s)).usedWidth <= 310);
      }
    });

    test(`${f.name}: 10. deterministic`, () => {
      assert.deepEqual(runProductionNesting(f.items).placements, f.run.placements);
    });
  }
});

describe("Group compaction — Legacy and Mahar untouched", () => {
  const filesUnder = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
    });

  test("11./12. only Production Nesting (and the Staging debug view) use compaction", () => {
    const users = [...filesUnder("app"), ...filesUnder("components"), ...filesUnder("lib")].filter(
      (p) => !p.endsWith(".test.ts") && p !== join("lib", "nesting", "group-compaction.ts") && /group-compaction/.test(readFileSync(p, "utf8"))
    );
    assert.deepEqual(users.sort(), [join("lib", "nesting", "production-nesting.ts"), join("lib", "staging-overlay.ts")]);
    for (const p of ["lib/nesting.ts", ...filesUnder("lib").filter((x) => /mahar/.test(x)), ...filesUnder("app/mahar-nesting"), ...filesUnder("app/mahar-generator")]) {
      assert.doesNotMatch(readFileSync(p, "utf8"), /group-compaction|compactRigidRects/, p);
    }
  });
});

describe("Group compaction — Staging debug tags", () => {
  const item = (orderId: number, posX: number, posY: number, width: number, height: number) => ({ orderId, posX, posY, width, height });
  const loose = { summary: { profile: "production" }, items: [item(1, 5, 13, 50, 30), item(2, 100, 13, 40, 30)] };
  const tight = { summary: { profile: "production" }, items: [item(1, 5, 13, 50, 30), item(2, 57, 13, 40, 30)] };

  test("whitespace that could still be removed is flagged, never hidden", () => {
    const tags = compactionTags(loose, []);
    assert.equal(tags[1].slack, true);
    assert.match(tags[1].text, /^BISA DIRAPATKAN ←43\.0/);
  });

  test("a compacted layout shows BLOCKED with its blockers, or the last run's COMPACTED_X distance", () => {
    assert.match(compactionTags(tight, [])[1].text, /^BLOCKED · ◀#1 ▲tepi$/);
    assert.match(compactionTags(tight, [{ orderId: 2, dx: -43, dy: 0, status: ["COMPACTED_X"] }])[1].text, /^COMPACTED_X ←43\.0 · ◀#1 ▲tepi$/);
    assert.equal(compactionTags(tight, []).some((t) => t.slack), false);
  });

  test("legacy sheets get no compaction tags", () => {
    assert.deepEqual(compactionTags({ ...tight, summary: { profile: "legacy" } }, []), []);
  });
});
