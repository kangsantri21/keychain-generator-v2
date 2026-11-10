/**
 * Internal receipt labels for Production Nesting sheets — a QC annotation
 * pass that runs AFTER the layout is final. Pure, deterministic, read-only:
 * it takes the placed items as they are and never moves, resizes or adds
 * anything to the layout. The nesting engine knows nothing about labels.
 *
 * A receipt's label may only use space that is already empty INSIDE that
 * receipt's box (the bounding box of its artwork footprints): it must stay
 * LABEL_CLEARANCE_MM away from every artwork footprint on the sheet, fully
 * inside the box, and out of the camera-fiducial keep-out. Tried from the
 * normal size down to the minimum, 0° before 90°; among the fits the one
 * with the most room around it (a real void before a narrow strip) wins.
 * When nothing fits the receipt is reported NO_SAFE_INTERNAL_LABEL — the
 * layout stays as it is and the sheet is NOT invalid because of it.
 *
 * Legacy sheets keep their per-item labels (lib/staging-transform.ts
 * getReceiptLabelPosition), unchanged.
 */
import { RECEIPT_LABEL_FONT_SIZE_MM } from "@/lib/keychain-geometry";
import { FIDUCIAL_CLEARANCE_MM } from "@/lib/nesting/grouped-nesting-config";
import { shapeLabelsOf, type SideLabel } from "@/lib/nesting/shape-block-marks";
import { fiducialDistance, receiptBoxes } from "@/lib/production-gate";
import { sheetModeOf } from "@/lib/staging-mode";

/** Font sizes tried, normal first; the smallest is the label size already used in production. */
export const INTERNAL_LABEL_FONT_SIZES_MM = [3, 2.5, 2.2, RECEIPT_LABEL_FONT_SIZE_MM] as const;
/** Minimum distance between a label and any artwork footprint. */
export const LABEL_CLEARANCE_MM = 0.5;
/** Conservative text advance per character (em). The label is also drawn with textLength = this width. */
export const LABEL_CHAR_WIDTH_EM = 0.72;
/** Text box height (em): ascender 0.8 above the baseline + descender 0.2 below. */
const LABEL_ASCENT_EM = 0.8;
const LABEL_HEIGHT_EM = 1;
const EPS = 1e-6;
/** Clearance beyond which extra room no longer ranks a position higher. */
const ROOM_CAP_MM = 10;

export type InternalLabelStatus = "PLACED" | "NO_SAFE_INTERNAL_LABEL";

export interface InternalLabel {
  orderId: number;
  text: string;
  status: InternalLabelStatus;
  /** Present when PLACED: the label's footprint in sheet coordinates. */
  rect?: { x: number; y: number; w: number; h: number };
  rotation?: 0 | 90;
  fontSize?: number;
  /** SVG transform that draws `<text x=0 y=0>` (with textLength) exactly inside `rect`. */
  transform?: string;
  textLength?: number;
}

type Footprint = { orderId: number; posX: number; posY: number; width: number; height: number };
type Rect = { x: number; y: number; w: number; h: number };

const gapBetween = (a: Rect, b: Footprint) =>
  Math.hypot(
    Math.max(0, b.posX - (a.x + a.w), a.x - (b.posX + b.width)),
    Math.max(0, b.posY - (a.y + a.h), a.y - (b.posY + b.height))
  );

export function labelTextWidth(text: string, fontSize: number): number {
  return text.length * LABEL_CHAR_WIDTH_EM * fontSize;
}

/**
 * Places one internal label per receipt on a sheet. `codeOf` gives the text
 * (receipt code) per orderId. Never mutates `items`.
 */
export function placeInternalReceiptLabels(items: Footprint[], codeOf: (orderId: number) => string): InternalLabel[] {
  return receiptBoxes(items).map(({ orderId, rect: box }) => {
    const text = codeOf(orderId);
    for (const fontSize of INTERNAL_LABEL_FONT_SIZES_MM) {
      for (const rotation of [0, 90] as const) {
        const along = labelTextWidth(text, fontSize);
        const across = LABEL_HEIGHT_EM * fontSize;
        const [w, h] = rotation === 0 ? [along, across] : [across, along];
        const best = bestPosition(box, w, h, items);
        if (best) {
          const rect = { x: best.x, y: best.y, w, h };
          const transform =
            rotation === 0
              ? `translate(${round(rect.x)}, ${round(rect.y + LABEL_ASCENT_EM * fontSize)})`
              : `translate(${round(rect.x + (LABEL_HEIGHT_EM - LABEL_ASCENT_EM) * fontSize)}, ${round(rect.y)}) rotate(90)`;
          return { orderId, text, status: "PLACED" as const, rect, rotation, fontSize, transform, textLength: round(along) };
        }
      }
    }
    return { orderId, text, status: "NO_SAFE_INTERNAL_LABEL" as const };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Best free w x h spot inside `box`: candidate corners come from the box
 * edges and the artwork edges (+ clearance) — every maximal empty corner of
 * the box is among them. Ranked by room to the nearest artwork (voids
 * first), then top-to-bottom, left-to-right.
 */
function bestPosition(box: Rect, w: number, h: number, items: Footprint[]): { x: number; y: number } | null {
  if (w > box.w + EPS || h > box.h + EPS) return null;
  const c = LABEL_CLEARANCE_MM;
  const near = items.filter((i) => i.posX < box.x + box.w + c && i.posX + i.width > box.x - c && i.posY < box.y + box.h + c && i.posY + i.height > box.y - c);
  const xs = new Set<number>([box.x, box.x + box.w - w]);
  const ys = new Set<number>([box.y, box.y + box.h - h]);
  for (const i of near) {
    xs.add(i.posX + i.width + c);
    xs.add(i.posX - c - w);
    ys.add(i.posY + i.height + c);
    ys.add(i.posY - c - h);
  }
  let best: { x: number; y: number; room: number } | null = null;
  for (const y of [...ys].sort((a, b) => a - b)) {
    if (y < box.y - EPS || y + h > box.y + box.h + EPS) continue;
    for (const x of [...xs].sort((a, b) => a - b)) {
      if (x < box.x - EPS || x + w > box.x + box.w + EPS) continue;
      const rect = { x, y, w, h };
      let room = ROOM_CAP_MM;
      for (const i of near) room = Math.min(room, gapBetween(rect, i));
      if (room < c - EPS) continue;
      if (fiducialDistance({ posX: x, posY: y, width: w, height: h }) < FIDUCIAL_CLEARANCE_MM - EPS) continue;
      if (!best || room > best.room + EPS) best = { x, y, room };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Internal labels for a staged/locked sheet, or null for a legacy sheet
 * (which keeps its per-item labels). Mode from the explicit staging marker
 * (lib/staging-mode.ts), geometry only for marker-less history.
 */
export function internalLabelsOf(sheet: {
  items: (Footprint & { status: string; order: { receiptCode: string } | null })[];
}): InternalLabel[] | null {
  if (sheetModeOf(sheet.items).mode === "legacy") return null;
  const side = shapeLabelsOf(sheet.items);
  if (side) return side.map(sideLabelAsInternal);
  const codes = new Map(sheet.items.map((item) => [item.orderId, item.order?.receiptCode ?? `#${item.orderId}`]));
  return placeInternalReceiptLabels(sheet.items, (orderId) => codes.get(orderId) ?? `#${orderId}`);
}

function sideLabelAsInternal(label: SideLabel): InternalLabel {
  return {
    orderId: label.orderId,
    text: label.text,
    status: "PLACED",
    rect: label.rect,
    rotation: label.rotation,
    fontSize: label.fontSize,
    transform: label.transform,
    textLength: label.textLength,
  };
}
