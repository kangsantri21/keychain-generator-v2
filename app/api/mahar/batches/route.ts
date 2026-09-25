import { NextRequest, NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { maharOrders, maharBatches, type NewMaharBatch } from "@/lib/db/mahar-schema";
import { isUniqueConstraintError } from "@/lib/template-files";
import type { MaharLayoutItem } from "@/lib/mahar-types";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function formatMMDD(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}${dd}`;
}

interface PlacementInput {
  orderId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
}

function isValidPlacement(value: unknown): value is PlacementInput {
  const p = value as Partial<PlacementInput> | null;
  return (
    !!p &&
    typeof p === "object" &&
    Number.isInteger(p.orderId) &&
    typeof p.posX === "number" &&
    Number.isFinite(p.posX) &&
    typeof p.posY === "number" &&
    Number.isFinite(p.posY) &&
    typeof p.width === "number" &&
    Number.isFinite(p.width) &&
    typeof p.height === "number" &&
    Number.isFinite(p.height) &&
    typeof p.rotated === "boolean"
  );
}

export async function GET() {
  const rows = await db.select().from(maharBatches).orderBy(desc(maharBatches.createdAt));
  return NextResponse.json({ batches: rows });
}

/**
 * Locks a client-computed nesting layout (see app/mahar-nesting/page.tsx —
 * `packMaxRects` runs entirely in the browser, since a mahar item's size is
 * already known upfront from its preset, unlike the keychain module's own
 * nest route which must render glyph outlines server-side first) into a
 * permanent maharBatches record. The client is only trusted for the
 * computed placement (posX/posY/width/height/rotated); every other field
 * (brideName, nominal, frameShape, ...) is re-read from the current
 * maharOrders row server-side, so a tampered request body can never write
 * arbitrary text into a locked production record.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const placements: unknown[] = Array.isArray(body?.placements) ? body.placements : [];
  const canvasWidth = Number(body?.canvasWidth);
  const canvasHeight = Number(body?.canvasHeight);
  const requestedCode = typeof body?.batchCode === "string" ? body.batchCode.trim() : "";

  if (placements.length === 0 || !placements.every(isValidPlacement)) {
    return badRequest("Susunan lembar kerja kosong atau datanya tidak valid");
  }
  if (!Number.isInteger(canvasWidth) || canvasWidth <= 0 || !Number.isInteger(canvasHeight) || canvasHeight <= 0) {
    return badRequest("Ukuran kanvas tidak valid");
  }

  const orderIds = placements.map((p) => p.orderId);
  const rows = await db.select().from(maharOrders).where(inArray(maharOrders.id, orderIds));
  const orderMap = new Map(rows.map((row) => [row.id, row]));

  const missingIds = orderIds.filter((id) => !orderMap.has(id));
  if (missingIds.length > 0) {
    return badRequest(`Pesanan mahar tidak ditemukan: ${missingIds.join(", ")}`, 404);
  }
  const nonPendingIds = orderIds.filter((id) => orderMap.get(id)?.status !== "pending");
  if (nonPendingIds.length > 0) {
    return badRequest("Hanya pesanan berstatus Pending yang bisa dikunci ke batch");
  }

  const layoutData: MaharLayoutItem[] = placements.map((p) => {
    const order = orderMap.get(p.orderId)!;
    return {
      orderId: order.id,
      brideName: order.brideName,
      groomName: order.groomName,
      weddingDate: order.weddingDate,
      nominal: order.nominal,
      frameShape: order.frameShape,
      size: order.size,
      posX: p.posX,
      posY: p.posY,
      width: p.width,
      height: p.height,
      rotated: p.rotated,
    };
  });

  let batchCode = requestedCode || `MAHAR-${formatMMDD(new Date())}`;
  let suffix = 1;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const batch = db.transaction((tx) => {
        const values: NewMaharBatch = {
          batchCode,
          layoutData,
          canvasWidth,
          canvasHeight,
          status: "pending",
        };
        const [inserted] = tx.insert(maharBatches).values(values).returning().all();

        tx.update(maharOrders).set({ status: "completed" }).where(inArray(maharOrders.id, orderIds)).run();

        return inserted;
      });

      return NextResponse.json({ batch }, { status: 201 });
    } catch (error) {
      if (isUniqueConstraintError(error) && !requestedCode) {
        suffix += 1;
        batchCode = `MAHAR-${formatMMDD(new Date())}-${suffix}`;
        continue;
      }
      if (isUniqueConstraintError(error)) {
        return badRequest("Kode batch sudah digunakan, gunakan kode lain");
      }
      return badRequest("Gagal menyimpan batch produksi mahar", 500);
    }
  }

  return badRequest("Gagal membuat kode batch unik, coba lagi", 500);
}
