import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, type HoleOverride } from "@/lib/db/schema";
import { MAX_LAYOUT_OFFSET_MM } from "@/lib/keychain-geometry";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function clamp(n: number): number {
  return Math.max(-MAX_LAYOUT_OFFSET_MM, Math.min(MAX_LAYOUT_OFFSET_MM, n));
}

/**
 * Sets or clears a manual ring-hole nudge for ONE customer name within one
 * order item — the Order Queue's "Edit Lubang" modal, for the rare name
 * whose particular glyph shapes still leave the fully-automatic
 * dynamic-anchor placement (lib/keychain-render.ts) somewhere visually
 * awkward, even after that automatic fix.
 *
 * Only allowed while the parent order is still "pending": once a name has
 * been nested, its hole position is snapshotted onto stagingItems.
 * holeOverrideX/Y (see app/api/staging/nest/route.ts) — editing the source
 * orderItems row after that point would silently do nothing to what's
 * already staged, which is worse than just refusing the edit outright.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId: itemIdRaw } = await params;
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(itemId)) {
    return badRequest("ID item pesanan tidak valid");
  }

  const body = await request.json().catch(() => null);
  const nameIndex = Number(body?.nameIndex);
  if (!Number.isInteger(nameIndex) || nameIndex < 0) {
    return badRequest("Index nama tidak valid");
  }

  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, itemId));
  if (!item) {
    return badRequest("Item pesanan tidak ditemukan", 404);
  }
  if (nameIndex >= item.customerNames.length) {
    return badRequest("Index nama di luar jangkauan daftar nama item ini");
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, item.orderId));
  if (!order) {
    return badRequest("Pesanan induk tidak ditemukan", 404);
  }
  if (order.status !== "pending") {
    return badRequest(
      "Override lubang ring hanya bisa diubah selagi pesanan masih berstatus Pending (nama ini sudah disusun/selesai)"
    );
  }

  const clearOverride = body?.x === null && body?.y === null;
  const nextOverrides: Record<number, HoleOverride> = { ...(item.holeOverrides ?? {}) };

  if (clearOverride) {
    delete nextOverrides[nameIndex];
  } else {
    const x = Number(body?.x);
    const y = Number(body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return badRequest("Koordinat X/Y tidak valid");
    }
    nextOverrides[nameIndex] = { x: clamp(x), y: clamp(y) };
  }

  const [updated] = await db
    .update(orderItems)
    .set({ holeOverrides: Object.keys(nextOverrides).length > 0 ? nextOverrides : null })
    .where(eq(orderItems.id, itemId))
    .returning();

  return NextResponse.json({ orderItem: updated });
}
