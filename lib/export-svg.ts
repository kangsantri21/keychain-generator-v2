import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";
import { getItemTransform, getContentSize } from "@/lib/staging-transform";
import type { StagingSheet } from "@/lib/staging-types";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Builds a standalone, print-ready SVG document for one nested sheet: a
 * "print" layer (character images + colored name text + a small receipt-code
 * label for sorting after cutting) and a "cutting" layer (red laser lines
 * for the outer outline and the ring hole).
 */
export function buildSheetSvgDocument(sheet: StagingSheet): string {
  const printLayer = sheet.items
    .map((item) => {
      if (!item.render) return "";
      const image = item.render.characterImage
        ? `<image href="${item.render.characterImage.dataUri}" x="${item.render.characterImage.x}" y="${item.render.characterImage.y}" width="${item.render.characterImage.size}" height="${item.render.characterImage.size}" preserveAspectRatio="xMidYMid meet" />`
        : "";
      const text = item.render.textSegments
        .map((segment) => `<path d="${segment.d}" fill="${segment.color}" />`)
        .join("");
      const label = item.order
        ? `<text x="0.5" y="${getContentSize(item).height - 0.5}" font-size="2.5" fill="#334155">${escapeXml(item.order.receiptCode)}</text>`
        : "";
      return `  <g transform="${getItemTransform(item)}">${image}${text}${label}</g>`;
    })
    .join("\n");

  const cuttingLayer = sheet.items
    .map((item) => {
      if (!item.render) return "";
      const outline = item.render.outlinePath
        ? `<path d="${item.render.outlinePath}" fill="none" stroke="#ff0000" stroke-width="0.3" />`
        : "";
      const hole = item.render.holePath
        ? `<path d="${item.render.holePath}" fill="none" stroke="#ff0000" stroke-width="0.3" />`
        : "";
      return `  <g transform="${getItemTransform(item)}">${outline}${hole}</g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MM}mm" height="${SHEET_HEIGHT_MM}mm" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}">
  <rect width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="#ffffff" />
  <g id="print-layer">
${printLayer}
  </g>
  <g id="cutting-layer">
${cuttingLayer}
  </g>
</svg>
`;
}

export function downloadSheetSvg(sheet: StagingSheet): void {
  const svg = buildSheetSvgDocument(sheet);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lembar-kerja-${sheet.sheetId}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}
