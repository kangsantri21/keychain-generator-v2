import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems } from "@/lib/db/schema";
import { describeLockedOrders, syncOrderStatuses } from "@/lib/receipt-status";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Tandai Selesai" — locks the pieces on this sheet only.
 * The receipt becomes completed only when every part is locked
 * (lib/receipt-lock.ts). A split stays processing and the queue shows
 * "1/2 bagian selesai" until the other parts are locked too.
 * The layout status is kept so Buka Kunci can return the sheet.
 */
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
  if (items.some((item) => item.partDone || item.status === "completed")) {
    return badRequest("Lembar ini sudah ditandai selesai");
  }

  const orderIds = [...new Set(items.map((item) => item.orderId))];

  const orders = db.transaction((tx) => {
    tx.update(stagingItems).set({ partDone: true }).where(eq(stagingItems.sheetId, sheetId)).run();
    return describeLockedOrders(tx, syncOrderStatuses(tx, orderIds));
  });

  return NextResponse.json({ success: true, orders });
}
