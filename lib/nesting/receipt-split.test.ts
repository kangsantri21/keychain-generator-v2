import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shapeLabelsOf } from "@/lib/nesting/shape-block-marks";
import { itemsFromVectorSheet, type VectorSheet } from "@/lib/nesting/manual-vector-sheets";
import { runProductionNesting } from "@/lib/nesting/production-nesting";
import { runShapeBlockNesting, type ShapeBlockPlacement } from "@/lib/nesting/shape-block-nesting";
import { rectOutline } from "@/lib/nesting/shape-outline";
import { validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import { receiptIsComplete, receiptPartLabel } from "@/lib/receipt-parts";
import { STAGED_SHAPE } from "@/lib/staging-mode";

const fixture = JSON.parse(readFileSync("lib/nesting/fixtures/manual-vector-sheets.json", "utf8")) as { sheets: VectorSheet[] };

function placedOf<T>(run: ReturnType<typeof runShapeBlockNesting<T>>): PlacedItem[] {
  return run.placements.map((placement) => ({
    key: String(placement.item.id),
    orderId: placement.orderId ?? -1,
    sheet: placement.sheetIndex,
    posX: placement.posX,
    posY: placement.posY,
    width: placement.width,
    height: placement.height,
    rotated: placement.rotated,
    expectedWidth: placement.rotated ? placement.height : placement.width,
    expectedHeight: placement.rotated ? placement.width : placement.height,
    outline: placement.outline,
    cutClearanceMm: run.config.cutClearanceMm,
    blockGapMm: run.config.blockGapMm,
    splitPart: placement.splitPart,
    splitCount: placement.splitCount,
  }));
}

function labelsOf(placements: ShapeBlockPlacement<unknown>[], code: string): string[] {
  const sheets = [...new Set(placements.map((placement) => placement.sheetIndex))].sort((a, b) => a - b);
  const texts: string[] = [];
  for (const sheet of sheets) {
    const onSheet = placements.filter((placement) => placement.sheetIndex === sheet);
    const labels = shapeLabelsOf(
      onSheet.map((placement) => ({
        orderId: placement.orderId ?? 0,
        posX: placement.posX,
        posY: placement.posY,
        width: placement.width,
        height: placement.height,
        status: STAGED_SHAPE,
        splitPart: placement.splitPart,
        splitCount: placement.splitCount,
        order: { receiptCode: code },
      }))
    );
    assert.ok(labels, "lembar bentuk punya label");
    texts.push(...labels.map((label) => label.text));
  }
  return texts.sort();
}

test("97 tag (10 Nov 8) splits into two framed sheets labeled 1/2 and 2/2", () => {
  const frame = fixture.sheets.find((item) => item.id === "10nov-8");
  assert.ok(frame);
  assert.equal(frame.pieces.length, 97);
  const run = runShapeBlockNesting(itemsFromVectorSheet(frame));
  assert.equal(run.ok, true, run.errors.join("; "));
  assert.equal(run.sheetCount, 2);
  assert.equal(run.placements.length, 97);
  assert.equal(new Set(run.placements.map((placement) => placement.item.id)).size, 97);
  const sheets = new Set(run.placements.map((placement) => placement.sheetIndex));
  assert.equal(sheets.size, 2);
  assert.deepEqual(
    run.blocks.map((block) => block.label).sort(),
    ["10 Nov 8 1/2", "10 Nov 8 2/2"]
  );
  assert.deepEqual(labelsOf(run.placements, "10 Nov 8"), ["10 Nov 8 1/2", "10 Nov 8 2/2"]);
  for (const block of run.blocks) {
    assert.equal(block.splitCount, 2);
    assert.ok(block.splitPart === 1 || block.splitPart === 2);
  }
  const gate = validatePlacedSheets(
    placedOf(run),
    run.placements.map((placement) => String(placement.item.id)),
    "production"
  );
  assert.deepEqual(gate.errors, []);
});

test("a receipt that fits stays one block and is never labeled as a part", () => {
  const pieces = [0, 1, 2, 3].map((index) => ({
    id: `kecil-${index}`,
    orderId: 7,
    width: 40,
    height: 18,
    allowRotation: true,
    outline: rectOutline(40, 18),
    receiptCode: "KECIL",
    data: index,
  }));
  const run = runShapeBlockNesting(pieces);
  assert.equal(run.ok, true, run.errors.join("; "));
  assert.equal(run.sheetCount, 1);
  assert.equal(run.blocks.length, 1);
  assert.equal(run.blocks[0].label, "KECIL");
  assert.equal(run.blocks[0].splitPart, null);
  assert.equal(run.blocks[0].splitCount, null);
  assert.deepEqual(labelsOf(run.placements, "KECIL"), ["KECIL"]);
  assert.equal(receiptPartLabel("KECIL", null, null), "KECIL");
});

test("an oversized receipt splits and a normal receipt in the same run stays whole", () => {
  const big = [0, 1, 2].map((index) => ({
    id: index,
    orderId: 1,
    width: 290,
    height: 300,
    originalWidth: 290,
    originalHeight: 300,
    allowRotation: true,
    outline: rectOutline(290, 300),
    receiptCode: "BESAR",
    data: { id: index },
  }));
  const small = [0, 1, 2, 3].map((index) => ({
    id: 10 + index,
    orderId: 2,
    width: 36,
    height: 16,
    originalWidth: 36,
    originalHeight: 16,
    allowRotation: true,
    outline: rectOutline(36, 16),
    receiptCode: "BIASA",
    data: { id: 10 + index },
  }));
  const run = runProductionNesting([...big, ...small]);
  assert.equal(run.ok, true, run.errors.join("; "));
  assert.equal(run.engine, "SHAPE");
  const bigSheets = new Set(run.placements.filter((placement) => placement.orderId === 1).map((placement) => placement.sheetIndex));
  const smallSheets = new Set(run.placements.filter((placement) => placement.orderId === 2).map((placement) => placement.sheetIndex));
  assert.equal(bigSheets.size, 3);
  assert.equal(smallSheets.size, 1);
  assert.deepEqual(
    run.placements
      .filter((placement) => placement.orderId === 1)
      .map((placement) => receiptPartLabel("BESAR", placement.splitPart, placement.splitCount))
      .filter((label, index, all) => all.indexOf(label) === index)
      .sort(),
    ["BESAR 1/3", "BESAR 2/3", "BESAR 3/3"]
  );
  assert.ok(run.placements.filter((placement) => placement.orderId === 2).every((placement) => placement.splitPart == null));
});

test("the gate rejects an unmarked split and a split that reuses a part number", () => {
  const piece = (key: string, sheet: number, splitPart?: number, splitCount?: number): PlacedItem => ({
    key,
    orderId: 4,
    sheet,
    posX: 8,
    posY: 8,
    width: 30,
    height: 20,
    rotated: false,
    expectedWidth: 30,
    expectedHeight: 20,
    splitPart,
    splitCount,
  });
  const unmarked = validatePlacedSheets([piece("a", 0), piece("b", 1)], ["a", "b"], "production");
  assert.equal(unmarked.ok, false);
  assert.ok(unmarked.errors.some((error) => error.includes("terpecah")));

  const repeated = validatePlacedSheets(
    [piece("a", 0, 1, 2), piece("b", 1, 1, 2)],
    ["a", "b"],
    "production"
  );
  assert.equal(repeated.ok, false);
  assert.ok(repeated.errors.some((error) => error.includes("terpecah")));

  const marked = validatePlacedSheets(
    [piece("a", 0, 1, 2), piece("b", 1, 2, 2)],
    ["a", "b"],
    "production"
  );
  assert.ok(!marked.errors.some((error) => error.includes("terpecah")), marked.errors.join("; "));
});

test("a split receipt is complete only when every part is done", () => {
  assert.equal(
    receiptIsComplete([
      { splitPart: 1, splitCount: 2, done: true },
      { splitPart: 2, splitCount: 2, done: false },
    ]),
    false
  );
  assert.equal(
    receiptIsComplete([
      { splitPart: 1, splitCount: 2, done: true },
      { splitPart: 2, splitCount: 2, done: true },
    ]),
    true
  );
  assert.equal(receiptIsComplete([{ splitPart: null, splitCount: null, done: true }]), true);
  assert.equal(receiptIsComplete([{ splitPart: null, splitCount: null, done: false }]), false);
  assert.equal(
    receiptIsComplete([
      { splitPart: 1, splitCount: 2, done: true },
      { splitPart: null, splitCount: null, done: true },
    ]),
    false
  );
});
