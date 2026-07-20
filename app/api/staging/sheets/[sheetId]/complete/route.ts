import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems, orders } from "@/lib/db/schema";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Tandai Selesai" — marks a staging sheet (and every order it draws from)
 * as completed. Completed orders drop out of both the nesting pool
 * (GET /api/staging/nest only pulls "pending" orders) and the main Input
 * Pesanan queue (GET /api/orders excludes "completed"), and the sheet
 * itself moves from the Staging Area's active list into its history view.
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

  const orderIds = [...new Set(items.map((item) => item.orderId))];

  db.transaction((tx) => {
    tx.update(stagingItems).set({ status: "completed" }).where(eq(stagingItems.sheetId, sheetId)).run();
    tx.update(orders).set({ status: "completed" }).where(inArray(orders.id, orderIds)).run();
  });

  return NextResponse.json({ success: true });
}
