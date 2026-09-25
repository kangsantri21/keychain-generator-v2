import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, stagingItems } from "@/lib/db/schema";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);

  if (!Number.isInteger(orderId)) {
    return badRequest("ID pesanan tidak valid");
  }

  const [existing] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!existing) {
    return badRequest("Pesanan tidak ditemukan", 404);
  }
  // "Hapus Resi" (Order Queue) only ever targets Pending/Diproses orders —
  // the table itself never shows a Completed one (GET /api/orders excludes
  // it), but this guard covers a stale client reference too, so a batch
  // already locked into production can never be silently deleted out from
  // under it.
  if (existing.status === "completed") {
    return badRequest("Pesanan yang sudah Selesai tidak bisa dihapus dari sini");
  }

  // FK enforcement is on for this connection, and staging_items->orders has
  // no ON DELETE clause (default RESTRICT) — deleting the order directly
  // would throw a constraint violation while staging_items still reference
  // it. Clean up dependents manually, in dependency order, in a transaction.
  db.transaction((tx) => {
    tx.delete(stagingItems).where(eq(stagingItems.orderId, orderId)).run();
    tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
    tx.delete(orders).where(eq(orders.id, orderId)).run();
  });

  return NextResponse.json({ success: true });
}
