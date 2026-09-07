import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { printBatches, orderItems, orders, stagingItems } from "@/lib/db/schema";
import { isUniqueConstraintError } from "@/lib/template-files";
import type { StagingItemPayload } from "@/lib/staging-types";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function formatMMDD(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}${dd}`;
}

function isValidLayoutItem(value: unknown): value is StagingItemPayload {
  const item = value as Partial<StagingItemPayload> | null;
  return (
    !!item &&
    typeof item === "object" &&
    typeof item.id === "number" &&
    typeof item.orderId === "number" &&
    typeof item.templateId === "number"
  );
}

export async function GET() {
  const rows = await db.select().from(printBatches).orderBy(desc(printBatches.createdAt));
  return NextResponse.json({ batches: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const sheetId = Number(body?.sheetId);
  const items: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const canvasWidth = Number(body?.canvasWidth);
  const canvasHeight = Number(body?.canvasHeight);
  const requestedCode = typeof body?.batchCode === "string" ? body.batchCode.trim() : "";

  if (!Number.isInteger(sheetId)) {
    return badRequest("ID lembar kerja tidak valid");
  }
  if (items.length === 0 || !items.every(isValidLayoutItem)) {
    return badRequest("Lembar kerja kosong atau datanya tidak valid");
  }
  if (!Number.isInteger(canvasWidth) || canvasWidth <= 0 || !Number.isInteger(canvasHeight) || canvasHeight <= 0) {
    return badRequest("Ukuran kanvas tidak valid");
  }

  const layoutData = items as StagingItemPayload[];
  const orderIds = [...new Set(layoutData.map((item) => item.orderId))];

  // A staged item only carries orderId+templateId, not the order_items row
  // it came from — back into that row by matching those two fields (see
  // the batchId doc comment in lib/db/schema.ts for the caveat this implies
  // when one item's names get split across separate nesting runs).
  const candidateOrderItems = orderIds.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
    : [];
  const pairsInBatch = new Set(layoutData.map((item) => `${item.orderId}:${item.templateId}`));
  const matchedOrderItemIds = candidateOrderItems
    .filter((oi) => pairsInBatch.has(`${oi.orderId}:${oi.templateId}`))
    .map((oi) => oi.id);

  let batchCode = requestedCode || `BATCH-${formatMMDD(new Date())}`;
  let suffix = 1;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const batch = db.transaction((tx) => {
        const [inserted] = tx
          .insert(printBatches)
          .values({
            batchCode,
            layoutData,
            canvasWidth,
            canvasHeight,
            status: "pending",
          })
          .returning()
          .all();

        if (matchedOrderItemIds.length > 0) {
          tx.update(orderItems)
            .set({ batchId: inserted.id })
            .where(inArray(orderItems.id, matchedOrderItemIds))
            .run();
        }
        if (orderIds.length > 0) {
          tx.update(orders).set({ status: "completed" }).where(inArray(orders.id, orderIds)).run();
        }
        tx.delete(stagingItems).where(eq(stagingItems.sheetId, sheetId)).run();

        return inserted;
      });

      return NextResponse.json({ batch }, { status: 201 });
    } catch (error) {
      if (isUniqueConstraintError(error) && !requestedCode) {
        suffix += 1;
        batchCode = `BATCH-${formatMMDD(new Date())}-${suffix}`;
        continue;
      }
      if (isUniqueConstraintError(error)) {
        return badRequest("Kode batch sudah digunakan, gunakan kode lain");
      }
      return badRequest("Gagal menyimpan batch produksi", 500);
    }
  }

  return badRequest("Gagal membuat kode batch unik, coba lagi", 500);
}
