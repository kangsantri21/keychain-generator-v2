import { RECEIPT_LABEL_FONT_SIZE_MM } from "@/lib/keychain-geometry";
import {
  activeProductionFrame,
  placeBatchLabel,
  SHEET_LABEL_BASELINE_FROM_BOTTOM_MM,
  SHEET_LABEL_FONT_SIZE_MM,
  type BatchLabelPlacement,
} from "@/lib/active-frame";
import { shapeFramesOf } from "@/lib/nesting/shape-block-marks";
import { getItemTransform, getReceiptLabelPosition } from "@/lib/staging-transform";
import { internalLabelsOf } from "@/lib/receipt-labels";
import type { StagingSheet } from "@/lib/staging-types";
import { sanitizeFileName } from "@/lib/utils";

/** Cut-registration border around the sheet, drawn hairline-thin. */
const BORDER_STROKE_MM = 0.1;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Print-only export for the Xerox C70 back-print workflow: the artwork is
 * printed on the BACK of the acrylic and viewed through the front, so the
 * whole sheet's content is mirrored horizontally — plus a hairline
 * registration border and 4 corner fiducial marks the print operator aligns
 * against. These are specific to this print file and deliberately absent
 * from the laser-cutting export (`lib/export-dxf.ts`), which is unchanged.
 */
export function buildPrintSvgDocument(sheet: StagingSheet, labelText?: string): string {
  // Physical frame: full 310 x 470 for legacy; for Production the adaptive
  // active height (lib/active-frame.ts — the same frame the Staging preview
  // and the DXF use). Cropping the height only: the mirror is horizontal and
  // the width is unchanged, so every artwork x/y and size stays identical.
  const frame = activeProductionFrame(sheet);
  if (frame.errors.length > 0) throw new Error(frame.errors.join("; "));
  const W = frame.widthMm;
  const H = frame.heightMm;
  // Production Nesting sheets get internal receipt labels (placed after the
  // layout is final, only in free space inside each receipt box); legacy
  // sheets keep the per-item label exactly as before.
  const internalLabels = internalLabelsOf(sheet);
  const printLayer = sheet.items
    .map((item) => {
      if (!item.render) return "";
      const image = item.render.characterImage
        ? `<image href="${item.render.characterImage.dataUri}" x="${item.render.characterImage.x}" y="${item.render.characterImage.y}" width="${item.render.characterImage.width}" height="${item.render.characterImage.height}" preserveAspectRatio="xMidYMid meet" />`
        : "";
      const text = item.render.textSegments
        .map((segment) => `<path d="${segment.d}" fill="${segment.color}" />`)
        .join("");
      const labelPos = getReceiptLabelPosition(item);
      const label = item.order && !internalLabels
        ? `<text x="${labelPos.x}" y="${labelPos.y}" font-size="${RECEIPT_LABEL_FONT_SIZE_MM}" fill="#334155">${escapeXml(item.order.receiptCode)}</text>`
        : "";
      return `  <g transform="${getItemTransform(item)}">${image}${text}${label}</g>`;
    })
    .join("\n");
  const frames = shapeFramesOf(sheet.items)
    .map(
      (frame) =>
        `  <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="none" stroke="#111111" stroke-width="0.2" />`
    )
    .join("\n");
  const receiptLabels = (internalLabels ?? [])
    .filter((label) => label.status === "PLACED")
    .map(
      (label) =>
        `  <text transform="${label.transform}" x="0" y="0" font-size="${label.fontSize}" textLength="${label.textLength}" lengthAdjust="spacingAndGlyphs" fill="#334155">${escapeXml(label.text)}</text>`
    )
    .join("\n");

  // Rendered inside the same mirrored group as the artwork, on purpose — it
  // isn't counter-mirrored to stay "readable", it flips along with
  // everything else since it's part of the same back-printed sheet.
  // Legacy: bottom-center as always. Adaptive Production frame: only in
  // existing safe whitespace (batchLabelOf) — never printed otherwise.
  const trimmedLabel = labelText?.trim();
  const batchLabel = frame.adaptive && trimmedLabel ? placeBatchLabel(sheet, frame, trimmedLabel) : null;
  const customLabel = !trimmedLabel
    ? ""
    : !frame.adaptive
      ? `<text x="${W / 2}" y="${H - SHEET_LABEL_BASELINE_FROM_BOTTOM_MM}" text-anchor="middle" font-size="${SHEET_LABEL_FONT_SIZE_MM}" fill="#000000">${escapeXml(trimmedLabel)}</text>`
      : batchLabel?.status === "PLACED_INTERNAL"
        ? `<text transform="${batchLabel.transform}" x="0" y="0" font-size="${batchLabel.fontSize}" textLength="${batchLabel.textLength}" lengthAdjust="spacingAndGlyphs" fill="#000000">${escapeXml(trimmedLabel)}</text>`
        : "";

  // Registration marks sit in absolute (unmirrored) sheet coordinates — a
  // fixed physical reference frame for aligning the print against the cut,
  // independent of whatever content happens to be mirrored inside it.
  // (Top fiducials fixed; the bottom two follow the active height.)
  const fiducials = [...frame.fiducials]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((f) => `  <circle cx="${f.x}" cy="${f.y}" r="${f.r}" fill="#000000" />`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff" />
  <g id="print-layer-mirrored" transform="translate(${W}, 0) scale(-1, 1)">
${printLayer}
${frames}
${receiptLabels}
${customLabel}
  </g>
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#000000" stroke-width="${BORDER_STROKE_MM}" />
${fiducials}
</svg>
`;
}

/**
 * Where the print JPG puts the batch code: legacy sheets keep it bottom-center
 * (null here); adaptive Production frames get a whitespace placement or
 * NO_SAFE_POSITION (the code then stays only in the filename / UI).
 */
export function batchLabelOf(sheet: StagingSheet, labelText?: string): BatchLabelPlacement | null {
  const text = labelText?.trim();
  if (!text) return null;
  const frame = activeProductionFrame(sheet);
  return frame.adaptive && frame.errors.length === 0 ? placeBatchLabel(sheet, frame, text) : null;
}

const PRINT_DPI = 300;
const MM_PER_INCH = 25.4;

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

/** Print raster size (px) of a frame side at the fixed print DPI. */
export function printPixelsOf(mm: number): number {
  return mmToPx(mm, PRINT_DPI);
}

/**
 * Converts the print SVG to a flattened, print-ready JPEG at 300 DPI — the
 * Xerox C70 (like most production print RIPs) expects a raster file, not
 * vector SVG. A solid white background is baked in before drawing so no
 * region can come out transparent (JPEG has no alpha channel anyway, but
 * baking it in ourselves guarantees the color rather than leaving it to
 * whatever a given browser's canvas-to-JPEG encoder defaults to).
 */
export async function downloadPrintSheetJpg(sheet: StagingSheet, labelText?: string): Promise<void> {
  const svg = buildPrintSvgDocument(sheet, labelText);
  const frame = activeProductionFrame(sheet);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Gagal me-render SVG print ke gambar"));
      image.src = svgUrl;
    });

    // Same 300 DPI as always: a shorter frame gives proportionally fewer pixels, never a scaled image.
    const widthPx = printPixelsOf(frame.widthMm);
    const heightPx = printPixelsOf(frame.heightMm);

    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Browser ini tidak mendukung canvas");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(image, 0, 0, widthPx, heightPx);

    const jpgDataUrl = canvas.toDataURL("image/jpeg", 1.0);
    const sanitizedLabel = labelText ? sanitizeFileName(labelText) : "";
    const fileName = sanitizedLabel ? `${sanitizedLabel}.jpg` : `print-lembar-kerja-${sheet.sheetId}.jpg`;

    const link = document.createElement("a");
    link.href = jpgDataUrl;
    link.download = fileName;
    link.click();
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
