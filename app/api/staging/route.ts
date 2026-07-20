import { NextRequest, NextResponse } from "next/server";
import { eq, ne } from "drizzle-orm";
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
  rotated: boolean;
  status: string;
  order: Order | null;
  template: Template | null;
  render: KeychainRender | null;
}

/**
 * By default returns only active ("staged") sheets — a completed sheet's
 * items keep re-rendering full character SVGs/images on every load, which
 * is expensive, so the (rarely viewed) history list is only ever fetched
 * on demand via `?history=1`, keeping the normal Staging Area load fast.
 */
export async function GET(request: NextRequest) {
  const wantHistory = new URL(request.url).searchParams.get("history") === "1";
  const statusFilter = wantHistory ? eq(stagingItems.status, "completed") : ne(stagingItems.status, "completed");

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
      rotated: stagingItems.rotated,
      status: stagingItems.status,
      order: orders,
      template: templates,
    })
    .from(stagingItems)
    .leftJoin(orders, eq(stagingItems.orderId, orders.id))
    .leftJoin(templates, eq(stagingItems.templateId, templates.id))
    .where(statusFilter)
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
