import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printBatches, orderItems } from "@/lib/db/schema";
import { splitPiecesToRestore } from "@/lib/receipt-lock";
import { describeLockedOrders, restoreSplitPieces, syncOrderStatuses } from "@/lib/receipt-status";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Deletes the batch file.
 * A whole receipt stays completed — the keychains were already produced,
 * and this only removes the archive.
 * A split part is put back on a staging sheet (unlocked) and the receipt
 * status is recomputed. One deleted part does not finish or reopen the
 * other parts.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);

  if (!Number.isInteger(id)) {
    return badRequest("ID batch tidak valid");
  }

  const [batch] = await db.select().from(printBatches).where(eq(printBatches.id, id));
  if (!batch) {
    return badRequest("Batch tidak ditemukan", 404);
  }

  const plan = splitPiecesToRestore(batch.layoutData);
  if ("error" in plan) {
    return badRequest(plan.error, 409);
  }

  const result = db.transaction((tx) => {
    tx.update(orderItems).set({ batchId: null }).where(eq(orderItems.batchId, id)).run();
    const restored = restoreSplitPieces(tx, plan.pieces);
    tx.delete(printBatches).where(eq(printBatches.id, id)).run();
    const orderIds = [...new Set(plan.pieces.map((piece) => piece.orderId))];
    const lockedOrders =
      orderIds.length > 0 ? describeLockedOrders(tx, syncOrderStatuses(tx, orderIds, { exceptBatchId: id })) : [];
    return { restored: restored.length > 0, orders: lockedOrders };
  });

  return NextResponse.json({ success: true, restored: result.restored, orders: result.orders });
}
