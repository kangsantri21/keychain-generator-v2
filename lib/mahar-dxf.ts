import { MAHAR_SHEET_WIDTH_MM, MAHAR_SHEET_HEIGHT_MM } from "@/lib/mahar-geometry";
import { maharShapePoints, type Point } from "@/lib/mahar-shapes";
import type { MaharLayoutItem } from "@/lib/mahar-types";

/**
 * Laser-cutting DXF for a mahar sheet — the plaque cut-lines only (each
 * item's own frame shape, plus the sheet's own border), across CUT_FRAME/
 * CUT_BORDER layers, in millimeters ($INSUNITS = 4). Deliberately much
 * simpler than the keychain module's own export-dxf.ts: a mahar plaque's
 * text/names are printed or engraved separately, not laser-cut letter by
 * letter, so there's no glyph/Clipper outline pipeline to run here — just
 * each order's own frameShape traced at its real size and position.
 */

function toDxfY(svgY: number): number {
  return MAHAR_SHEET_HEIGHT_MM - svgY;
}

function polylineEntity(points: Point[], layer: string): string {
  const lines = ["0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", "1", "43", "0.0"];
  for (const p of points) {
    lines.push("10", p.x.toFixed(3), "20", p.y.toFixed(3));
  }
  return lines.join("\n");
}

/** Recovers the item's true (pre-rotation) content width/height — mirrors lib/staging-transform.ts's getContentSize for the keychain module. */
function getContentSize(item: Pick<MaharLayoutItem, "width" | "height" | "rotated">): { width: number; height: number } {
  return item.rotated ? { width: item.height, height: item.width } : { width: item.width, height: item.height };
}

/** Places a local-space point at the item's packed position, rotating 90deg first if the packer rotated this item — mirrors lib/export-dxf.ts's own applyItemTransform. */
function applyItemTransform(item: Pick<MaharLayoutItem, "posX" | "posY" | "width" | "rotated">, point: Point): Point {
  if (!item.rotated) {
    return { x: point.x + item.posX, y: point.y + item.posY };
  }
  return { x: -point.y + item.posX + item.width, y: point.x + item.posY };
}

function layerDefinition(name: string): string[] {
  return ["0", "LAYER", "2", name, "70", "0", "62", "1", "6", "CONTINUOUS"];
}

function sheetBorderEntity(): string {
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: MAHAR_SHEET_WIDTH_MM, y: 0 },
    { x: MAHAR_SHEET_WIDTH_MM, y: MAHAR_SHEET_HEIGHT_MM },
    { x: 0, y: MAHAR_SHEET_HEIGHT_MM },
  ];
  return polylineEntity(
    corners.map((p) => ({ x: p.x, y: toDxfY(p.y) })),
    "CUT_BORDER"
  );
}

export function buildMaharSheetDxfDocument(items: MaharLayoutItem[]): string {
  const entities: string[] = [sheetBorderEntity()];

  for (const item of items) {
    const content = getContentSize(item);
    const localPoints = maharShapePoints(item.frameShape, content.width, content.height);
    const onSheetPoints = localPoints.map((p) => {
      const onSheet = applyItemTransform(item, p);
      return { x: onSheet.x, y: toDxfY(onSheet.y) };
    });
    entities.push(polylineEntity(onSheetPoints, "CUT_FRAME"));
  }

  const layers = ["CUT_FRAME", "CUT_BORDER"];

  return (
    [
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
    ].join("\n") + "\n"
  );
}

export function downloadMaharSheetDxf(items: MaharLayoutItem[], fileName = "mahar-lembar-kerja.dxf"): void {
  const dxf = buildMaharSheetDxfDocument(items);
  const blob = new Blob([dxf], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
