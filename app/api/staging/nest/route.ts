import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { MaxRectsPacker, type Rectangle } from "maxrects-packer";
import { db } from "@/lib/db";
import { orders, templates, stagingItems, type NewStagingItem } from "@/lib/db/schema";
import { loadTemplateAssets, renderKeychainText, type TemplateAssets } from "@/lib/keychain-render";
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

  const templateIds = [...new Set(pendingOrders.map((order) => order.templateId))];
  const templateRows = await db.select().from(templates).where(inArray(templates.id, templateIds));
  const templateMap = new Map(templateRows.map((template) => [template.id, template]));

  const assetsCache = new Map<number, TemplateAssets>();
  const packer = new MaxRectsPacker<Rectangle>(
    SHEET_WIDTH_MM,
    SHEET_HEIGHT_MM,
    ITEM_PADDING_MM,
    { smart: false, pot: false, square: false, allowRotation: false, border: ITEM_PADDING_MM }
  );

  const skippedOrderIds = new Set<number>();

  for (const order of pendingOrders) {
    const template = templateMap.get(order.templateId);
    if (!template) {
      skippedOrderIds.add(order.id);
      continue;
    }

    let assets = assetsCache.get(template.id);
    if (!assets) {
      try {
        assets = await loadTemplateAssets(template);
        assetsCache.set(template.id, assets);
      } catch {
        skippedOrderIds.add(order.id);
        continue;
      }
    }

    let hasPackedName = false;
    for (const name of order.customerNames) {
      try {
        const rendered = renderKeychainText(assets, template, name);
        const data: PackData = { orderId: order.id, templateId: template.id, customerName: name };
        packer.add(rendered.width, rendered.height, data);
        hasPackedName = true;
      } catch {
        // Skip a single unrenderable name (e.g. a glyph the font can't shape) without failing the whole order.
      }
    }
    if (!hasPackedName) {
      skippedOrderIds.add(order.id);
    }
  }

  const processedOrderIds = pendingOrders
    .map((order) => order.id)
    .filter((id) => !skippedOrderIds.has(id));

  if (packer.bins.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada item yang berhasil disusun (template tidak ditemukan atau rusak)" },
      { status: 400 }
    );
  }

  const [{ maxSheet }] = await db
    .select({ maxSheet: sql<number | null>`MAX(${stagingItems.sheetId})` })
    .from(stagingItems);
  const sheetOffset = maxSheet ?? 0;

  const rows: NewStagingItem[] = [];
  packer.bins.forEach((bin, binIndex) => {
    bin.rects.forEach((rect) => {
      const data = rect.data as PackData;
      rows.push({
        orderId: data.orderId,
        templateId: data.templateId,
        customerName: data.customerName,
        sheetId: sheetOffset + binIndex + 1,
        posX: rect.x,
        posY: rect.y,
        width: rect.width,
        height: rect.height,
        status: "staged",
      });
    });
  });

  await db.insert(stagingItems).values(rows);

  if (processedOrderIds.length > 0) {
    await db.update(orders).set({ status: "processing" }).where(inArray(orders.id, processedOrderIds));
  }

  return NextResponse.json({
    sheets: packer.bins.length,
    items: rows.length,
    ordersProcessed: processedOrderIds.length,
  });
}
