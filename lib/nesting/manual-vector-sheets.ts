/**
 * Pieces traced from the design team's cut files (Illustrator 3 / CorelDRAW).
 * The fixture stores one closed cut outline per piece, in millimetres, plus
 * where that piece sat on the manual sheet. Receipt codes were print-only
 * and were not in the cut export, so each physical frame is one block.
 */
import type { ShapeBlockItem } from "@/lib/nesting/shape-block-nesting";
import type { Pt } from "@/lib/nesting/shape-outline";

export interface VectorPiece {
  /** Top-left of the piece on the manual frame, y downward. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Flat [x, y, x, y, ...] ring in the piece's own box, y downward. */
  p: number[];
}

export interface VectorSheet {
  id: string;
  label: string;
  frameW: number;
  frameH: number;
  pieces: VectorPiece[];
}

export function ringOf(flat: number[]): Pt[] {
  const ring: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) ring.push({ x: flat[i], y: flat[i + 1] });
  return ring;
}

/** One traced frame, one receipt. The packer may turn pieces. It splits the frame only when the pieces do not fit one sheet. */
export function itemsFromVectorSheet(sheet: VectorSheet): ShapeBlockItem<null>[] {
  return sheet.pieces.map((piece, index) => ({
    id: `${sheet.id}-${index}`,
    orderId: 1,
    width: piece.w,
    height: piece.h,
    allowRotation: true,
    outline: [ringOf(piece.p)],
    receiptCode: `${sheet.label} ${sheet.id.split("-")[1]}`,
    data: null,
  }));
}
