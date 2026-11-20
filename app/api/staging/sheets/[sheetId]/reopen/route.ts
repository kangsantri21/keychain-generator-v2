import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems } from "@/lib/db/schema";
import { classifySheetProfile } from "@/lib/production-gate";
import { describeLockedOrders, syncOrderStatuses } from "@/lib/receipt-status";
import { STAGED_LEGACY, STAGED_PRODUCTION, STAGED_SHAPE, STAGING_COMPLETED } from "@/lib/staging-mode";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Buka Kunci" — a sheet marked selesai returns to the active list.
 * Only this sheet's pieces become unfinished. The receipt status is
 * recomputed from the parts that are still locked.
 * Rows saved before part_done (status "completed") get a layout status
 * back so the sheet can be locked again.
 */
function openStatus(item: { status: string; splitPart: number | null; rotationDeg: number | null; posX: number; posY: number }): string {
  if (item.status !== STAGING_COMPLETED) return item.status;
  if (item.splitPart != null || item.rotationDeg != null) return STAGED_SHAPE;
  return classifySheetProfile([{ posX: item.posX, posY: item.posY }]) === "production" ? STAGED_PRODUCTION : STAGED_LEGACY;
}

export async function POST(
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
  if (items.every((item) => !item.partDone && item.status !== STAGING_COMPLETED)) {
    return badRequest("Lembar ini belum dikunci");
  }

  const orderIds = [...new Set(items.map((item) => item.orderId))];

  const orders = db.transaction((tx) => {
    for (const item of items) {
      tx.update(stagingItems)
        .set({ partDone: false, status: openStatus(item) })
        .where(eq(stagingItems.id, item.id))
        .run();
    }
    return describeLockedOrders(tx, syncOrderStatuses(tx, orderIds));
  });

  return NextResponse.json({ success: true, orders });
}
