/**
 * Feature D — lock one part of a receipt.
 *
 * A sheet lock (Tandai Selesai, or Kunci batch) finishes only the pieces on
 * that sheet. The order becomes `completed` only when every part is locked.
 * Until then the queue shows "1/2 bagian selesai". Dismantling or unlocking
 * one sheet recomputes from whatever pieces remain.
 *
 * `receiptIsComplete` (lib/receipt-parts.ts) is the completion rule.
 */

import { isAuthorizedOversizedSplit, receiptIsComplete, type ReceiptPartState } from "@/lib/receipt-parts";

export interface ReceiptPiece {
  orderId: number;
  sheetId: number;
  splitPart: number | null;
  splitCount: number | null;
  /** True when this piece sits on a locked sheet (part done, or frozen in a print batch). */
  locked: boolean;
}

export interface SheetPieceRef {
  orderId: number;
  sheetId: number;
  splitPart: number | null;
  splitCount: number | null;
}

export interface ReceiptLockView {
  status: "pending" | "processing" | "completed";
  doneParts: number;
  totalParts: number;
  /** Shown in place of "Diproses" when some but not all parts are locked. */
  progressLabel: string | null;
}

const OPEN_STATUSES = new Set(["staged", "staged-production", "staged-shape"]);

export interface RestorablePiece {
  orderId: number;
  templateId: number;
  customerName: string;
  sheetId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
  rotationDeg: number | null;
  splitPart: number | null;
  splitCount: number | null;
  status: string;
  holeOverrideX: number | null;
  holeOverrideY: number | null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/**
 * Nothing left → pending. Every part locked → completed. Anything still
 * arranged or only partly locked → processing, with a label when a split
 * has some locked parts.
 */
export function receiptLockView(pieces: ReceiptPiece[]): ReceiptLockView {
  if (pieces.length === 0) {
    return { status: "pending", doneParts: 0, totalParts: 0, progressLabel: null };
  }

  const count = pieces[0].splitCount ?? null;
  const uniformSplit =
    count != null &&
    count >= 2 &&
    pieces.every(
      (piece) => piece.splitCount === count && piece.splitPart != null && piece.splitPart >= 1 && piece.splitPart <= count
    );

  if (!uniformSplit) {
    const states: ReceiptPartState[] = pieces.map((piece) => ({
      splitPart: piece.splitPart,
      splitCount: piece.splitCount,
      done: piece.locked,
    }));
    const complete = receiptIsComplete(states);
    return {
      status: complete ? "completed" : "processing",
      doneParts: complete ? 1 : 0,
      totalParts: complete ? 1 : 0,
      progressLabel: null,
    };
  }

  const doneByPart = new Map<number, boolean>();
  for (const piece of pieces) {
    const part = piece.splitPart as number;
    doneByPart.set(part, (doneByPart.get(part) ?? true) && piece.locked);
  }
  const states: ReceiptPartState[] = [...doneByPart.entries()].map(([splitPart, done]) => ({
    splitPart,
    splitCount: count,
    done,
  }));
  const complete = receiptIsComplete(states);
  let doneParts = 0;
  for (let part = 1; part <= count; part++) {
    if (doneByPart.get(part) === true) doneParts += 1;
  }
  const progressLabel = doneParts > 0 && doneParts < count ? `${doneParts}/${count} bagian selesai` : null;
  return {
    status: complete ? "completed" : "processing",
    doneParts,
    totalParts: count,
    progressLabel,
  };
}

/**
 * Another open sheet blocks a lock unless, together with this sheet, the
 * receipt is one authorized oversized split (each sheet a different part).
 */
export function openSheetsBlockingLock(onSheet: SheetPieceRef[], elsewhere: SheetPieceRef[]): number[] {
  const orderIds = [...new Set(onSheet.map((piece) => piece.orderId))];
  const blocked: number[] = [];
  for (const orderId of orderIds) {
    const other = elsewhere.filter((piece) => piece.orderId === orderId);
    if (other.length === 0) continue;
    const combined = [...onSheet.filter((piece) => piece.orderId === orderId), ...other];
    const authorized = isAuthorizedOversizedSplit(
      combined.map((piece) => ({
        orderId: piece.orderId,
        sheet: piece.sheetId,
        splitPart: piece.splitPart,
        splitCount: piece.splitCount,
      }))
    );
    if (!authorized) blocked.push(orderId);
  }
  return blocked.sort((a, b) => a - b);
}

/** "1/2" when every piece on the sheet is the same part of a split. */
export function sheetSplitBadge(items: { splitPart?: number | null; splitCount?: number | null }[]): string | null {
  if (items.length === 0) return null;
  const part = items[0].splitPart ?? null;
  const count = items[0].splitCount ?? null;
  if (part == null || count == null || count < 2) return null;
  if (!items.every((item) => item.splitPart === part && item.splitCount === count)) return null;
  return `${part}/${count}`;
}

/** Locked pieces recorded in a print-batch layout (staging rows were removed at lock time). */
export function lockedPiecesFromLayout(layout: unknown): ReceiptPiece[] {
  if (!Array.isArray(layout)) return [];
  const pieces: ReceiptPiece[] = [];
  for (const raw of layout) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const orderId = finiteNumber(item.orderId);
    const sheetId = finiteNumber(item.sheetId);
    if (orderId == null || sheetId == null) continue;
    pieces.push({
      orderId,
      sheetId,
      splitPart: finiteNumber(item.splitPart),
      splitCount: finiteNumber(item.splitCount),
      locked: true,
    });
  }
  return pieces;
}

/**
 * Split pieces to put back on a sheet when a batch is deleted.
 * A whole receipt (no split mark) returns an empty list — deleting that
 * archive does not reopen the order. A broken split record refuses the delete.
 */
export function splitPiecesToRestore(layout: unknown): { pieces: RestorablePiece[] } | { error: string } {
  if (!Array.isArray(layout)) return { pieces: [] };
  const pieces: RestorablePiece[] = [];
  for (const raw of layout) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const splitCount = finiteNumber(item.splitCount);
    if (splitCount == null || splitCount < 2) continue;
    const orderId = finiteNumber(item.orderId);
    const templateId = finiteNumber(item.templateId);
    const sheetId = finiteNumber(item.sheetId);
    const posX = finiteNumber(item.posX);
    const posY = finiteNumber(item.posY);
    const width = finiteNumber(item.width);
    const height = finiteNumber(item.height);
    const splitPart = finiteNumber(item.splitPart);
    const customerName = typeof item.customerName === "string" ? item.customerName : "";
    if (
      orderId == null ||
      templateId == null ||
      sheetId == null ||
      posX == null ||
      posY == null ||
      width == null ||
      height == null ||
      splitPart == null ||
      customerName.length === 0
    ) {
      return { error: "Data bagian pecahan di batch tidak lengkap, batch tidak dihapus" };
    }
    const rawStatus = typeof item.status === "string" ? item.status : "";
    pieces.push({
      orderId,
      templateId,
      customerName,
      sheetId,
      posX,
      posY,
      width,
      height,
      rotated: item.rotated === true || item.rotated === 1,
      rotationDeg: finiteNumber(item.rotationDeg),
      splitPart,
      splitCount,
      status: OPEN_STATUSES.has(rawStatus) ? rawStatus : "staged-shape",
      holeOverrideX: finiteNumber(item.holeOverrideX),
      holeOverrideY: finiteNumber(item.holeOverrideY),
    });
  }
  return { pieces };
}
