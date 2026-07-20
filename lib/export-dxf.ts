import { SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";
import { flattenPathToPolygons, type FlatPoint } from "@/lib/laser-outline";
import type { StagingItemPayload, StagingSheet } from "@/lib/staging-types";

/**
 * Applies the same on-sheet placement as `getItemTransform`
 * (lib/staging-transform.ts) — translate, plus a 90deg rotation for
 * rotated items — but as direct point math instead of an SVG transform
 * string, since DXF entities carry absolute coordinates, not transforms.
 */
function applyItemTransform(
  item: Pick<StagingItemPayload, "posX" | "posY" | "width" | "rotated">,
  point: FlatPoint
): FlatPoint {
  if (!item.rotated) {
    return { x: point.x + item.posX, y: point.y + item.posY };
  }
  // SVG rotate(90) maps (x, y) -> (-y, x), applied before the translate.
  return { x: -point.y + item.posX + item.width, y: point.x + item.posY };
}

/**
 * DXF (and CNC/laser software generally) uses a Y-up coordinate system,
 * while every point coming out of the render pipeline is in SVG's Y-down
 * space — without this flip the whole sheet would cut upside-down relative
 * to how it looks in the Live Preview / Staging Area canvas.
 */
function toDxfY(svgY: number): number {
  return SHEET_HEIGHT_MM - svgY;
}

function polylineEntity(points: FlatPoint[], layer: string): string {
  const lines = ["0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", "1", "43", "0.0"];
  for (const p of points) {
    lines.push("10", p.x.toFixed(3), "20", p.y.toFixed(3));
  }
  return lines.join("\n");
}

/**
 * Flattens a path (outline or hole) and emits one closed LWPOLYLINE per
 * resulting polygon, in final on-sheet DXF coordinates. Both `outlinePath`
 * and `holePath` are read back through the same curve-flattening paper.js
 * pipeline the rest of the render engine already uses (lib/laser-outline.ts)
 * rather than a hand-rolled parser assuming a specific path grammar —
 * `holePath` in particular is NOT the raw two-arc circle string
 * `circlePathData()` first builds: it passes through `normalizePath()` on
 * its way out of `renderKeychainText`, which re-serializes it via paper.js
 * as a handful of cubic Bezier curves approximating the circle, not arcs.
 */
function pathToDxfEntities(
  d: string,
  item: Pick<StagingItemPayload, "posX" | "posY" | "width" | "rotated">,
  layer: string
): string[] {
  return flattenPathToPolygons(d).map((polygon) => {
    const points = polygon.map((p) => {
      const onSheet = applyItemTransform(item, p);
      return { x: onSheet.x, y: toDxfY(onSheet.y) };
    });
    return polylineEntity(points, layer);
  });
}

/**
 * Builds a laser-cutting DXF for one nested sheet — the red cutting lines
 * ONLY (outer outline + ring hole per item), as separate CUT_OUTLINE/
 * CUT_HOLE layers, in millimeters ($INSUNITS = 4). This is the industry-
 * standard vector format CNC/laser software actually imports; no print or
 * graphic content belongs here (that's the separate print export in
 * lib/export-print-svg.ts).
 */
export function buildSheetDxfDocument(sheet: StagingSheet): string {
  const entities: string[] = [];

  for (const item of sheet.items) {
    if (!item.render) continue;
    if (item.render.outlinePath) {
      entities.push(...pathToDxfEntities(item.render.outlinePath, item, "CUT_OUTLINE"));
    }
    if (item.render.holePath) {
      entities.push(...pathToDxfEntities(item.render.holePath, item, "CUT_HOLE"));
    }
  }

  return [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4", // 4 = millimeters
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "70",
    "2",
    "0",
    "LAYER",
    "2",
    "CUT_OUTLINE",
    "70",
    "0",
    "62",
    "1",
    "6",
    "CONTINUOUS",
    "0",
    "LAYER",
    "2",
    "CUT_HOLE",
    "70",
    "0",
    "62",
    "1",
    "6",
    "CONTINUOUS",
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    ...entities,
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n") + "\n";
}

export function downloadSheetDxf(sheet: StagingSheet): void {
  const dxf = buildSheetDxfDocument(sheet);
  const blob = new Blob([dxf], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lembar-kerja-${sheet.sheetId}.dxf`;
  link.click();
  URL.revokeObjectURL(url);
}
