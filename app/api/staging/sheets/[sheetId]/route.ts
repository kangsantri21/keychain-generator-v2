import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, stagingItems } from "@/lib/db/schema";
import { describeLockedOrders, syncOrderStatuses } from "@/lib/receipt-status";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Bongkar" — deletes this sheet's pieces only.
 *
 * Same rule as the per-receipt dismantle: a receipt goes back to pending
 * only when it has no active piece left on another sheet. A piece that is
 * still arranged, or locked as one part (part_done or a print batch), keeps
 * the receipt in processing. A receipt that is already completed is left
 * completed — Buka Kunci is what reopens a finished part.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const { sheetId: sheetIdRaw } = await params;
  const sheetId = Number(sheetIdRaw);

  if (!Number.isInteger(sheetId)) {
    return badRequest("ID lembar kerja tidak valid");
  }

  const items = await db.select().from(stagingItems).where(eq(stagingItems.sheetId, sheetId));
  if (items.length === 0) {
    return badRequest("Lembar kerja tidak ditemukan", 404);
  }

  const orderIds = [...new Set(items.map((item) => item.orderId))];

  const receipts = db.transaction((tx) => {
    tx.delete(stagingItems).where(eq(stagingItems.sheetId, sheetId)).run();
    const current = tx.select().from(orders).where(inArray(orders.id, orderIds)).all();
    const openIds = current.filter((order) => order.status !== "completed").map((order) => order.id);
    const described = describeLockedOrders(tx, syncOrderStatuses(tx, openIds));
    for (const order of current) {
      if (order.status !== "completed") continue;
      if (described.some((row) => row.id === order.id)) continue;
      described.push({ id: order.id, receiptCode: order.receiptCode, status: "completed", progressLabel: null });
    }
    return described;
  });

  return NextResponse.json({ success: true, orders: receipts });
}
