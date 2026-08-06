import {
  SHEET_WIDTH_MM,
  SHEET_HEIGHT_MM,
  FIDUCIAL_RADIUS_MM,
} from "@/lib/keychain-geometry";
import { getItemTransform, getReceiptLabelY } from "@/lib/staging-transform";
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
  const printLayer = sheet.items
    .map((item) => {
      if (!item.render) return "";
      const image = item.render.characterImage
        ? `<image href="${item.render.characterImage.dataUri}" x="${item.render.characterImage.x}" y="${item.render.characterImage.y}" width="${item.render.characterImage.width}" height="${item.render.characterImage.height}" preserveAspectRatio="xMidYMid meet" />`
        : "";
      const text = item.render.textSegments
        .map((segment) => `<path d="${segment.d}" fill="${segment.color}" />`)
        .join("");
      const label = item.order
        ? `<text x="0.5" y="${getReceiptLabelY(item)}" font-size="2.5" fill="#334155">${escapeXml(item.order.receiptCode)}</text>`
        : "";
      return `  <g transform="${getItemTransform(item)}">${image}${text}${label}</g>`;
    })
    .join("\n");

  // Rendered inside the same mirrored group as the artwork, on purpose — it
  // isn't counter-mirrored to stay "readable", it flips along with
  // everything else since it's part of the same back-printed sheet.
  const trimmedLabel = labelText?.trim();
  const customLabel = trimmedLabel
    ? `<text x="${SHEET_WIDTH_MM / 2}" y="${SHEET_HEIGHT_MM - 4}" text-anchor="middle" font-size="6" fill="#000000">${escapeXml(trimmedLabel)}</text>`
    : "";

  // Registration marks sit in absolute (unmirrored) sheet coordinates — a
  // fixed physical reference frame for aligning the print against the cut,
  // independent of whatever content happens to be mirrored inside it.
  const fiducialXs = [FIDUCIAL_RADIUS_MM, SHEET_WIDTH_MM - FIDUCIAL_RADIUS_MM];
  const fiducialYs = [FIDUCIAL_RADIUS_MM, SHEET_HEIGHT_MM - FIDUCIAL_RADIUS_MM];
  const fiducials = fiducialXs
    .flatMap((cx) => fiducialYs.map((cy) => `  <circle cx="${cx}" cy="${cy}" r="${FIDUCIAL_RADIUS_MM}" fill="#000000" />`))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MM}mm" height="${SHEET_HEIGHT_MM}mm" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}">
  <rect width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="#ffffff" />
  <g id="print-layer-mirrored" transform="translate(${SHEET_WIDTH_MM}, 0) scale(-1, 1)">
${printLayer}
${customLabel}
  </g>
  <rect x="0" y="0" width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="none" stroke="#000000" stroke-width="${BORDER_STROKE_MM}" />
${fiducials}
</svg>
`;
}

const PRINT_DPI = 300;
const MM_PER_INCH = 25.4;

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
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
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Gagal me-render SVG print ke gambar"));
      image.src = svgUrl;
    });

    const widthPx = mmToPx(SHEET_WIDTH_MM, PRINT_DPI);
    const heightPx = mmToPx(SHEET_HEIGHT_MM, PRINT_DPI);

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
