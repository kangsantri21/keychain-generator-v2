import { NextRequest, NextResponse } from "next/server";
import { eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { stagingItems, orders, templates, type Order, type Template } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import type { KeychainRender } from "@/lib/render-types";
import { shapeGateFields } from "@/lib/nesting/shape-placed";
import { summarizeSheet, validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import type { StagingSheetSummary } from "@/lib/staging-types";
import { MIXED_MODE_ERROR, sheetModeOf } from "@/lib/staging-mode";
import { activeProductionFrame } from "@/lib/active-frame";
import { contourSizeMessage, duplicateReceiptMessage } from "@/lib/staging-advice";

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
  rotationDeg: number | null;
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
      rotationDeg: stagingItems.rotationDeg,
      status: stagingItems.status,
      holeOverrideX: stagingItems.holeOverrideX,
      holeOverrideY: stagingItems.holeOverrideY,
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
          const holeOverride =
            row.holeOverrideX !== null && row.holeOverrideY !== null
              ? { x: row.holeOverrideX, y: row.holeOverrideY }
              : null;
          render = renderTemplateItem(assets, row.template, row.customerName, holeOverride);
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

  // Operator metrics + the same validation gate the batch lock runs (lib/production-gate.ts).
  const sheetsByOrder = new Map<number, Set<number>>();
  for (const item of items) sheetsByOrder.set(item.orderId, (sheetsByOrder.get(item.orderId) ?? new Set()).add(item.sheetId));
  const summaryOf = (sheetId: number, sheetItems: StagingItemPayload[]): StagingSheetSummary => {
    const placed: PlacedItem[] = sheetItems.map((item) => ({
      key: String(item.id),
      orderId: item.orderId,
      sheet: sheetId,
      posX: item.posX,
      posY: item.posY,
      width: item.width,
      height: item.height,
      rotated: item.rotated,
      rotationDeg: item.rotationDeg,
      expectedWidth: item.render?.width ?? NaN,
      expectedHeight: item.render?.height ?? NaN,
      ...shapeGateFields(item, item.render),
    }));
    const { mode, source } = sheetModeOf(sheetItems);
    const gate = validatePlacedSheets(placed, placed.map((p) => p.key), mode === "mixed" ? "production" : mode);
    const profile = mode;
    const errors = [...gate.errors];
    if (mode === "mixed") errors.unshift(MIXED_MODE_ERROR);
    if (mode !== "legacy") {
      const split = [...new Set(sheetItems.map((i) => i.orderId))].filter((o) => (sheetsByOrder.get(o)?.size ?? 1) > 1);
      if (split.length > 0) {
        const others = split.flatMap((orderId) => [...(sheetsByOrder.get(orderId) ?? [])].filter((id) => id !== sheetId));
        errors.push(duplicateReceiptMessage(split.length, others));
      }
    }
    const drifted = placed.filter((item) => {
      const [width, height] = item.rotated ? [item.expectedHeight, item.expectedWidth] : [item.expectedWidth, item.expectedHeight];
      return !(Math.abs(item.width - width) <= 0.01 && Math.abs(item.height - height) <= 0.01);
    });
    if (drifted.length > 0) errors.push(contourSizeMessage(drifted.length));
    errors.push(...activeProductionFrame({ items: sheetItems }).errors);
    return { ...summarizeSheet(placed), profile, modeSource: source, valid: errors.length === 0, errors };
  };

  const sheets = [...sheetsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([sheetId, sheetItems]) => ({ sheetId, items: sheetItems, summary: summaryOf(sheetId, sheetItems) }));

  return NextResponse.json({ sheets });
}
