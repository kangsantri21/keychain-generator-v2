import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { MaxRectsPacker, PACKING_LOGIC, Rectangle } from "maxrects-packer";
import { db } from "@/lib/db";
import { orders, orderItems, templates, stagingItems, type NewStagingItem } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
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
  const packer = new MaxRectsPacker<Rectangle>(
    SHEET_WIDTH_MM,
    SHEET_HEIGHT_MM,
    ITEM_PADDING_MM,
    {
      smart: false,
      pot: false,
      square: false,
      allowRotation: true,
      border: ITEM_PADDING_MM,
      // Best Short Side Fit — for each candidate free rect, minimizes the
      // smaller leftover dimension. Tends to keep placements tight against
      // already-used space (i.e. anchored toward the top-left) and produces
      // less fragmented leftover area than MAX_AREA for this kind of mixed
      // rectangle set.
      logic: PACKING_LOGIC.MAX_EDGE,
    }
  );

  // An order flips to "processing" once at least one name from any of its
  // items is successfully staged — mirrors the old per-order tolerance, now
  // tracked positively since items (not orders) are the iteration unit.
  const successfulOrderIds = new Set<number>();

  // Collect every rect first and place them all in one addArray() call
  // instead of packer.add()-ing each one as it's rendered. add() places a
  // rect immediately into the current free-space layout with no regard for
  // the rects still to come; addArray() sorts the whole batch by area
  // (largest first) before placing any of them, which is what actually
  // keeps the packing dense — inserting large items first (when the most
  // free space is still contiguous) and small items last (when only
  // fragments remain) is the single biggest factor in packing quality.
  const pendingRects: Rectangle[] = [];

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
        const rect = new Rectangle(rendered.width, rendered.height);
        rect.data = data;
        pendingRects.push(rect);
        successfulOrderIds.add(item.orderId);
      } catch {
        // Skip a single unrenderable name (e.g. a glyph the font can't shape) without failing the whole item.
      }
    }
  }

  packer.addArray(pendingRects);

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
        rotated: rect.rot,
        status: "staged",
      });
    });
  });

  await db.insert(stagingItems).values(rows);

  const processedOrderIds = [...successfulOrderIds];
  if (processedOrderIds.length > 0) {
    await db.update(orders).set({ status: "processing" }).where(inArray(orders.id, processedOrderIds));
  }

  return NextResponse.json({
    sheets: packer.bins.length,
    items: rows.length,
    ordersProcessed: processedOrderIds.length,
  });
}
