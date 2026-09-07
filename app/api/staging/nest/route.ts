import { NextRequest, NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, templates, stagingItems, type NewStagingItem } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_MM } from "@/lib/keychain-geometry";

interface PackData {
  orderId: number;
  templateId: number;
  customerName: string;
}

/**
 * A "selection" identifies one customer name within one order item, as
 * `"<orderItemId>:<nameIndex>"` — the same rowId the Order Queue dashboard
 * (app/order-queue/page.tsx) uses for its per-name checkboxes, so the client
 * can send it straight through with no extra mapping.
 */
function parseSelections(raw: unknown): Map<number, Set<number>> {
  const byItem = new Map<number, Set<number>>();
  if (!Array.isArray(raw)) return byItem;

  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const [itemIdRaw, indexRaw] = entry.split(":");
    const itemId = Number(itemIdRaw);
    const nameIndex = Number(indexRaw);
    if (!Number.isInteger(itemId) || !Number.isInteger(nameIndex) || nameIndex < 0) continue;

    const indexes = byItem.get(itemId) ?? new Set<number>();
    indexes.add(nameIndex);
    byItem.set(itemId, indexes);
  }

  return byItem;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const selectionsByItem = parseSelections(body?.selections);

  if (selectionsByItem.size === 0) {
    return NextResponse.json(
      { error: "Pilih minimal satu pesanan untuk disusun" },
      { status: 400 }
    );
  }

  const itemIds = [...selectionsByItem.keys()];
  const selectedItems = await db.select().from(orderItems).where(inArray(orderItems.id, itemIds));

  if (selectedItems.length === 0) {
    return NextResponse.json(
      { error: "Item pesanan yang dipilih tidak ditemukan" },
      { status: 404 }
    );
  }

  const orderIds = [...new Set(selectedItems.map((item) => item.orderId))];
  const parentOrders = await db.select().from(orders).where(inArray(orders.id, orderIds));
  const orderStatusMap = new Map(parentOrders.map((order) => [order.id, order.status]));

  const templateIds = [...new Set(selectedItems.map((item) => item.templateId))];
  const templateRows = await db.select().from(templates).where(inArray(templates.id, templateIds));
  const templateMap = new Map(templateRows.map((template) => [template.id, template]));

  const assetsCache = new Map<number, TemplateAssets>();

  // An order flips to "processing" once at least one selected name from any
  // of its items is successfully staged.
  const successfulOrderIds = new Set<number>();

  // Collect every rect first and pack them all in one packMaxRects() call —
  // it sorts the whole batch by size (largest first) before placing any of
  // them, which is what actually keeps the packing dense: inserting large
  // items first (when the most contiguous room is still available) and
  // small items last (when only fragments remain).
  const pendingRects: NestableRect<PackData>[] = [];

  for (const item of selectedItems) {
    // A completed order is done for good — never re-nest its items even if
    // a stale client selection still references them.
    if (orderStatusMap.get(item.orderId) === "completed") continue;

    const template = templateMap.get(item.templateId);
    if (!template) continue;

    let assets = assetsCache.get(template.id);
    if (!assets) {
      try {
        assets = await loadTemplateAssets(template);
        assetsCache.set(template.id, assets);
      } catch {
        continue;
      }
    }

    const requestedIndexes = selectionsByItem.get(item.id) ?? new Set<number>();
    for (const nameIndex of requestedIndexes) {
      const name = item.customerNames[nameIndex];
      if (!name) continue;

      try {
        const rendered = renderTemplateItem(assets, template, name);
        const data: PackData = { orderId: item.orderId, templateId: template.id, customerName: name };
        pendingRects.push({ width: rendered.width, height: rendered.height, data });
        successfulOrderIds.add(item.orderId);
      } catch {
        // Skip a single unrenderable name (e.g. a glyph the font can't shape) without failing the whole item.
      }
    }
  }

  // MaxRects packing with Bottom-Left (top-left gravity) scoring (lib/
  // nesting.ts): real free-rectangle tracking, not fixed-height shelf rows —
  // items settle as close to the sheet's top-left as possible, filling the
  // leftover space under shorter neighbors even when a rotated item makes
  // one placement unusually tall, and never scattering toward the edges the
  // way a plain best-fit heuristic could on a sparse sheet. See
  // lib/nesting.ts's own docs for the two real failure modes (a center hole,
  // then dead space under a rotated item) this algorithm was iterated past.
  const packedRects = packMaxRects(pendingRects, SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_MM, true);

  if (packedRects.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada item yang berhasil disusun (template tidak ditemukan atau rusak)" },
      { status: 400 }
    );
  }

  const [{ maxSheet }] = await db
    .select({ maxSheet: sql<number | null>`MAX(${stagingItems.sheetId})` })
    .from(stagingItems);
  const sheetOffset = maxSheet ?? 0;

  const rows: NewStagingItem[] = packedRects.map((rect) => ({
    orderId: rect.data.orderId,
    templateId: rect.data.templateId,
    customerName: rect.data.customerName,
    sheetId: sheetOffset + rect.sheetIndex + 1,
    posX: rect.x,
    posY: rect.y,
    width: rect.width,
    height: rect.height,
    rotated: rect.rotated,
    status: "staged",
  }));

  await db.insert(stagingItems).values(rows);

  const processedOrderIds = [...successfulOrderIds];
  if (processedOrderIds.length > 0) {
    await db.update(orders).set({ status: "processing" }).where(inArray(orders.id, processedOrderIds));
  }

  const sheetCount = new Set(packedRects.map((rect) => rect.sheetIndex)).size;

  return NextResponse.json({
    sheets: sheetCount,
    items: rows.length,
    ordersProcessed: processedOrderIds.length,
  });
}
