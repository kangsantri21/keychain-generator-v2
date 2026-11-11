import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { itemsFromVectorSheet, type VectorSheet } from "@/lib/nesting/manual-vector-sheets";
import { runShapeBlockNesting } from "@/lib/nesting/shape-block-nesting";

const fixture = JSON.parse(readFileSync("lib/nesting/fixtures/manual-vector-sheets.json", "utf8")) as { sheets: VectorSheet[] };

function sheet(id: string): VectorSheet {
  const found = fixture.sheets.find((item) => item.id === id);
  if (!found) throw new Error(`lembar ${id} tidak ada`);
  return found;
}

/**
 * Same rule for every traced sheet: keep the pieces of one frame together.
 * Fitting on one sheet must stay within 10% of the manual frame's area.
 * Refusing to split is also a pass — that is the full 470×310 tag sheet.
 */
function assertSheetContract(id: string): void {
  const frame = sheet(id);
  const run = runShapeBlockNesting(itemsFromVectorSheet(frame));
  const manual = frame.frameW * frame.frameH;
  if (!run.ok) {
    assert.match(run.errors.join(" "), /tidak dipecah/);
    assert.equal(run.sheetCount, 0);
    return;
  }
  assert.equal(run.sheetCount, 1, id);
  const used = run.sumUsedHeight * run.config.sheetWidthMm;
  assert.ok(used <= manual * 1.1, `${id} ${used.toFixed(0)} vs ${manual.toFixed(0)}`);
}

test("vector sheets from the cut files stay within 10% or refuse to split", () => {
  assert.equal(fixture.sheets.length, 37);
  assert.equal(
    fixture.sheets.reduce((sum, item) => sum + item.pieces.length, 0),
    2043
  );
  // Mixed sheet, a dense row sheet, and the full-height tag sheet.
  assertSheetContract("4nov-1");
  assertSheetContract("9nov-1");
  assertSheetContract("10nov-8");
});
