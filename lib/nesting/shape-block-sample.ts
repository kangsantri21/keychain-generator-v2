/**
 * Sample batches for the shape-block packer.
 *
 * `manualLikeBatch` mimics the handwritten sheet: about ten receipts, names
 * of 3–10 letters, plus one receipt of small character plates. `layoutByHand`
 * is a shelf of columns — the kind of arrangement the production team draws,
 * not the machine's own output.
 */
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { BLOCK_GAP_MM, CUT_CLEARANCE_MM, FRAME_PAD_MM, LABEL_GUTTER_MM, SHAPE_SHEET_MARGIN_MM, labelSide } from "@/lib/nesting/shape-block-config";
import type { ShapeBlockItem } from "@/lib/nesting/shape-block-nesting";
import { notchedNameOutline, rectOutline, type Pt } from "@/lib/nesting/shape-outline";

export interface SamplePiece {
  orderId: number;
  code: string;
  name: string;
  width: number;
  height: number;
  outline: Pt[][];
}

const NAME_HEIGHT = 20;

function nameWidth(letters: number): number {
  return Math.min(80, 6 + letters * 7);
}

export function manualLikeBatch(): SamplePiece[] {
  const receipts: { code: string; names: string[] }[] = [
    { code: "260423FVP8THM6", names: ["Aira", "Rafa", "Aska", "Dipta", "Labib"] },
    { code: "260423DWEG38", names: ["Faran", "Aisha", "Naura", "Aruan", "Rasoa"] },
    { code: "260511AMMARA", names: ["Marsha", "Jasmine", "Ammara", "Hurin"] },
    { code: "260511SHANUM", names: ["Aulia", "Husan", "Seva", "Shanum", "Laila"] },
    { code: "260512RENDRA", names: ["Rendra", "Rindra", "Fahim", "Faiza"] },
    { code: "260512RASYA", names: ["Rasya", "Mikayla", "Cleo", "Keswari"] },
    { code: "260513AURI", names: ["Auri", "Ezra", "Mezza", "Alea", "Nabila"] },
    { code: "260513SULTAN", names: ["Sultan", "Rian", "Damar", "Hasan", "Zidan"] },
    { code: "260514ARIFA", names: ["Arifa", "Edgar", "Dhara", "Margo", "Malika"] },
    { code: "260514TANIA", names: ["Tania", "Budi", "Siti", "Dewi"] },
  ];
  const pieces: SamplePiece[] = [];
  receipts.forEach((receipt, orderId) => {
    for (const name of receipt.names) {
      const width = nameWidth(name.length);
      const height = NAME_HEIGHT;
      pieces.push({
        orderId: orderId + 1,
        code: receipt.code,
        name,
        width,
        height,
        outline: notchedNameOutline(width, height),
      });
    }
  });
  // One receipt of character plates, like the cups along the bottom of the manual sheet.
  for (let i = 0; i < 6; i++) {
    const width = 30;
    const height = 34;
    pieces.push({
      orderId: 11,
      code: "260515CHAR01",
      name: `Tokoh ${i + 1}`,
      width,
      height,
      outline: rectOutline(width, height),
    });
  }
  return pieces;
}

export function toShapeItems(pieces: SamplePiece[]): ShapeBlockItem<{ name: string }>[] {
  return pieces.map((piece, index) => ({
    id: index + 1,
    orderId: piece.orderId,
    width: piece.width,
    height: piece.height,
    allowRotation: true,
    outline: piece.outline,
    receiptCode: piece.code,
    data: { name: piece.name },
  }));
}

export interface HandPlacement {
  orderId: number;
  code: string;
  name: string;
  sheetIndex: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotationDeg: 0 | 90;
}

export interface HandLayout {
  placements: HandPlacement[];
  sheetCount: number;
  sumUsedHeight: number;
}

/**
 * A careful hand layout: long names become a column, blocks sit on shelves,
 * each block has the same frame pad and label gutter the machine reserves.
 * Notches are ignored — the hand keeps a full gap between boxes.
 */
export function layoutByHand(pieces: SamplePiece[], gap = CUT_CLEARANCE_MM): HandLayout {
  const groups = new Map<number, SamplePiece[]>();
  for (const piece of pieces) {
    const list = groups.get(piece.orderId);
    if (list) list.push(piece);
    else groups.set(piece.orderId, [piece]);
  }
  const margin = SHAPE_SHEET_MARGIN_MM;
  const maxInnerH = SHEET_HEIGHT_MM - 2 * margin - 2 * FRAME_PAD_MM - LABEL_GUTTER_MM;
  const maxInnerW = SHEET_WIDTH_MM - 2 * margin - 2 * FRAME_PAD_MM - LABEL_GUTTER_MM;

  interface Block {
    orderId: number;
    code: string;
    placements: HandPlacement[];
    w: number;
    h: number;
  }
  const blocks: Block[] = [];
  for (const [orderId, group] of groups) {
    const local: HandPlacement[] = [];
    let x = 0;
    let y = 0;
    let colW = 0;
    for (const piece of group) {
      const turn = piece.width > piece.height + 0.5;
      const w = turn ? piece.height : piece.width;
      const h = turn ? piece.width : piece.height;
      if (y > 0 && y + h > maxInnerH) {
        x += colW + gap;
        y = 0;
        colW = 0;
      }
      local.push({
        orderId,
        code: piece.code,
        name: piece.name,
        sheetIndex: 0,
        posX: x,
        posY: y,
        width: w,
        height: h,
        rotationDeg: turn ? 90 : 0,
      });
      y += h + gap;
      colW = Math.max(colW, w);
    }
    const contentW = Math.max(...local.map((p) => p.posX + p.width));
    const contentH = Math.max(...local.map((p) => p.posY + p.height));
    const frameW = contentW + 2 * FRAME_PAD_MM;
    const frameH = contentH + 2 * FRAME_PAD_MM;
    const side = labelSide(frameW, frameH);
    blocks.push({
      orderId,
      code: group[0].code,
      placements: local.map((p) => ({
        ...p,
        posX: p.posX + FRAME_PAD_MM + (side === "left" ? LABEL_GUTTER_MM : 0),
        posY: p.posY + FRAME_PAD_MM,
      })),
      w: side === "left" ? frameW + LABEL_GUTTER_MM : frameW,
      h: side === "bottom" ? frameH + LABEL_GUTTER_MM : frameH,
    });
  }

  // Shelf. Try turning a block 90° when that is the one that still fits the row.
  let sheet = 0;
  let cursorX = margin;
  let cursorY = margin;
  let rowH = 0;
  const bottoms = new Map<number, number>();
  const placed: HandPlacement[] = [];
  for (const block of blocks) {
    const options = [
      { rot: 0 as const, w: block.w, h: block.h },
      { rot: 90 as const, w: block.h, h: block.w },
    ].filter((option) => option.w <= SHEET_WIDTH_MM - 2 * margin && option.h <= SHEET_HEIGHT_MM - 2 * margin);
    const fitsRow = (option: { w: number; h: number }) => cursorX + option.w <= SHEET_WIDTH_MM - margin + 0.01;
    let option = options.find((candidate) => fitsRow(candidate)) ?? options[0];
    if (!option) continue;
    if (!fitsRow(option)) {
      cursorY += rowH + BLOCK_GAP_MM;
      cursorX = margin;
      rowH = 0;
      if (cursorY + option.h > SHEET_HEIGHT_MM - margin) {
        sheet += 1;
        cursorY = margin;
      }
    }
    for (const piece of block.placements) {
      const px = option.rot === 0 ? piece.posX : block.h - (piece.posY + piece.height);
      const py = option.rot === 0 ? piece.posY : piece.posX;
      const pw = option.rot === 0 ? piece.width : piece.height;
      const ph = option.rot === 0 ? piece.height : piece.width;
      const rotationDeg = ((piece.rotationDeg + option.rot) % 360) as 0 | 90;
      placed.push({
        ...piece,
        sheetIndex: sheet,
        posX: cursorX + px,
        posY: cursorY + py,
        width: pw,
        height: ph,
        rotationDeg,
      });
    }
    cursorX += option.w + BLOCK_GAP_MM;
    rowH = Math.max(rowH, option.h);
    bottoms.set(sheet, Math.max(bottoms.get(sheet) ?? 0, cursorY + option.h));
  }
  return {
    placements: placed,
    sheetCount: bottoms.size,
    sumUsedHeight: [...bottoms.values()].reduce((sum, value) => sum + value, 0),
  };
}
