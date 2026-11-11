/**
 * Nest the names from Rofiq's manual photo with real cut lines.
 * Run: npx tsx scripts/measure-manual-real.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { OUTLINE_GROWTH_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { manualSheetPieces } from "@/lib/nesting/manual-sheet-pieces";
import { CHARACTER_OUTER_MM, NAME_OUTER_MM, renderManualPieces, toRealShapeItems } from "@/lib/nesting/manual-real-outline";
import { renderSheetSvg, type PreviewPiece } from "@/lib/nesting/shape-block-preview";
import { runShapeBlockNesting } from "@/lib/nesting/shape-block-nesting";

const MANUAL_SHEETS = 1;
const MANUAL_USED_HEIGHT_MM = 470;
const MANUAL_NOTE = "lembar penuh: konten sampai sekitar 6 mm dari tepi";

async function main() {
  const listed = manualSheetPieces();
  console.log(`keping ${listed.length}, resi ${new Set(listed.map((p) => p.code)).size}`);
  const { manualFontPath } = await import("@/lib/nesting/manual-real-outline");
  console.log("font", manualFontPath());
  // Photo of the full sheet: colored letter ink is about 16 mm, pitch about 23 mm.
  // The 2.5 mm contour sits in the white gap, so the cut piece is ink + 5 mm.
  const photoInkMm = 16;
  const photoNameOuter = photoInkMm + OUTLINE_GROWTH_MM;
  const photoCharacterOuter = CHARACTER_OUTER_MM * (photoNameOuter / NAME_OUTER_MM);
  console.log(`skala foto: tinta ${photoInkMm} mm, tinggi luar nama ${photoNameOuter} mm, tokoh ${photoCharacterOuter.toFixed(1)} mm (bawaan setelan ${NAME_OUTER_MM}/${CHARACTER_OUTER_MM})`);
  const rendered = renderManualPieces(listed, { nameOuterMm: photoNameOuter, characterOuterMm: photoCharacterOuter });
  const sample = rendered.slice(0, 3).map((item) => `${item.piece.name} ${item.width.toFixed(1)}x${item.height.toFixed(1)}`);
  console.log("contoh ukuran", sample.join(", "));
  const items = toRealShapeItems(rendered);
  const run = runShapeBlockNesting(items);
  if (!run.ok) {
    console.log("GAGAL", run.errors.join(" | "));
    process.exitCode = 1;
    return;
  }
  const itemArea = rendered.reduce((sum, item) => sum + item.width * item.height, 0);
  const used = run.sumUsedHeight;
  const lengthPct = (used / (run.sheetCount * SHEET_HEIGHT_MM)) * 100;
  const fillPct = (itemArea / (SHEET_WIDTH_MM * used)) * 100;
  const vsManual = (used / (MANUAL_SHEETS * MANUAL_USED_HEIGHT_MM) - 1) * 100;
  console.log(`aplikasi: lembar ${run.sheetCount}, tinggi ${used.toFixed(1)} mm, panjang ${lengthPct.toFixed(1)}%, isi ${fillPct.toFixed(1)}%`);
  console.log(`manual: lembar ${MANUAL_SHEETS}, tinggi ${MANUAL_USED_HEIGHT_MM} mm (${MANUAL_NOTE})`);
  console.log(`selisih tinggi vs manual: ${vsManual.toFixed(1)}%`);
  const rots = [0, 90, 180, 270].map((deg) => `${deg}° ${run.placements.filter((p) => p.rotationDeg === deg).length}`);
  console.log("arah", rots.join(", "));
  console.log(
    "blok",
    run.blocks
      .map((b) => `#${b.orderId} ${b.blockRotation}° ${b.width.toFixed(0)}x${b.height.toFixed(0)} @${b.x.toFixed(0)},${b.y.toFixed(0)} s${b.sheetIndex}`)
      .join(" | ")
  );

  const previews: PreviewPiece[] = run.placements.map((p) => {
    const source = rendered[Number(p.item.id) - 1];
    return {
      orderId: p.orderId ?? 0,
      code: source.piece.code,
      name: source.piece.name,
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

  const dir = "docs/nesting/images";
  mkdirSync(dir, { recursive: true });
  const sheets = [...new Set(previews.map((p) => p.sheetIndex))].sort((a, b) => a - b);
  for (const sheet of sheets) {
    writeFileSync(`${dir}/manual-real-aplikasi-${sheet}.svg`, renderSheetSvg(previews, sheet, "Aplikasi — garis potong nama manual", true));
  }
  const photoPxPerMm = 1400 / SHEET_HEIGHT_MM;
  const sheetPxH = Math.round(SHEET_HEIGHT_MM * photoPxPerMm);
  const sheetPngs: Buffer[] = [];
  for (const sheet of sheets) {
    const svg = renderSheetSvg(previews, sheet, `Aplikasi lembar ${sheet + 1}`, true);
    const png = await sharp(Buffer.from(svg), { density: 76 }).resize({ height: sheetPxH }).png().toBuffer();
    sheetPngs.push(png);
    if (sheet === sheets[0]) await sharp(png).toFile(`${dir}/manual-real-aplikasi.png`);
  }
  const photo = await sharp("docs/reference/contoh-nesting-manual.jpg").flop().rotate(90).png().toBuffer();
  const photoMeta = await sharp(photo).metadata();
  const appMeta = await sharp(sheetPngs[0]).metadata();
  const appW = (appMeta.width ?? 0) * sheetPngs.length + 16 * (sheetPngs.length - 1);
  const canvasW = (photoMeta.width ?? 0) + appW + 24;
  const canvasH = Math.max(photoMeta.height ?? 0, appMeta.height ?? 0);
  const composites: { input: Buffer; left: number; top: number }[] = [{ input: photo, left: 0, top: 0 }];
  let left = (photoMeta.width ?? 0) + 24;
  for (const png of sheetPngs) {
    composites.push({ input: png, left, top: 0 });
    left += (appMeta.width ?? 0) + 16;
  }
  await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: "#ffffff" } })
    .composite(composites)
    .png()
    .toFile(`${dir}/manual-vs-aplikasi.png`);
  console.log("gambar", `${dir}/manual-vs-aplikasi.png`);
}

main();
