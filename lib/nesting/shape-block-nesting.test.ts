/**
 * Shape-block nesting (P0.4–P0.6). `npm test`.
 *
 * One receipt is one framed block with one code beside it. Pieces turn
 * 90° and 180° when that saves space, and the gap is measured on the cut
 * line rather than the bounding box.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPrintSvgDocument } from "@/lib/export-print-svg";
import { buildSheetDxfDocument } from "@/lib/export-dxf";
import { STAGED_SHAPE } from "@/lib/staging-mode";
import { getItemTransform, localToSheet } from "@/lib/staging-transform";
import type { StagingItemPayload } from "@/lib/staging-types";
import { validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import { framesAndLabels } from "@/lib/nesting/shape-block-marks";
import { runShapeBlockNesting, type ShapeBlockItem, type ShapeBlockPlacement } from "@/lib/nesting/shape-block-nesting";
import { CUT_CLEARANCE_MM } from "@/lib/nesting/shape-block-config";
import { lOutline, outlinesTooClose, rectOutline } from "@/lib/nesting/shape-outline";
import { layoutByHand, manualLikeBatch, toShapeItems } from "@/lib/nesting/shape-block-sample";
import { runProductionNesting } from "@/lib/nesting/production-nesting";
import type { GroupedNestingItem } from "@/lib/nesting/grouped-nesting-types";

const EPS = 0.15;

function item<T>(partial: ShapeBlockItem<T>): ShapeBlockItem<T> {
  return partial;
}

function boxGap(a: { posX: number; posY: number; width: number; height: number }, b: { posX: number; posY: number; width: number; height: number }): number {
  return Math.max(b.posX - (a.posX + a.width), a.posX - (b.posX + b.width), b.posY - (a.posY + a.height), a.posY - (b.posY + b.height));
}

function placedOf<T>(run: ReturnType<typeof runShapeBlockNesting<T>>): PlacedItem[] {
  return run.placements.map((p) => ({
    key: String(p.item.id),
    orderId: p.orderId ?? -1,
    sheet: p.sheetIndex,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotated: p.rotated,
    expectedWidth: p.item.width,
    expectedHeight: p.item.height,
    outline: p.outline,
    cutClearanceMm: run.config.cutClearanceMm,
    blockGapMm: run.config.blockGapMm,
  }));
}

describe("Cut-line distance", () => {
  test("two squares 1 mm apart are clear at 1 mm and too close at 1.5 mm", () => {
    const a = rectOutline(10, 10);
    const b = rectOutline(10, 10).map((poly) => poly.map((p) => ({ x: p.x + 11, y: p.y })));
    assert.equal(outlinesTooClose(a, b, 1), false);
    assert.equal(outlinesTooClose(a, b, 1.5), true);
  });

  test("overlapping squares are too close at any clearance", () => {
    const a = rectOutline(10, 10);
    const b = rectOutline(10, 10).map((poly) => poly.map((p) => ({ x: p.x + 4, y: p.y })));
    assert.equal(outlinesTooClose(a, b, 0), true);
  });
});

describe("Rotation 180 really turns the artwork", () => {
  test("the transform and the point map both send the origin to the opposite corner", () => {
    const piece = { posX: 10, posY: 20, width: 40, height: 15, rotated: false, rotationDeg: 180 as const };
    assert.equal(getItemTransform(piece), "translate(50, 35) rotate(180)");
    assert.deepEqual(localToSheet(piece, { x: 0, y: 0 }), { x: 50, y: 35 });
    assert.deepEqual(localToSheet(piece, { x: 40, y: 15 }), { x: 10, y: 20 });
    // 90° stays the transform the older packer already used.
    assert.equal(getItemTransform({ posX: 87, posY: 13, width: 26.207, height: 80, rotated: true }), "translate(113.207, 13) rotate(90)");
  });
});

describe("Shape-block nesting", () => {
  test("two L plates turn 180° and use less length than two boxes", () => {
    const pieces = [0, 1].map((id) =>
      item({
        id,
        orderId: 1,
        width: 30,
        height: 30,
        allowRotation: true,
        outline: lOutline(),
        receiptCode: "RESI-L",
        data: id,
      })
    );
    const free = runShapeBlockNesting(pieces);
    const frozen = runShapeBlockNesting(pieces.map((piece) => ({ ...piece, allowRotation: false })));
    assert.equal(free.ok, true, free.errors.join("; "));
    assert.equal(frozen.ok, true, frozen.errors.join("; "));
    assert.ok(free.placements.some((p) => p.rotationDeg === 180), "180° was not chosen");
    const area = (run: typeof free) => run.blocks[0].width * run.blocks[0].height;
    assert.ok(area(free) < area(frozen) - 200, `area free ${area(free).toFixed(0)} frozen ${area(frozen).toFixed(0)}`);
    assert.ok(free.blocks[0].width < frozen.blocks[0].width - 10);
    const gate = validatePlacedSheets(placedOf(free), ["0", "1"], "production");
    assert.deepEqual(gate.errors, []);
  });

  test("eight long names stand in one column", () => {
    const pieces = Array.from({ length: 8 }, (_, id) =>
      item({
        id,
        orderId: 4,
        width: 48,
        height: 14,
        allowRotation: true,
        outline: rectOutline(48, 14),
        receiptCode: "KOLOM-8",
        data: id,
      })
    );
    const run = runShapeBlockNesting(pieces);
    assert.equal(run.ok, true, run.errors.join("; "));
    assert.equal(run.sheetCount, 1);
    assert.ok(run.placements.every((p) => p.rotationDeg === 90 || p.rotationDeg === 270));
    const xs = run.placements.map((p) => p.posX);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1, `not one column: x ${xs.join(",")}`);
    const contentW = Math.max(...run.placements.map((p) => p.posX + p.width)) - Math.min(...xs);
    assert.ok(contentW < 20, `column is ${contentW} mm wide`);
  });

  test("a wide block is turned 90° when that keeps the batch on one sheet", () => {
    // Six wide plates. Lying flat, only one fits across the sheet and six
    // rows spill onto a second sheet. Stood up, several share a row.
    const pieces = Array.from({ length: 6 }, (_, orderId) =>
      item({
        id: orderId + 1,
        orderId: orderId + 1,
        width: 190,
        height: 80,
        allowRotation: true,
        outline: rectOutline(190, 70),
        receiptCode: `BLOK-${orderId + 1}`,
        data: orderId,
      })
    );
    const turned = runShapeBlockNesting(pieces);
    const upright = runShapeBlockNesting(pieces, { allowBlockRotation: false });
    assert.equal(turned.ok, true, turned.errors.join("; "));
    assert.equal(upright.ok, true, upright.errors.join("; "));
    assert.equal(turned.sheetCount, 1);
    assert.equal(upright.sheetCount, 2);
    assert.ok(turned.blocks.some((block) => block.blockRotation === 90));
    for (const piece of turned.placements) {
      const sheets = new Set(turned.placements.filter((p) => p.orderId === piece.orderId).map((p) => p.sheetIndex));
      assert.equal(sheets.size, 1);
    }
  });

  test("the cut clearance is the gap the packer keeps, and it is configurable", () => {
    const pair = (clearance: number) => {
      const pieces = [0, 1].map((id) =>
        item({
          id,
          orderId: 9,
          width: 20,
          height: 20,
          allowRotation: false,
          outline: rectOutline(20, 20),
          receiptCode: "JARAK",
          data: id,
        })
      );
      return runShapeBlockNesting(pieces, { cutClearanceMm: clearance });
    };
    const tight = pair(1);
    const loose = pair(5);
    assert.equal(tight.ok && loose.ok, true);
    const gap = (run: typeof tight) => boxGap(run.placements[0], run.placements[1]);
    assert.ok(gap(tight) >= 1 - EPS, `tight gap ${gap(tight)}`);
    assert.ok(gap(loose) >= 5 - EPS, `loose gap ${gap(loose)}`);
    assert.ok(gap(loose) > gap(tight) + 2);
    const span = (run: typeof tight) => run.blocks[0].width + run.blocks[0].height;
    assert.ok(span(loose) > span(tight) + 2, `span loose ${span(loose)} tight ${span(tight)}`);
  });

  test("one receipt, one frame, one code beside the frame — two receipts stay apart", () => {
    const make = (orderId: number, code: string) =>
      [0, 1, 2].map((n) =>
        item({
          id: `${orderId}-${n}`,
          orderId,
          width: 36 + n,
          height: 18,
          allowRotation: true,
          outline: rectOutline(36 + n, 18),
          receiptCode: code,
          data: n,
        })
      );
    const run = runShapeBlockNesting([...make(1, "RESI-AAA"), ...make(2, "RESI-BBB")]);
    assert.equal(run.ok, true, run.errors.join("; "));
    const gate = validatePlacedSheets(
      placedOf(run),
      run.placements.map((p) => String(p.item.id)),
      "production"
    );
    assert.deepEqual(gate.errors, []);
    const marks = framesAndLabels(
      run.placements.map((p) => ({ orderId: p.orderId ?? 0, posX: p.posX, posY: p.posY, width: p.width, height: p.height })),
      (orderId) => (orderId === 1 ? "RESI-AAA" : "RESI-BBB")
    );
    assert.equal(marks.frames.length, 2);
    assert.equal(marks.labels.length, 2);
    assert.deepEqual(
      marks.labels.map((label) => label.text).sort(),
      ["RESI-AAA", "RESI-BBB"]
    );
    for (const label of marks.labels) {
      const frame = marks.frames.find((f) => f.orderId === label.orderId)!;
      assert.ok(boxGap(rectToBox(label.rect), rectToBox(frame)) >= -EPS, "label overlaps its frame");
      for (const piece of run.placements.filter((p) => p.orderId === label.orderId)) {
        assert.ok(boxGap(rectToBox(label.rect), piece) >= -EPS, "label overlaps a piece");
      }
      const foreign = marks.frames.find((f) => f.orderId !== label.orderId)!;
      assert.equal(inside(label.rect, foreign), false);
    }
    for (const piece of run.placements) {
      const own = marks.frames.find((frame) => frame.orderId === piece.orderId)!;
      const other = marks.frames.find((frame) => frame.orderId !== piece.orderId)!;
      assert.equal(inside(piece, own), true);
      assert.equal(inside(piece, other), false);
    }
    const sheetsByOrder = new Map<number, Set<number>>();
    for (const piece of run.placements) {
      const set = sheetsByOrder.get(piece.orderId ?? 0) ?? new Set<number>();
      set.add(piece.sheetIndex);
      sheetsByOrder.set(piece.orderId ?? 0, set);
    }
    for (const sheets of sheetsByOrder.values()) assert.equal(sheets.size, 1);
  });

  test("the print file draws the frame and exactly one code; the laser file does not", () => {
    const pieces = [0, 1].map((n) =>
      item({
        id: n,
        orderId: 3,
        width: 30,
        height: 16,
        allowRotation: true,
        outline: rectOutline(30, 16),
        receiptCode: "CETAK-3",
        data: n,
      })
    );
    const run = runShapeBlockNesting(pieces);
    const items = payloadFrom(run.placements, "CETAK-3");
    const svg = buildPrintSvgDocument({ sheetId: 1, items });
    assert.equal((svg.match(/>CETAK-3</g) ?? []).length, 1);
    assert.equal((svg.match(/<rect /g) ?? []).length >= 2, true);
    const dxf = buildSheetDxfDocument({ sheetId: 1, items });
    assert.equal(dxf.includes("CETAK-3"), false);
  });
});

describe("Manual-like batch — material", () => {
  const pieces = manualLikeBatch();
  const shapeItems = toShapeItems(pieces);
  const machine = runShapeBlockNesting(shapeItems);
  const hand = layoutByHand(pieces);
  const beforeItems: GroupedNestingItem<{ name: string }>[] = shapeItems.map((piece) => ({
    id: piece.id,
    orderId: piece.orderId,
    width: piece.width,
    height: piece.height,
    originalWidth: piece.width,
    originalHeight: piece.height,
    allowRotation: true,
    data: piece.data,
  }));
  const before = runProductionNesting(beforeItems);

  test("the machine stays within 10% of the hand layout and does not mix receipts", () => {
    assert.equal(machine.ok, true, machine.errors.join("; "));
    assert.ok(machine.sheetCount <= hand.sheetCount, `sheets machine ${machine.sheetCount} hand ${hand.sheetCount}`);
    assert.ok(
      machine.sumUsedHeight <= hand.sumUsedHeight * 1.1 + 0.5,
      `height machine ${machine.sumUsedHeight} hand ${hand.sumUsedHeight}`
    );
    const gate = validatePlacedSheets(
      placedOf(machine),
      shapeItems.map((piece) => String(piece.id)),
      "production"
    );
    assert.deepEqual(gate.errors, []);
    const orders = new Set(pieces.map((piece) => piece.orderId));
    for (const orderId of orders) {
      const sheets = new Set(machine.placements.filter((p) => p.orderId === orderId).map((p) => p.sheetIndex));
      assert.equal(sheets.size, 1, `resi ${orderId} pecah`);
    }
    // Every pair of cut lines in one receipt respects the configured gap.
    for (let i = 0; i < machine.placements.length; i++) {
      for (let j = i + 1; j < machine.placements.length; j++) {
        const a = machine.placements[i];
        const b = machine.placements[j];
        if (a.orderId !== b.orderId || a.sheetIndex !== b.sheetIndex) continue;
        assert.equal(outlinesTooClose(a.outline, b.outline, CUT_CLEARANCE_MM), false, `${a.item.id} vs ${b.item.id}`);
      }
    }
  });

  test("numbers used by the report stay finite", () => {
    assert.ok(before.ok, before.errors.join("; "));
    assert.ok(machine.sumUsedHeight > 0 && hand.sumUsedHeight > 0 && before.sumUsedHeight > 0);
    assert.ok(before.sumUsedHeight > 0);
  });
});

function rectToBox(rect: { x: number; y: number; w: number; h: number }): { posX: number; posY: number; width: number; height: number } {
  return { posX: rect.x, posY: rect.y, width: rect.w, height: rect.h };
}

function inside(
  piece: { posX?: number; posY?: number; width?: number; height?: number; x?: number; y?: number; w?: number; h?: number },
  frame: { x: number; y: number; w: number; h: number }
): boolean {
  const x = piece.posX ?? piece.x ?? 0;
  const y = piece.posY ?? piece.y ?? 0;
  const w = piece.width ?? piece.w ?? 0;
  const h = piece.height ?? piece.h ?? 0;
  return x >= frame.x - EPS && y >= frame.y - EPS && x + w <= frame.x + frame.w + EPS && y + h <= frame.y + frame.h + EPS;
}

function payloadFrom(placements: ShapeBlockPlacement<unknown>[], code: string): StagingItemPayload[] {
  return placements.map((p, index) => ({
    id: index + 1,
    orderId: p.orderId ?? 0,
    templateId: 1,
    customerName: `N${index}`,
    sheetId: p.sheetIndex + 1,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotated: p.rotated,
    rotationDeg: p.rotationDeg,
    status: STAGED_SHAPE,
    order: { id: p.orderId ?? 0, receiptCode: code, manualCode: "" },
    template: null,
    render: {
      width: p.rotated ? p.height : p.width,
      height: p.rotated ? p.width : p.height,
      outlinePath: "M0 0h1v1z",
      holePath: null,
      textSegments: [],
      characterImage: null,
    },
  }));
}
