/**
 * Receipt integrity across sheets: 1 receipt = 1 group = 1 sheet.
 * Reproduces the PAT large-batch bug (receipts staged twice by two Production
 * runs) and locks the invariant after every pipeline stage. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { receiptsOnSeveralSheets, stagedReceiptConflicts, validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import { resolveConfig, runGroupedNesting } from "./grouped-nesting";
import { compactRigidRects, compactionBoundsOf } from "./group-compaction";
import { improveWithSlotReflow } from "./grouped-nesting-v3";
import { improveWithCompoundMoves } from "./grouped-nesting-v3-compound";
import { improveWithRegionRepack } from "./grouped-nesting-v3-region";
import { PRODUCTION_SPACING_OVERRIDES, runProductionNesting } from "./production-nesting";
import { pat195Units, PAT_228_ROWS, PAT_RECEIPT_CODES } from "./test-fixtures/pat-batch-228";
import { realBatch8Orders } from "./test-fixtures/real-batch-8-orders";
import { realBatch5Orders } from "./test-fixtures/real-batch-5-orders";
import { stagingBatch5Orders } from "./test-fixtures/staging-batch-5-orders";
import type { GroupedNestingItem, GroupPlacement } from "./grouped-nesting-types";

type Unit = GroupedNestingItem<{ k: number }>;
const config = resolveConfig(PRODUCTION_SPACING_OVERRIDES);

/** Every receipt on exactly one sheet: groups AND their items. */
function assertOneSheetPerReceipt<T>(groups: GroupPlacement<T>[], stage: string) {
  const units = groups.flatMap((g) => [{ orderId: g.orderId, sheetIndex: g.sheetIndex }, ...g.items.map((i) => ({ orderId: i.orderId, sheetIndex: i.sheetIndex }))]);
  assert.deepEqual(receiptsOnSeveralSheets(units), [], `receipt split after ${stage}`);
  const groupsPerOrder = new Map<number, number>();
  for (const g of groups) if (g.orderId !== null) groupsPerOrder.set(g.orderId, (groupsPerOrder.get(g.orderId) ?? 0) + 1);
  for (const [orderId, n] of groupsPerOrder) assert.equal(n, 1, `order ${orderId} has ${n} groups after ${stage}`);
}

function placedOf<T>(run: ReturnType<typeof runProductionNesting<T>>, keyOf: (data: T) => string): PlacedItem[] {
  return run.placements.map((p) => ({
    key: keyOf(p.data),
    orderId: p.orderId!,
    sheet: p.sheetIndex,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotated: p.rotated,
    expectedWidth: p.rotated ? p.height : p.width,
    expectedHeight: p.rotated ? p.width : p.height,
  }));
}

/** Gate every sheet (0 overlap / outside / spacing) + whole-batch counts (0 missing / duplicate). */
function assertProductionValid(run: ReturnType<typeof runProductionNesting<{ k: number } | { stagingId: number } | { itemId: number }>>, inputIds: string[]) {
  assert.equal(run.ok, true, run.errors.join("; "));
  const placed = placedOf(run, (d) => String(Object.values(d as object)[0]));
  assert.equal(placed.length, inputIds.length, "total in = total out");
  assert.deepEqual(validatePlacedSheets(placed, inputIds, "production").errors, []);
  assert.deepEqual(receiptsOnSeveralSheets(run.placements), []);
}

const unit = (k: number, orderId: number, w: number, h: number): Unit => ({
  id: k,
  orderId,
  width: w,
  height: h,
  originalWidth: w,
  originalHeight: h,
  allowRotation: true,
  data: { k },
});

describe("PAT batch 228 — reproduction", () => {
  const run1 = PAT_228_ROWS.filter((r) => r[3] === 1);
  const run2 = PAT_228_ROWS.filter((r) => r[3] === 2);

  test("the staged state had exactly PAT-01, PAT-01B, PAT-01C on two sheets (2 and 3)", () => {
    const split = receiptsOnSeveralSheets(PAT_228_ROWS.map((r) => ({ orderId: r[1], sheetIndex: r[2] })));
    assert.deepEqual(split, [100, 101, 102]);
    assert.deepEqual(split.map((o) => PAT_RECEIPT_CODES[o]), ["PAT-01", "PAT-01B", "PAT-01C"]);
    for (const o of split) {
      const sheets = [...new Set(PAT_228_ROWS.filter((r) => r[1] === o).map((r) => r[2]))].sort();
      assert.deepEqual(sheets, [2, 3]);
    }
  });

  test("root cause: the engine never split anything — each run alone keeps every receipt on one sheet; run 2 re-staged run 1's receipts", () => {
    assert.deepEqual(receiptsOnSeveralSheets(run1.map((r) => ({ orderId: r[1], sheetIndex: r[2] }))), []);
    assert.deepEqual(receiptsOnSeveralSheets(run2.map((r) => ({ orderId: r[1], sheetIndex: r[2] }))), []);
    assert.equal(run1.length + run2.length, 228);
    assert.equal(run2.length, 195);
    assert.equal(new Set(run2.map((r) => r[1])).size, 32);
    // Run 1's receipts are fully contained in run 2 (same units again).
    for (const o of new Set(run1.map((r) => r[1]))) {
      assert.equal(run1.filter((r) => r[1] === o).length, run2.filter((r) => r[1] === o).length);
    }
  });

  test("fix: a Production run that includes receipts already in Staging is refused (exactly those 3, on sheet 2)", () => {
    const conflicts = stagedReceiptConflicts(
      [...new Set(run2.map((r) => r[1]))],
      run1.map((r) => ({ orderId: r[1], sheetId: r[2], status: "staged-production" }))
    );
    assert.deepEqual(conflicts, [
      { orderId: 100, sheetIds: [2] },
      { orderId: 101, sheetIds: [2] },
      { orderId: 102, sheetIds: [2] },
    ]);
    assert.deepEqual(stagedReceiptConflicts([100], [{ orderId: 100, sheetId: 2, status: "completed" }]), [], "completed sheets do not block");
    assert.deepEqual(stagedReceiptConflicts([200], run1.map((r) => ({ orderId: r[1], sheetId: r[2], status: "staged" }))), []);
  });

  test("the Production route checks staged receipts before nesting AND again inside the write transaction", () => {
    const route = readFileSync("app/api/staging/nest/route.ts", "utf8");
    const branch = route.slice(route.indexOf('resolveNestingMode(body) === "production-v3"'));
    const firstCheck = branch.indexOf("stagedReceiptConflicts(orderIds, activeRows)");
    assert.ok(firstCheck > 0 && firstCheck < branch.indexOf("runProductionNesting("));
    const tx = branch.slice(branch.indexOf("db.transaction"));
    assert.ok(tx.indexOf("stagedReceiptConflicts(orderIds, nowActive)") < tx.indexOf("tx.insert(stagingItems)"));
    const queue = readFileSync("app/order-queue/page.tsx", "utf8");
    assert.match(queue, /nestingMode === "production"[\s\S]{0,200}row\.status !== "pending"/);
  });
});

describe("PAT batch — the real 195 units / 32 receipts", () => {
  const items = pat195Units();
  const run = runProductionNesting(items);

  test("10./11.-15. every sheet VALID, 195 in = 195 out, 0 duplicate / missing / overlap / outside, one sheet per receipt", () => {
    assertProductionValid(run, items.map((i) => String(i.id)));
    assert.equal(run.sheetCount, 3);
    const perReceipt = new Map<number, Set<number>>();
    for (const p of run.placements) perReceipt.set(p.orderId!, (perReceipt.get(p.orderId!) ?? new Set()).add(p.sheetIndex));
    assert.equal(perReceipt.size, 32);
    for (const s of perReceipt.values()) assert.equal(s.size, 1);
  });

  test("16. deterministic", () => {
    assert.deepEqual(runProductionNesting(pat195Units()).placements, run.placements);
  });
});

describe("Receipt integrity — every stage", () => {
  const items = pat195Units();
  const v2 = runGroupedNesting(items, PRODUCTION_SPACING_OVERRIDES);

  test("V2 packing keeps every receipt on one sheet (multi-sheet)", () => {
    assert.ok(v2.summary.sheetCount >= 2);
    assertOneSheetPerReceipt(v2.groups, "V2");
  });

  test("4. slot reflow keeps every receipt on one sheet", () => {
    assertOneSheetPerReceipt(improveWithSlotReflow(v2.groups, config, undefined, undefined, false).groups, "slot reflow");
  });

  test("5. compound moves keep every receipt on one sheet", () => {
    assertOneSheetPerReceipt(improveWithCompoundMoves(v2.groups, config).groups, "compound");
  });

  test("6. region repack keeps every receipt on one sheet", () => {
    assertOneSheetPerReceipt(improveWithRegionRepack(v2.groups, config).groups, "region repack");
  });

  test("7. group compaction never changes a receipt's sheet", () => {
    const rects = v2.groups.map((g, key) => ({ key, sheet: g.sheetIndex, x: g.x, y: g.y, w: g.width, h: g.height }));
    const { rects: out } = compactRigidRects(rects, compactionBoundsOf(config));
    out.forEach((r, i) => assert.equal(r.sheet, rects[i].sheet));
  });

  test("the Production runner checks the invariant after every stage", () => {
    const src = readFileSync("lib/nesting/production-nesting.ts", "utf8");
    for (const stage of ["V2 packing", "V3 (reflow / compound / region)", "group compaction", "final placements"]) assert.ok(src.includes(`"${stage}"`), stage);
    assert.match(src, /receiptsOnSeveralSheets\(units\)/);
  });
});

describe("Receipt integrity — synthetic", () => {
  test("1. one large receipt stays whole on one sheet", () => {
    const items = Array.from({ length: 40 }, (_, k) => unit(k, 1, 80, 26));
    const run = runProductionNesting(items);
    assertProductionValid(run, items.map((i) => String(i.id)));
    assert.equal(new Set(run.placements.map((p) => p.sheetIndex)).size, 1);
  });

  test("2. many small receipts over several sheets stay whole", () => {
    const items = Array.from({ length: 180 }, (_, k) => unit(k, 1000 + Math.floor(k / 3), 60 + (k % 3) * 5, 25));
    const run = runProductionNesting(items);
    assertProductionValid(run, items.map((i) => String(i.id)));
    assert.ok(run.sheetCount >= 2);
  });

  test("3. a receipt that only nearly fits the rest of a sheet moves to another sheet whole", () => {
    // Receipts of 300 x ~140: two fit per sheet height-wise, the third never fits the leftover strip.
    const items: Unit[] = [];
    let k = 0;
    for (let r = 0; r < 5; r++) for (let i = 0; i < 10; i++) items.push(unit(k++, 2000 + r, 58, 26));
    const run = runProductionNesting(items);
    assertProductionValid(run, items.map((i) => String(i.id)));
    const perReceipt = new Map<number, Set<number>>();
    for (const p of run.placements) perReceipt.set(p.orderId!, (perReceipt.get(p.orderId!) ?? new Set()).add(p.sheetIndex));
    for (const [orderId, s] of perReceipt) assert.equal(s.size, 1, `receipt ${orderId}`);
  });

  test("8./9. earlier fixtures stay valid: 71/8 (557.613 mm), 28/5, staging 27/5", () => {
    const r71 = runProductionNesting(realBatch8Orders());
    assertProductionValid(r71, realBatch8Orders().map((i) => String(i.id)));
    assert.ok(Math.abs(r71.sumUsedHeight - 557.613) < 0.01);
    for (const items of [realBatch5Orders(), stagingBatch5Orders()]) assertProductionValid(runProductionNesting(items), items.map((i) => String(i.id)));
  });
});
