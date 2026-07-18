import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";
import { getItemTransform } from "@/lib/staging-transform";
import type { StagingSheet } from "@/lib/staging-types";

/**
 * Builds a standalone laser-cutting SVG for one nested sheet — the red
 * cutting lines ONLY (outer outline + ring hole per item). This file goes
 * straight to the laser cutter, so it must never carry any print/graphic
 * content (character images, colored name text, labels) — that belongs
 * exclusively in the separate print export (`lib/export-print-svg.ts`).
 */
export function buildSheetSvgDocument(sheet: StagingSheet): string {
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
