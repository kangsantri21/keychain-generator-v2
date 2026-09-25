import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { maharOrders } from "@/lib/db/mahar-schema";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Removes a mahar order still in the "pending" queue — mirrors the keychain module's own order delete (no dependents to clean up, since mahar has no staging table). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = Number(id);

  if (!Number.isInteger(orderId)) {
    return badRequest("ID pesanan mahar tidak valid");
  }

  const [existing] = await db.select().from(maharOrders).where(eq(maharOrders.id, orderId));
  if (!existing) {
    return badRequest("Pesanan mahar tidak ditemukan", 404);
  }
  if (existing.status !== "pending") {
    return badRequest("Hanya pesanan berstatus Pending yang bisa dihapus");
  }

  await db.delete(maharOrders).where(eq(maharOrders.id, orderId));

  return NextResponse.json({ success: true });
}
