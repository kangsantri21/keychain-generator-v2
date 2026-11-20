import { activeProductionFrame, type ActiveProductionFrame } from "@/lib/active-frame";
import { CURVE_TOLERANCE_MM } from "@/lib/keychain-geometry";
import { circleFromPathData, flattenPathToPolygons, type FlatPoint } from "@/lib/laser-outline";
import type { StagingItemPayload, StagingSheet } from "@/lib/staging-types";
import { sanitizeFileName } from "@/lib/utils";

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
 *
 * The flip is anchored at the physical frame height (lib/active-frame.ts):
 * 470 mm for legacy sheets (unchanged), the active height for an adaptive
 * Production frame — so the DXF really spans 0..310 x 0..activeHeight. Every
 * cut, fiducial and border point gets the same flip, so their relative
 * geometry is identical to the 470 mm version (only a uniform Y shift).
 */
function toDxfY(svgY: number, frameHeightMm: number): number {
  return frameHeightMm - svgY;
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
 * Border and fiducials come from the active production frame (full
 * 310 x 470 for legacy sheets).
 */
function sheetReferenceEntities(frame: ActiveProductionFrame): string[] {
  const corners: FlatPoint[] = [
    { x: 0, y: 0 },
    { x: frame.widthMm, y: 0 },
    { x: frame.widthMm, y: frame.heightMm },
    { x: 0, y: frame.heightMm },
  ];
  const border = polylineEntity(
    corners.map((p) => ({ x: p.x, y: toDxfY(p.y, frame.heightMm) })),
    "CUT_BORDER"
  );

  const fiducials = [...frame.fiducials]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .map((f) => circleEntity(f.x, toDxfY(f.y, frame.heightMm), f.r, "CUT_FIDUCIAL"));

  return [border, ...fiducials];
}

/**
 * Emits one closed LWPOLYLINE per polygon, in final on-sheet DXF coordinates.
 * Curves are flattened at CURVE_TOLERANCE_MM (0.01 mm), not the old 0.05 mm
 * that turned a 1.9 mm hole into about 16 sides.
 *
 * A path that is actually a circle — the ring hole, after paper.js has
 * rewritten its arcs as cubic curves — is emitted as a CIRCLE entity instead.
 * That stays round in the laser file and costs one entity, not a polygon.
 */
function pathToDxfEntities(
  d: string,
  item: Pick<StagingItemPayload, "posX" | "posY" | "width" | "rotated">,
  layer: string,
  frameHeightMm: number
): string[] {
  if (layer === "CUT_HOLE") {
    const circle = circleFromPathData(d);
    if (circle) {
      const center = applyItemTransform(item, { x: circle.x, y: circle.y });
      return [circleEntity(center.x, toDxfY(center.y, frameHeightMm), circle.r, layer)];
    }
  }

  return flattenPathToPolygons(d, CURVE_TOLERANCE_MM).map((polygon) => {
    const points = polygon.map((p) => {
      const onSheet = applyItemTransform(item, p);
      return { x: onSheet.x, y: toDxfY(onSheet.y, frameHeightMm) };
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
  const frame = activeProductionFrame(sheet);
  if (frame.errors.length > 0) throw new Error(frame.errors.join("; "));
  const entities: string[] = [...sheetReferenceEntities(frame)];

  for (const item of sheet.items) {
    if (!item.render) continue;
    if (item.render.outlinePath) {
      entities.push(...pathToDxfEntities(item.render.outlinePath, item, "CUT_OUTLINE", frame.heightMm));
    }
    if (item.render.holePath) {
      entities.push(...pathToDxfEntities(item.render.holePath, item, "CUT_HOLE", frame.heightMm));
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

/**
 * `labelText` mirrors the same "Kode Lembar / Urgent" input used by the
 * print (JPG) export, sanitized with the exact same rule, so the cut (DXF)
 * and print files for one sheet always share a filename — an operator can
 * match them up on sight instead of cross-referencing sheet IDs.
 */
export function downloadSheetDxf(sheet: StagingSheet, labelText?: string): void {
  const dxf = buildSheetDxfDocument(sheet);
  const blob = new Blob([dxf], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);

  const sanitizedLabel = labelText ? sanitizeFileName(labelText) : "";
  const fileName = sanitizedLabel ? `${sanitizedLabel}.dxf` : `lembar-kerja-${sheet.sheetId}.dxf`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
