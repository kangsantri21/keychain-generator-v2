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

  // SQLite FK enforcement isn't turned on for this connection, so the
  // schema's cascade annotations aren't actually applied by the engine —
  // clean up dependents manually, in dependency order, inside a transaction.
  db.transaction((tx) => {
    tx.delete(stagingItems).where(eq(stagingItems.orderId, orderId)).run();
    tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
    tx.delete(orders).where(eq(orders.id, orderId)).run();
  });

  return NextResponse.json({ success: true });
}
