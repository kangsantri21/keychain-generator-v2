import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { printBatches, orderItems } from "@/lib/db/schema";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Archive cleanup only — deletes the batch record (and its downloadable
 * layoutData) but does NOT touch the orders it came from, which stay
 * "completed". The physical keychains were already produced; this just
 * removes the file record, mirroring how "Bongkar" (app/api/staging/sheets/
 * [sheetId]/route.ts) is the separate, distinct action for undoing
 * production before it happens.
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

  db.transaction((tx) => {
    tx.update(orderItems).set({ batchId: null }).where(eq(orderItems.batchId, id)).run();
    tx.delete(printBatches).where(eq(printBatches.id, id)).run();
  });

  return NextResponse.json({ success: true });
}
