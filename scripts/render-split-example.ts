/**
 * Anonymized picture of the 10 Nov 8 split (97 tags, two sheets).
 * Cut outlines are customer names, so this draws only the piece boxes.
 * Run: npx tsx scripts/render-split-example.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { itemsFromVectorSheet, type VectorSheet } from "@/lib/nesting/manual-vector-sheets";
import { renderSheetSvg, type PreviewPiece } from "@/lib/nesting/shape-block-preview";
import { runShapeBlockNesting } from "@/lib/nesting/shape-block-nesting";
import { rectOutline } from "@/lib/nesting/shape-outline";
import { receiptPartLabel } from "@/lib/receipt-parts";

const fixture = JSON.parse(readFileSync("lib/nesting/fixtures/manual-vector-sheets.json", "utf8")) as { sheets: VectorSheet[] };

async function main(): Promise<void> {
  const frame = fixture.sheets.find((sheet) => sheet.id === "10nov-8");
  if (!frame) throw new Error("lembar 10nov-8 tidak ada");
  const run = runShapeBlockNesting(itemsFromVectorSheet(frame));
  if (!run.ok) throw new Error(run.errors.join("; "));

  const previews: PreviewPiece[] = run.placements.map((placement) => ({
    orderId: placement.orderId ?? 1,
    code: receiptPartLabel("RESI", placement.splitPart, placement.splitCount),
    name: "",
    sheetIndex: placement.sheetIndex,
    posX: placement.posX,
    posY: placement.posY,
    width: placement.width,
    height: placement.height,
    rotationDeg: 0,
    outline: rectOutline(placement.width, placement.height),
    contentWidth: placement.width,
    contentHeight: placement.height,
  }));

  const px = 3;
  const sheets = [...new Set(previews.map((piece) => piece.sheetIndex))].sort((a, b) => a - b);
  const buffers: Buffer[] = [];
  const headings: string[] = [];
  for (const sheet of sheets) {
    const label = previews.find((piece) => piece.sheetIndex === sheet)?.code ?? "";
    headings.push(label);
    const svg = renderSheetSvg(previews, sheet, label, true);
    buffers.push(
      await sharp(Buffer.from(svg), { density: 144 })
        .resize({ width: Math.round(SHEET_WIDTH_MM * px), height: Math.round(SHEET_HEIGHT_MM * px), fit: "fill" })
        .png()
        .toBuffer()
    );
  }

  const gap = 24;
  const meta = await Promise.all(buffers.map((buffer) => sharp(buffer).metadata()));
  const width = meta.reduce((sum, item) => sum + (item.width ?? 0), 0) + gap * (buffers.length - 1);
  const sheetHeight = Math.max(...meta.map((item) => item.height ?? 0));
  const captionHeight = 88;
  const height = sheetHeight + captionHeight;
  let headingX = 0;
  const headingText = headings
    .map((heading, index) => {
      const x = headingX + 12;
      headingX += (meta[index]?.width ?? 0) + gap;
      return `<text x="${x}" y="78" font-family="sans-serif" font-size="28" font-weight="700" fill="#111">${heading}</text>`;
    })
    .join("");
  const caption = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${captionHeight}">
      <rect width="100%" height="100%" fill="#fff"/>
      <text x="8" y="22" font-family="sans-serif" font-size="16" fill="#111">Resi yang tidak muat satu lembar 31×47 cm, dipecah ${sheets.length} bagian. Nama pelanggan tidak digambar.</text>
      <text x="8" y="44" font-family="sans-serif" font-size="14" fill="#334155">Kotak adalah posisi keping. Tiap bagian punya bingkai dan label sendiri.</text>
      ${headingText}
    </svg>`
  );
  const labelPng = await sharp(caption).png().toBuffer();
  const composite: { input: Buffer; left: number; top: number }[] = [{ input: labelPng, left: 0, top: 0 }];
  let left = 0;
  for (const buffer of buffers) {
    composite.push({ input: buffer, left, top: captionHeight });
    left += (meta[buffers.indexOf(buffer)]?.width ?? 0) + gap;
  }
  mkdirSync("docs/nesting/images", { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(composite)
    .png()
    .toFile("docs/nesting/images/resi-pecah-10nov-8.png");
  console.log(
    `97 keping, ${run.sheetCount} lembar, label ${run.blocks.map((block) => block.label).join(", ")} → docs/nesting/images/resi-pecah-10nov-8.png`
  );
}

main();
