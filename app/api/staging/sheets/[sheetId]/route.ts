import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems } from "@/lib/db/schema";
import { describeLockedOrders, syncOrderStatuses } from "@/lib/receipt-status";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Bongkar" — deletes this sheet's pieces only.
 * The receipt returns to pending only when nothing of it remains on a
 * sheet or in a locked batch. Another part that is still arranged or
 * locked keeps the receipt in processing (P0.10 / feature D).
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

  const orders = db.transaction((tx) => {
    tx.delete(stagingItems).where(eq(stagingItems.sheetId, sheetId)).run();
    return describeLockedOrders(tx, syncOrderStatuses(tx, orderIds));
  });

  return NextResponse.json({ success: true, orders });
}
