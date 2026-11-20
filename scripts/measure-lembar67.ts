/**
 * Density of the 67-piece sheet from the October snapshot, before and after
 * shape-block nesting. The fixture has sizes and positions only — no names
 * and no receipt numbers.
 *
 * Run: npx tsx scripts/measure-lembar67.ts
 */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { renderSheetSvg, type PreviewPiece } from "@/lib/nesting/shape-block-preview";
import { runShapeBlockNesting, type ShapeBlockItem } from "@/lib/nesting/shape-block-nesting";
import { rectOutline } from "@/lib/nesting/shape-outline";

interface SavedPiece {
  g: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: 0 | 90;
}

const fixture = JSON.parse(readFileSync("lib/nesting/fixtures/lembar67-anon.json", "utf8")) as { pieces: SavedPiece[] };
const pieces = fixture.pieces;
const SHEET = SHEET_WIDTH_MM * SHEET_HEIGHT_MM;

function contentOf(piece: SavedPiece): { width: number; height: number } {
  return piece.rot === 90 ? { width: piece.h, height: piece.w } : { width: piece.w, height: piece.h };
}

const groupId = new Map<string, number>();
for (const piece of pieces) if (!groupId.has(piece.g)) groupId.set(piece.g, groupId.size + 1);

function beforePreviews(): PreviewPiece[] {
  return pieces.map((piece) => {
    const content = contentOf(piece);
    return {
      orderId: groupId.get(piece.g) ?? 1,
      code: piece.g,
      name: "",
      sheetIndex: 0,
      posX: piece.x,
      posY: piece.y,
      width: piece.w,
      height: piece.h,
      rotationDeg: piece.rot,
      outline: rectOutline(content.width, content.height),
      contentWidth: content.width,
      contentHeight: content.height,
    };
  });
}

const items: ShapeBlockItem<SavedPiece>[] = pieces.map((piece, index) => {
  const content = contentOf(piece);
  return {
    id: index,
    orderId: groupId.get(piece.g) ?? 1,
    width: content.width,
    height: content.height,
    allowRotation: true,
    outline: rectOutline(content.width, content.height),
    receiptCode: piece.g,
    data: piece,
  };
});

function density(label: string, count: number, sheetCount: number, usedHeight: number, area: number) {
  const used = SHEET_WIDTH_MM * usedHeight;
  console.log(
    `${label}  keping ${count}  lembar ${sheetCount}  tinggi ${usedHeight.toFixed(1)} mm  ` +
      `area keping ${((area / used) * 100).toFixed(1)}% dari tinggi terpakai, ${((area / SHEET) * 100).toFixed(1)}% dari lembar penuh`
  );
}

async function main(): Promise<void> {
  const area = pieces.reduce((sum, piece) => sum + piece.w * piece.h, 0);
  const beforeHeight = Math.max(...pieces.map((piece) => piece.y + piece.h));
  density("sebelum", pieces.length, 1, beforeHeight, area);

  const run = runShapeBlockNesting(items);
  if (!run.ok) {
    console.log("sesudah GAGAL", run.errors.join(" | "));
    process.exitCode = 1;
    return;
  }
  density("sesudah", run.placements.length, run.sheetCount, run.sumUsedHeight, area);
  const counts = [0, 90, 180, 270].map((deg) => `${deg}° ${run.placements.filter((p) => p.rotationDeg === deg).length}`);
  console.log("arah sesudah", counts.join(", "));
  const after: PreviewPiece[] = run.placements.map((placement) => ({
    orderId: placement.orderId ?? 1,
    code: placement.item.receiptCode ?? "",
    name: "",
    sheetIndex: placement.sheetIndex,
    posX: placement.posX,
    posY: placement.posY,
    width: placement.width,
    height: placement.height,
    rotationDeg: placement.rotationDeg,
    outline: rectOutline(placement.item.width, placement.item.height),
    contentWidth: placement.item.width,
    contentHeight: placement.item.height,
  }));
  const beforeSvg = renderSheetSvg(beforePreviews(), 0, "67 keping, susunan tersimpan", false);
  const afterSvg = renderSheetSvg(after, 0, "67 keping, susunan baru", true);
  const px = 3;
  await sharp(Buffer.from(beforeSvg), { density: 96 })
    .resize({ width: Math.round(SHEET_WIDTH_MM * px), height: Math.round(SHEET_HEIGHT_MM * px), fit: "fill" })
    .png()
    .toFile("docs/nesting/images/lembar67-sebelum.png");
  await sharp(Buffer.from(afterSvg), { density: 96 })
    .resize({ width: Math.round(SHEET_WIDTH_MM * px), height: Math.round(SHEET_HEIGHT_MM * px), fit: "fill" })
    .png()
    .toFile("docs/nesting/images/lembar67-sesudah.png");
  console.log("gambar docs/nesting/images/lembar67-sebelum.png dan lembar67-sesudah.png");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
