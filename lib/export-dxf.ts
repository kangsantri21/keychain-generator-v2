import {
  SHEET_WIDTH_MM,
  SHEET_HEIGHT_MM,
  FIDUCIAL_RADIUS_MM,
} from "@/lib/keychain-geometry";
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

function circleEntity(cx: number, cy: number, r: number, layer: string): string {
  return ["0", "CIRCLE", "8", layer, "10", cx.toFixed(3), "20", cy.toFixed(3), "40", r.toFixed(3)].join("\n");
}

/**
 * Sheet-level reference geometry the laser operator aligns against — the
 * 310x470mm outer border and the 4 corner fiducial holes, at the exact same
 * positions as the visual marks drawn in the print JPEG
 * (lib/export-print-svg.ts), so the print and the cut can be physically
 * pinned together. These are sheet-absolute (no per-item transform), but
 * still need the same Y-up flip as every other coordinate in this file.
 */
function sheetReferenceEntities(): string[] {
  const corners: FlatPoint[] = [
    { x: 0, y: 0 },
    { x: SHEET_WIDTH_MM, y: 0 },
    { x: SHEET_WIDTH_MM, y: SHEET_HEIGHT_MM },
    { x: 0, y: SHEET_HEIGHT_MM },
  ];
  const border = polylineEntity(
    corners.map((p) => ({ x: p.x, y: toDxfY(p.y) })),
    "CUT_BORDER"
  );

  const fiducialXs = [FIDUCIAL_RADIUS_MM, SHEET_WIDTH_MM - FIDUCIAL_RADIUS_MM];
  const fiducialYs = [FIDUCIAL_RADIUS_MM, SHEET_HEIGHT_MM - FIDUCIAL_RADIUS_MM];
  const fiducials = fiducialXs.flatMap((cx) =>
    fiducialYs.map((cy) => circleEntity(cx, toDxfY(cy), FIDUCIAL_RADIUS_MM, "CUT_FIDUCIAL"))
  );

  return [border, ...fiducials];
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

function layerDefinition(name: string): string[] {
  return ["0", "LAYER", "2", name, "70", "0", "62", "1", "6", "CONTINUOUS"];
}

/**
 * Builds a laser-cutting DXF for one nested sheet — the red cutting lines
 * ONLY (per-item outline/hole, plus the sheet's own border and corner
 * fiducial holes), across CUT_OUTLINE/CUT_HOLE/CUT_BORDER/CUT_FIDUCIAL
 * layers, in millimeters ($INSUNITS = 4). This is the industry-standard
 * vector format CNC/laser software actually imports; no print or graphic
 * content belongs here (that's the separate print export in
 * lib/export-print-svg.ts).
 */
export function buildSheetDxfDocument(sheet: StagingSheet): string {
  const entities: string[] = [...sheetReferenceEntities()];

  for (const item of sheet.items) {
    if (!item.render) continue;
    if (item.render.outlinePath) {
      entities.push(...pathToDxfEntities(item.render.outlinePath, item, "CUT_OUTLINE"));
    }
    if (item.render.holePath) {
      entities.push(...pathToDxfEntities(item.render.holePath, item, "CUT_HOLE"));
    }
  }

  const layers = ["CUT_OUTLINE", "CUT_HOLE", "CUT_BORDER", "CUT_FIDUCIAL"];

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
    String(layers.length),
    ...layers.flatMap(layerDefinition),
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
