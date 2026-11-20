/**
 * Writes the before/after sheet pictures and prints the material numbers.
 * Run: npx tsx scripts/render-nesting-compare.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { runProductionNesting } from "@/lib/nesting/production-nesting";
import { renderSheetSvg, type PreviewPiece } from "@/lib/nesting/shape-block-preview";
import { layoutByHand, manualLikeBatch, toShapeItems } from "@/lib/nesting/shape-block-sample";
import { runShapeBlockNesting } from "@/lib/nesting/shape-block-nesting";
import { rectOutline } from "@/lib/nesting/shape-outline";

const pieces = manualLikeBatch();
const shapeItems = toShapeItems(pieces);
const machine = runShapeBlockNesting(shapeItems);
const hand = layoutByHand(pieces);
const before = runProductionNesting(
  shapeItems.map((piece) => ({
    id: piece.id,
    orderId: piece.orderId,
    width: piece.width,
    height: piece.height,
    originalWidth: piece.width,
    originalHeight: piece.height,
    allowRotation: true,
    data: piece.data,
  }))
);

const itemArea = pieces.reduce((sum, piece) => sum + piece.width * piece.height, 0);
const sheetArea = SHEET_WIDTH_MM * SHEET_HEIGHT_MM;

function report(name: string, sheets: number, usedHeight: number) {
  const lengthPct = (usedHeight / (sheets * SHEET_HEIGHT_MM)) * 100;
  const fillPct = (itemArea / (SHEET_WIDTH_MM * usedHeight)) * 100;
  console.log(
    `${name}: lembar ${sheets}, tinggi ${usedHeight.toFixed(1)} mm, panjang lembar ${lengthPct.toFixed(1)}%, isi ${fillPct.toFixed(1)}%`
  );
}

report("sebelum (kotak)", before.sheetCount, before.sumUsedHeight);
report("sesudah (garis potong)", machine.sheetCount, machine.sumUsedHeight);
report("tangan", hand.sheetCount, hand.sumUsedHeight);
console.log(
  `mesin vs tangan: ${((machine.sumUsedHeight / hand.sumUsedHeight - 1) * 100).toFixed(1)}% (batas +10%)`
);
console.log(`luas keping ${itemArea.toFixed(0)} mm2, luas lembar ${sheetArea}`);

const byId = new Map(pieces.map((piece, index) => [index + 1, piece]));

const afterPieces: PreviewPiece[] = machine.placements.map((p) => {
  const source = byId.get(Number(p.item.id))!;
  return {
    orderId: p.orderId ?? 0,
    code: source.code,
    name: source.name,
    sheetIndex: p.sheetIndex,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotationDeg: p.rotationDeg,
    outline: source.outline,
    contentWidth: source.width,
    contentHeight: source.height,
  };
});

const beforePieces: PreviewPiece[] = before.placements.map((p) => {
  const sourceItem = shapeItems.find((item) => item.data === p.data)!;
  const source = byId.get(Number(sourceItem.id))!;
  return {
    orderId: p.orderId ?? 0,
    code: source.code,
    name: source.name,
    sheetIndex: p.sheetIndex,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotationDeg: p.rotationDeg,
    outline: rectOutline(source.width, source.height),
    contentWidth: source.width,
    contentHeight: source.height,
  };
});

const handPieces: PreviewPiece[] = hand.placements.map((p) => {
  const source = pieces.find((piece) => piece.orderId === p.orderId && piece.name === p.name)!;
  return {
    orderId: p.orderId,
    code: p.code,
    name: p.name,
    sheetIndex: p.sheetIndex,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotationDeg: p.rotationDeg,
    outline: rectOutline(source.width, source.height),
    contentWidth: source.width,
    contentHeight: source.height,
  };
});

const dir = "docs/nesting/images";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/sebelum-kotak.svg`, renderSheetSvg(beforePieces, 0, "Sebelum — kotak pembatas", false));
writeFileSync(`${dir}/sesudah-bentuk.svg`, renderSheetSvg(afterPieces, 0, "Sesudah — garis potong", true));
writeFileSync(`${dir}/susunan-tangan.svg`, renderSheetSvg(handPieces, 0, "Susunan tangan", true));
console.log("wrote", dir);
