/**
 * Printed frame and the one receipt code beside it.
 *
 * Recomputed from the placed pieces alone, with the same side rule the
 * packer used when it reserved the gutter (`labelSide`). The code is never
 * optional: every receipt gets exactly one label, outside the frame.
 */
import { LABEL_CHAR_EM, LABEL_FONT_MM, LABEL_GUTTER_MM, FRAME_PAD_MM, labelFontThatFits, labelSide, labelTextLength } from "@/lib/nesting/shape-block-config";
import { receiptPartLabel } from "@/lib/receipt-parts";
import { STAGED_SHAPE } from "@/lib/staging-mode";

const ASCENT = 0.8;

export interface MarkItem {
  orderId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  status?: string;
  order?: { receiptCode: string } | null;
  /** Set on each piece of an authorized split. The label becomes "<kode> 1/2". */
  splitPart?: number | null;
  splitCount?: number | null;
}

export interface BlockFrame {
  orderId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SideLabel {
  orderId: number;
  text: string;
  status: "PLACED";
  rect: { x: number; y: number; w: number; h: number };
  rotation: 0 | 90;
  fontSize: number;
  transform: string;
  textLength: number;
}

export function isShapeSheet(items: { status?: string }[]): boolean {
  return items.length > 0 && items.every((item) => item.status === STAGED_SHAPE);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function unionOf(items: MarkItem[]): { x: number; y: number; w: number; h: number } {
  const x = Math.min(...items.map((item) => item.posX));
  const y = Math.min(...items.map((item) => item.posY));
  const right = Math.max(...items.map((item) => item.posX + item.width));
  const bottom = Math.max(...items.map((item) => item.posY + item.height));
  return { x, y, w: right - x, h: bottom - y };
}

export function framesAndLabels(
  items: MarkItem[],
  codeOf: (orderId: number, group?: MarkItem[]) => string,
  pad = FRAME_PAD_MM,
  gutter = LABEL_GUTTER_MM
): { frames: BlockFrame[]; labels: SideLabel[] } {
  const byPart = new Map<string, MarkItem[]>();
  for (const item of items) {
    const key = `${item.orderId}:${item.splitPart ?? 0}`;
    const list = byPart.get(key);
    if (list) list.push(item);
    else byPart.set(key, [item]);
  }
  const frames: BlockFrame[] = [];
  const labels: SideLabel[] = [];
  for (const group of [...byPart.values()].sort((a, b) => a[0].orderId - b[0].orderId || (a[0].splitPart ?? 0) - (b[0].splitPart ?? 0))) {
    const orderId = group[0].orderId;
    const box = unionOf(group);
    const frame = { orderId, x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
    frames.push(frame);
    const text = codeOf(orderId, group);
    const side = labelSide(frame.w, frame.h);
    const along = side === "left" ? frame.h : frame.w;
    const fontSize = labelFontThatFits(text, along, LABEL_FONT_MM);
    const textLength = Math.min(labelTextLength(text, fontSize), along);
    const rect =
      side === "left"
        ? { x: frame.x - gutter, y: frame.y, w: gutter, h: frame.h }
        : { x: frame.x, y: frame.y + frame.h, w: frame.w, h: gutter };
    const rotation: 0 | 90 = side === "left" ? 90 : 0;
    // The glyphs sit inside the gutter, starting at the frame's top (left side) or left (bottom side).
    const transform =
      rotation === 0
        ? `translate(${round(rect.x)}, ${round(rect.y + (gutter - fontSize) / 2 + ASCENT * fontSize)})`
        : `translate(${round(rect.x + (gutter + fontSize) / 2 - (1 - ASCENT) * fontSize)}, ${round(rect.y)}) rotate(90)`;
    labels.push({
      orderId,
      text,
      status: "PLACED",
      rect,
      rotation,
      fontSize,
      transform,
      textLength: round(textLength),
    });
  }
  return { frames, labels };
}

/** Frames for a shape-block sheet. Empty for any other sheet. */
export function shapeFramesOf(items: MarkItem[]): BlockFrame[] {
  if (!isShapeSheet(items)) return [];
  const codeOf = (orderId: number) => items.find((item) => item.orderId === orderId)?.order?.receiptCode ?? "";
  return framesAndLabels(items, codeOf).frames;
}

/** One side label per receipt, or null when this is not a shape-block sheet. */
export function shapeLabelsOf(items: MarkItem[]): SideLabel[] | null {
  if (!isShapeSheet(items)) return null;
  const codeOf = (orderId: number, group?: MarkItem[]) => {
    const item = group?.[0] ?? items.find((candidate) => candidate.orderId === orderId);
    const code = item?.order?.receiptCode ?? `#${orderId}`;
    return receiptPartLabel(code, item?.splitPart, item?.splitCount);
  };
  return framesAndLabels(items, codeOf).labels;
}

export { LABEL_CHAR_EM };
