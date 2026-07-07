import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems, orders, templates, type Order, type Template } from "@/lib/db/schema";
import { loadTemplateAssets, renderKeychainText, type TemplateAssets, type KeychainRender } from "@/lib/keychain-render";

interface StagingItemPayload {
  id: number;
  orderId: number;
  templateId: number;
  customerName: string;
  sheetId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  status: string;
  order: Order | null;
  template: Template | null;
  render: KeychainRender | null;
}

export async function GET() {
  const rows = await db
    .select({
      id: stagingItems.id,
      orderId: stagingItems.orderId,
      templateId: stagingItems.templateId,
      customerName: stagingItems.customerName,
      sheetId: stagingItems.sheetId,
      posX: stagingItems.posX,
      posY: stagingItems.posY,
      width: stagingItems.width,
      height: stagingItems.height,
      status: stagingItems.status,
      order: orders,
      template: templates,
    })
    .from(stagingItems)
    .leftJoin(orders, eq(stagingItems.orderId, orders.id))
    .leftJoin(templates, eq(stagingItems.templateId, templates.id))
    .orderBy(stagingItems.sheetId, stagingItems.id);

  const assetsCache = new Map<number, TemplateAssets | null>();

  const items: StagingItemPayload[] = [];
  for (const row of rows) {
    let render: KeychainRender | null = null;

    if (row.template) {
      let assets = assetsCache.get(row.template.id);
      if (assets === undefined) {
        assets = await loadTemplateAssets(row.template).catch(() => null);
        assetsCache.set(row.template.id, assets);
      }
      if (assets) {
        try {
          render = renderKeychainText(assets, row.template, row.customerName);
        } catch {
          render = null;
        }
      }
    }

    items.push({ ...row, render });
  }

  const sheetsMap = new Map<number, StagingItemPayload[]>();
  for (const item of items) {
    const list = sheetsMap.get(item.sheetId);
    if (list) {
      list.push(item);
    } else {
      sheetsMap.set(item.sheetId, [item]);
    }
  }

  const sheets = [...sheetsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sheetId, sheetItems]) => ({ sheetId, items: sheetItems }));

  return NextResponse.json({ sheets });
}
