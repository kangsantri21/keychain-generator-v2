/**
 * Writes `orders.status` from the pieces of a receipt.
 *
 * Locked pieces are staging rows with `part_done` (Tandai Selesai) and
 * pieces frozen in `print_batches.layout_data` (Kunci batch — those staging
 * rows are removed). Open staging rows are not locked.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, stagingItems } from "@/lib/db/schema";
import { receiptLockView, type ReceiptLockView, type ReceiptPiece, type RestorablePiece } from "@/lib/receipt-lock";

type StatusTx = {
  select: typeof db.select;
  update: typeof db.update;
  insert: typeof db.insert;
};

export interface OrderLockResult {
  id: number;
  receiptCode: string;
  status: ReceiptLockView["status"];
  progressLabel: string | null;
}

interface BatchPieceRow {
  batchId: number;
  orderId: number;
  sheetId: number;
  splitPart: number | null;
  splitCount: number | null;
}

function lockedBatchPieces(orderIds: number[], exceptBatchId?: number): ReceiptPiece[] {
  if (orderIds.length === 0) return [];
  const placeholders = orderIds.map(() => "?").join(", ");
  const params: number[] = [...orderIds];
  let except = "";
  if (exceptBatchId != null) {
    except = " AND print_batches.id != ?";
    params.push(exceptBatchId);
  }
  const rows = db.$client
    .prepare(
      `SELECT
         print_batches.id AS batchId,
         CAST(json_extract(j.value, '$.orderId') AS INTEGER) AS orderId,
         CAST(json_extract(j.value, '$.sheetId') AS INTEGER) AS sheetId,
         json_extract(j.value, '$.splitPart') AS splitPart,
         json_extract(j.value, '$.splitCount') AS splitCount
       FROM print_batches, json_each(print_batches.layout_data) AS j
       WHERE CAST(json_extract(j.value, '$.orderId') AS INTEGER) IN (${placeholders})${except}`
    )
    .all(...params) as BatchPieceRow[];
  return rows.map((row) => ({
    orderId: Number(row.orderId),
    sheetId: Number(row.sheetId),
    splitPart: row.splitPart == null ? null : Number(row.splitPart),
    splitCount: row.splitCount == null ? null : Number(row.splitCount),
    locked: true,
  }));
}

export function receiptViewsFor(
  tx: StatusTx,
  orderIds: number[],
  options?: { exceptBatchId?: number; extraLocked?: ReceiptPiece[] }
): Map<number, ReceiptLockView> {
  const unique = [...new Set(orderIds)];
  const views = new Map<number, ReceiptLockView>();
  if (unique.length === 0) return views;

  const staging = tx
    .select({
      orderId: stagingItems.orderId,
      sheetId: stagingItems.sheetId,
      splitPart: stagingItems.splitPart,
      splitCount: stagingItems.splitCount,
      status: stagingItems.status,
      partDone: stagingItems.partDone,
    })
    .from(stagingItems)
    .where(inArray(stagingItems.orderId, unique))
    .all();

  const byOrder = new Map<number, ReceiptPiece[]>();
  for (const id of unique) byOrder.set(id, []);
  for (const row of staging) {
    // A row whose status is "completed" is old history, not an active piece.
    // Bongkar ignores it the same way: it does not keep the receipt in
    // processing, and it does not by itself finish the receipt. A part locked
    // with part_done keeps its layout status, so it still counts.
    if (row.status === "completed") continue;
    byOrder.get(row.orderId)?.push({
      orderId: row.orderId,
      sheetId: row.sheetId,
      splitPart: row.splitPart,
      splitCount: row.splitCount,
      locked: row.partDone,
    });
  }
  for (const piece of lockedBatchPieces(unique, options?.exceptBatchId)) {
    if (byOrder.has(piece.orderId)) byOrder.get(piece.orderId)?.push(piece);
  }
  for (const piece of options?.extraLocked ?? []) {
    if (byOrder.has(piece.orderId)) byOrder.get(piece.orderId)?.push(piece);
  }
  for (const [orderId, pieces] of byOrder) views.set(orderId, receiptLockView(pieces));
  return views;
}

/** Recompute and store each order's status. Returns the same view the queue shows. */
export function syncOrderStatuses(
  tx: StatusTx,
  orderIds: number[],
  options?: { exceptBatchId?: number; extraLocked?: ReceiptPiece[] }
): Map<number, ReceiptLockView> {
  const views = receiptViewsFor(tx, orderIds, options);
  for (const [orderId, view] of views) {
    tx.update(orders).set({ status: view.status }).where(eq(orders.id, orderId)).run();
  }
  return views;
}

export function describeLockedOrders(tx: StatusTx, views: Map<number, ReceiptLockView>): OrderLockResult[] {
  const ids = [...views.keys()];
  if (ids.length === 0) return [];
  const rows = tx
    .select({ id: orders.id, receiptCode: orders.receiptCode })
    .from(orders)
    .where(inArray(orders.id, ids))
    .all();
  const codeOf = new Map(rows.map((row) => [row.id, row.receiptCode]));
  return ids.map((id) => {
    const view = views.get(id)!;
    return {
      id,
      receiptCode: codeOf.get(id) ?? `#${id}`,
      status: view.status,
      progressLabel: view.progressLabel,
    };
  });
}

/** Put split pieces back on a sheet. Uses the old sheet number when it is free. */
export function restoreSplitPieces(tx: StatusTx, pieces: RestorablePiece[]): RestorablePiece[] {
  if (pieces.length === 0) return [];
  const wanted = [...new Set(pieces.map((piece) => piece.sheetId))];
  const existing = tx
    .select({ sheetId: stagingItems.sheetId })
    .from(stagingItems)
    .where(inArray(stagingItems.sheetId, wanted))
    .all();
  const taken = new Set(existing.map((row) => row.sheetId));
  const [{ maxSheet }] = tx
    .select({ maxSheet: sql<number | null>`max(${stagingItems.sheetId})` })
    .from(stagingItems)
    .all();
  let next = (maxSheet ?? 0) + 1;
  const sheetOf = new Map<number, number>();
  for (const sheetId of wanted) {
    if (taken.has(sheetId)) {
      sheetOf.set(sheetId, next);
      next += 1;
    } else {
      sheetOf.set(sheetId, sheetId);
    }
  }
  const rows = pieces.map((piece) => ({
    orderId: piece.orderId,
    templateId: piece.templateId,
    customerName: piece.customerName,
    sheetId: sheetOf.get(piece.sheetId) ?? piece.sheetId,
    posX: piece.posX,
    posY: piece.posY,
    width: piece.width,
    height: piece.height,
    rotated: piece.rotated,
    rotationDeg: piece.rotationDeg,
    splitPart: piece.splitPart,
    splitCount: piece.splitCount,
    status: piece.status,
    partDone: false,
    holeOverrideX: piece.holeOverrideX,
    holeOverrideY: piece.holeOverrideY,
  }));
  tx.insert(stagingItems).values(rows).run();
  return pieces.map((piece) => ({ ...piece, sheetId: sheetOf.get(piece.sheetId) ?? piece.sheetId }));
}

export function progressByOrder(orderIds: number[]): Map<number, string | null> {
  const views = receiptViewsFor(db, orderIds);
  const labels = new Map<number, string | null>();
  for (const [id, view] of views) labels.set(id, view.progressLabel);
  return labels;
}
