import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems, orders } from "@/lib/db/schema";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Bongkar" — dismantles a staging sheet without touching the underlying
 * order data: only the staging_items rows (this nested instance) are
 * deleted, while the orders they came from revert to "pending" so they
 * fall back into the pool the next nesting run picks up. order_items
 * (the customer names themselves) are never touched by this at all.
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

  db.transaction((tx) => {
    tx.delete(stagingItems).where(eq(stagingItems.sheetId, sheetId)).run();
    for (const orderId of orderIds) {
      const [order] = tx.select().from(orders).where(eq(orders.id, orderId)).all();
      if (!order || order.status === "completed") continue;
      const stillActive = tx
        .select({ id: stagingItems.id })
        .from(stagingItems)
        .where(and(eq(stagingItems.orderId, orderId), ne(stagingItems.status, "completed")))
        .all();
      tx.update(orders)
        .set({ status: stillActive.length > 0 ? "processing" : "pending" })
        .where(eq(orders.id, orderId))
        .run();
    }
  });

  return NextResponse.json({ success: true });
}
