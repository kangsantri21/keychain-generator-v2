import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, templates, stagingItems, type NewStagingItem } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import { packShelves, type NestableRect } from "@/lib/nesting";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_MM } from "@/lib/keychain-geometry";

interface PackData {
  orderId: number;
  templateId: number;
  customerName: string;
}

export async function POST() {
  const pendingOrders = await db.select().from(orders).where(eq(orders.status, "pending"));

  if (pendingOrders.length === 0) {
    return NextResponse.json({ error: "Tidak ada pesanan pending untuk disusun" }, { status: 400 });
  }

  const pendingOrderIds = pendingOrders.map((order) => order.id);
  const pendingItems = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, pendingOrderIds));

  if (pendingItems.length === 0) {
    return NextResponse.json(
      { error: "Pesanan pending tidak memiliki item untuk disusun" },
      { status: 400 }
    );
  }

  const templateIds = [...new Set(pendingItems.map((item) => item.templateId))];
  const templateRows = await db.select().from(templates).where(inArray(templates.id, templateIds));
  const templateMap = new Map(templateRows.map((template) => [template.id, template]));

  const assetsCache = new Map<number, TemplateAssets>();

  // An order flips to "processing" once at least one name from any of its
  // items is successfully staged — mirrors the old per-order tolerance, now
  // tracked positively since items (not orders) are the iteration unit.
  const successfulOrderIds = new Set<number>();

  // Collect every rect first and pack them all in one packShelves() call —
  // it sorts the whole batch by size (largest first) before placing any of
  // them, which is what actually keeps the packing dense: inserting large
  // items first (when the most contiguous room is still available) and
  // small items last (when only fragments remain).
  const pendingRects: NestableRect<PackData>[] = [];

  for (const item of pendingItems) {
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

    for (const name of item.customerNames) {
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

  // Top-left shelf packing (lib/nesting.ts): items fill left-to-right, row
  // by row, top to bottom, overflowing onto additional sheets only once a
  // sheet is genuinely out of vertical room — so leftover space always ends
  // up at the end of the layout, never as a gap in the middle of a sparse
  // sheet (see lib/nesting.ts's own docs for why the previous MaxRects/BSSF
  // packer could do exactly that).
  const packedRects = packShelves(pendingRects, SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_MM, true);

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
