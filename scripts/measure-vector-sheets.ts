/**
 * Compare every physical sheet from the design team's cut files with the app.
 * Run: npx tsx scripts/measure-vector-sheets.ts
 * Add --images to write side-by-side pictures under docs/nesting/images/.
 */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { itemsFromVectorSheet, ringOf, type VectorSheet } from "@/lib/nesting/manual-vector-sheets";
import { renderSheetSvg, type PreviewPiece } from "@/lib/nesting/shape-block-preview";
import { runShapeBlockNesting } from "@/lib/nesting/shape-block-nesting";

const fixture = JSON.parse(readFileSync("lib/nesting/fixtures/manual-vector-sheets.json", "utf8")) as { sheets: VectorSheet[] };
const wantImages = process.argv.includes("--images");
const imageIds = new Set(["3nov-1", "4nov-1", "5nov-1", "6nov-1", "9nov-1", "10nov-1", "10nov-8"]);

function ringArea(flat: number[]): number {
  let area = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1];
  }
  return Math.abs(area) / 2;
}

function dateKey(id: string): number {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : 0;
}

const sheets = [...fixture.sheets].sort((a, b) => dateKey(a.id) - dateKey(b.id) || a.id.localeCompare(b.id));

function manualSvg(sheet: VectorSheet): string {
  const paths = sheet.pieces
    .map((piece) => {
      const ring = ringOf(piece.p);
      const d =
        ring.map((p, i) => `${i === 0 ? "M" : "L"}${(piece.x + p.x).toFixed(2)} ${(piece.y + p.y).toFixed(2)}`).join(" ") + " Z";
      return `<path d="${d}" fill="#2563eb" fill-opacity="0.85" stroke="#111" stroke-width="0.3"/>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.frameW}mm" height="${sheet.frameH}mm" viewBox="0 0 ${sheet.frameW} ${sheet.frameH}">
  <rect width="100%" height="100%" fill="#fff"/>
  <rect x="0.4" y="0.4" width="${sheet.frameW - 0.8}" height="${sheet.frameH - 0.8}" fill="none" stroke="#999" stroke-width="0.4"/>
  ${paths}
</svg>`;
}

async function writePair(sheet: VectorSheet, previews: PreviewPiece[] | null, note: string): Promise<void> {
  const px = 3;
  const manual = await sharp(Buffer.from(manualSvg(sheet)), { density: 96 })
    .resize({ width: Math.round(sheet.frameW * px), height: Math.round(sheet.frameH * px), fit: "fill" })
    .png()
    .toBuffer();
  let app: Buffer;
  if (previews && previews.length > 0) {
    const svg = renderSheetSvg(previews, 0, sheet.id, true);
    app = await sharp(Buffer.from(svg), { density: 96 })
      .resize({ width: Math.round(SHEET_WIDTH_MM * px), height: Math.round(SHEET_HEIGHT_MM * px), fit: "fill" })
      .png()
      .toBuffer();
  } else {
    app = await sharp({
      create: { width: Math.round(SHEET_WIDTH_MM * px), height: Math.round(SHEET_HEIGHT_MM * px), channels: 3, background: "#f4f4f5" },
    })
      .png()
      .toBuffer();
  }
  const mMeta = await sharp(manual).metadata();
  const aMeta = await sharp(app).metadata();
  const gap = 18;
  const width = (mMeta.width ?? 0) + gap + (aMeta.width ?? 0);
  const height = Math.max(mMeta.height ?? 0, aMeta.height ?? 0) + 36;
  const caption = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="36"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="24" font-family="sans-serif" font-size="16" fill="#111">${note}</text></svg>`
  );
  const label = await sharp(caption).png().toBuffer();
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite([
      { input: label, left: 0, top: 0 },
      { input: manual, left: 0, top: 36 },
      { input: app, left: (mMeta.width ?? 0) + gap, top: 36 },
    ])
    .png()
    .toFile(`docs/nesting/images/vector-${sheet.id}.png`);
}

async function main(): Promise<void> {
  if (wantImages) mkdirSync("docs/nesting/images", { recursive: true });
  let over = 0;
  let refused = 0;
  for (const sheet of sheets) {
    const items = itemsFromVectorSheet(sheet);
    const t = Date.now();
    const run = runShapeBlockNesting(items);
    const manual = sheet.frameW * sheet.frameH;
    const ms = Date.now() - t;
    if (!run.ok) {
      refused++;
      console.log(`${sheet.label} ${sheet.id}  FAIL  ${sheet.pieces.length} keping  bingkai ${sheet.frameW.toFixed(0)}×${sheet.frameH.toFixed(0)}  ${run.errors.join(" | ")}  ${ms} ms`);
      if (wantImages && imageIds.has(sheet.id)) await writePair(sheet, null, `${sheet.label} ${sheet.id}: manual (kiri). Aplikasi tidak memecah resi ini.`);
      continue;
    }
    const used = run.sumUsedHeight * run.config.sheetWidthMm;
    const pieceArea = sheet.pieces.reduce((sum, piece) => sum + ringArea(piece.p), 0);
    const pct = (used / manual - 1) * 100;
    const fill = (pieceArea / used) * 100;
    const split = run.blocks.some((block) => (block.splitCount ?? 0) > 1);
    // A receipt that does not fit one sheet is allowed to occupy several
    // labeled parts. A sheet that fits must stay one part, within 10%.
    if (!split && (pct > 10 || run.sheetCount > 1)) over++;
    console.log(
      `${sheet.label} ${sheet.id}  keping ${items.length}  manual ${sheet.frameW.toFixed(0)}×${sheet.frameH.toFixed(0)}  aplikasi ${run.sheetCount} lembar ${run.sumUsedHeight.toFixed(0)} mm  ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%  isi ${fill.toFixed(1)}%  ${ms} ms`
    );
    if (wantImages && imageIds.has(sheet.id)) {
      const previews: PreviewPiece[] = run.placements.map((placement) => {
        const source = items.find((item) => item.id === placement.item.id) ?? placement.item;
        return {
          orderId: placement.orderId ?? 1,
          code: sheet.id,
          name: String(placement.item.id).split("-").pop() ?? "",
          sheetIndex: placement.sheetIndex,
          posX: placement.posX,
          posY: placement.posY,
          width: placement.width,
          height: placement.height,
          rotationDeg: placement.rotationDeg,
          outline: source.outline ?? [],
          contentWidth: source.width,
          contentHeight: source.height,
        };
      });
      await writePair(sheet, previews, `${sheet.label} ${sheet.id}: manual (kiri) dan aplikasi (kanan), ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% luas`);
    }
  }
  console.log(
    over === 0
      ? `Tidak ada lembar yang lebih boros dari 10%. ${refused} lembar ditolak tanpa dipecah.`
      : `${over} lembar melewati 10% atau terpecah. ${refused} lembar ditolak tanpa dipecah.`
  );
  process.exitCode = over === 0 ? 0 : 1;
}

main();
