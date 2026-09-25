import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, templates, stagingItems, type NewStagingItem, type HoleOverride } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import { packIntoExistingSheet, type NestableRect, type ExistingPlacement } from "@/lib/nesting";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_RIGHT_MM, ITEM_PADDING_BOTTOM_MM } from "@/lib/keychain-geometry";
import { parseSelections } from "@/lib/staging-selection";

interface PackData {
  orderId: number;
  templateId: number;
  customerName: string;
  holeOverride: HoleOverride | null;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Tambahkan ke Batch Aktif" — inserts more names into an existing,
 * not-yet-locked staging sheet's remaining free space, WITHOUT re-nesting
 * (and thereby reshuffling) whatever is already placed there. Mirrors
 * app/api/staging/nest/route.ts's own render/selection handling almost
 * exactly; the one real difference is the packing call itself
 * (`packIntoExistingSheet` instead of `packMaxRects`) and that this endpoint
 * only ever targets the one sheetId in the URL, never spilling onto a new
 * sheet.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  const { sheetId: sheetIdRaw } = await params;
  const sheetId = Number(sheetIdRaw);
  if (!Number.isInteger(sheetId)) {
    return badRequest("ID lembar kerja tidak valid");
  }

  const body = await request.json().catch(() => null);
  const selectionsByItem = parseSelections(body?.selections);
  if (selectionsByItem.size === 0) {
    return badRequest("Pilih minimal satu pesanan untuk ditambahkan");
  }

  const existingItems = await db.select().from(stagingItems).where(eq(stagingItems.sheetId, sheetId));
  if (existingItems.length === 0) {
    return badRequest("Lembar Kerja tidak ditemukan (mungkin sudah dikunci atau dibongkar)", 404);
  }
  if (existingItems.some((item) => item.status === "completed")) {
    return badRequest("Lembar Kerja ini sudah ditandai selesai, tidak bisa ditambahkan lagi");
  }

  const itemIds = [...selectionsByItem.keys()];
  const selectedItems = await db.select().from(orderItems).where(inArray(orderItems.id, itemIds));
  if (selectedItems.length === 0) {
    return badRequest("Item pesanan yang dipilih tidak ditemukan", 404);
  }

  const orderIds = [...new Set(selectedItems.map((item) => item.orderId))];
  const parentOrders = await db.select().from(orders).where(inArray(orders.id, orderIds));
  const orderStatusMap = new Map(parentOrders.map((order) => [order.id, order.status]));

  // Append is only ever offered for the Pending pool in the UI (Order Queue)
  // — enforced again here so a stale client selection can never re-nest an
  // order that's already Processing (staged elsewhere) or Completed.
  const nonPendingOrderIds = orderIds.filter((id) => orderStatusMap.get(id) !== "pending");
  if (nonPendingOrderIds.length > 0) {
    return badRequest("Hanya pesanan berstatus Pending yang bisa ditambahkan ke Batch Aktif");
  }

  const templateIds = [...new Set(selectedItems.map((item) => item.templateId))];
  const templateRows = await db.select().from(templates).where(inArray(templates.id, templateIds));
  const templateMap = new Map(templateRows.map((template) => [template.id, template]));

  const assetsCache = new Map<number, TemplateAssets>();
  const pendingRects: NestableRect<PackData>[] = [];

  for (const item of selectedItems) {
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
        const holeOverride = item.holeOverrides?.[nameIndex] ?? null;
        const rendered = renderTemplateItem(assets, template, name, holeOverride);
        const data: PackData = { orderId: item.orderId, templateId: template.id, customerName: name, holeOverride };
        pendingRects.push({ width: rendered.width, height: rendered.height, data });
      } catch {
        // Skip a single unrenderable name (e.g. a glyph the font can't shape) without failing the whole item.
      }
    }
  }

  if (pendingRects.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada item yang berhasil dirender (template tidak ditemukan atau rusak)" },
      { status: 400 }
    );
  }

  const existingRects: ExistingPlacement[] = existingItems.map((item) => ({
    x: item.posX,
    y: item.posY,
    width: item.width,
    height: item.height,
  }));

  const { fit, unfit } = packIntoExistingSheet(
    existingRects,
    pendingRects,
    SHEET_WIDTH_MM,
    SHEET_HEIGHT_MM,
    ITEM_PADDING_RIGHT_MM,
    ITEM_PADDING_BOTTOM_MM,
    true
  );

  // All-or-nothing: an operator who selects 10 names expects either all 10
  // to land on the sheet, or a clear reason why not — never a batch silently
  // missing a few names they explicitly checked.
  if (unfit.length > 0) {
    return badRequest(
      `Sisa ruang di Lembar Kerja #${sheetId} hanya cukup untuk ${fit.length} dari ${pendingRects.length} item yang dipilih. ` +
        `Kurangi jumlah pesanan yang dipilih, atau susun sisanya sebagai lembar kerja baru lewat "Kirim ke Mesin Nesting".`
    );
  }

  const rows: NewStagingItem[] = fit.map((rect) => ({
    orderId: rect.data.orderId,
    templateId: rect.data.templateId,
    customerName: rect.data.customerName,
    sheetId,
    posX: rect.x,
    posY: rect.y,
    width: rect.width,
    height: rect.height,
    rotated: rect.rotated,
    status: "staged",
    holeOverrideX: rect.data.holeOverride?.x ?? null,
    holeOverrideY: rect.data.holeOverride?.y ?? null,
  }));

  await db.insert(stagingItems).values(rows);

  const processedOrderIds = [...new Set(fit.map((rect) => rect.data.orderId))];
  if (processedOrderIds.length > 0) {
    await db.update(orders).set({ status: "processing" }).where(inArray(orders.id, processedOrderIds));
  }

  return NextResponse.json({ sheetId, items: rows.length, ordersProcessed: processedOrderIds.length });
}
