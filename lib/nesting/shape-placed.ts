/**
 * Attaches the sheet-space cut outline to a placed row so the production
 * gate can measure cut-line gaps. Only shape-block rows (`staged-shape`)
 * get one. Older box layouts stay on the 2 mm box rules.
 */
import { BLOCK_GAP_MM, CUT_CLEARANCE_MM } from "@/lib/nesting/shape-block-config";
import { outlineOnSheet, rectOutline, translatePolys, type Pt } from "@/lib/nesting/shape-outline";
import { STAGED_SHAPE } from "@/lib/staging-mode";
import { itemRotationDeg } from "@/lib/staging-transform";

export function shapeGateFields(row: {
  status: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
  rotationDeg?: number | null;
}, render: { width: number; height: number; outlinePath: string | null } | null): { outline?: Pt[][]; cutClearanceMm?: number; blockGapMm?: number } {
  if (row.status !== STAGED_SHAPE) return {};
  const deg = itemRotationDeg(row);
  const outline = render
    ? outlineOnSheet(render.outlinePath, render.width, render.height, { posX: row.posX, posY: row.posY, rotationDeg: deg })
    : translatePolys(rectOutline(row.width, row.height), row.posX, row.posY);
  return { outline, cutClearanceMm: CUT_CLEARANCE_MM, blockGapMm: BLOCK_GAP_MM };
}
