import { NextRequest, NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, templates, stagingItems, type NewStagingItem, type HoleOverride } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import type { KeychainRender } from "@/lib/render-types";
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import { runGroupedNesting, type GroupedNestingItem } from "@/lib/nesting/grouped-nesting";
import { resolveNestingMode } from "@/lib/nesting/nesting-mode";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_RIGHT_MM, ITEM_PADDING_BOTTOM_MM } from "@/lib/keychain-geometry";
import { parseSelections } from "@/lib/staging-selection";

interface PackData {
  orderId: number;
  templateId: number;
  customerName: string;
  holeOverride: HoleOverride | null;
  /**
   * Only ever read by the GROUPED_V2 preview branch below (PHASE 2B) — the
   * LEGACY_FLAT path already had this same value available locally as
   * `rendered` and simply never carried it into `PackData` because nothing
   * needed it there. Carrying it through is purely additive: legacy still
   * only reads `.width`/`.height`/`.orderId`/etc off `rect.data`, never
   * `.render`, so this cannot change legacy's own output in any way.
   */
  render: KeychainRender;
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
        const holeOverride = item.holeOverrides?.[nameIndex] ?? null;
        const rendered = renderTemplateItem(assets, template, name, holeOverride);
        const data: PackData = {
          orderId: item.orderId,
          templateId: template.id,
          customerName: name,
          holeOverride,
          render: rendered,
        };
        pendingRects.push({ width: rendered.width, height: rendered.height, data });
        successfulOrderIds.add(item.orderId);
      } catch {
        // Skip a single unrenderable name (e.g. a glyph the font can't shape) without failing the whole item.
      }
    }
  }

  // GROUPED_V2 (Phase 2A, dry-run only; PHASE 2B added receiptCode + full
  // render payload per item so a client-side preview canvas can draw the
  // real artwork without a second round-trip): explicit opt-in via
  // body.mode, defaulting to LEGACY_FLAT below for every existing/
  // unmodified caller (Order Queue's own default fetch never sends `mode`,
  // so its behavior is unchanged). Deliberately returns the computed layout
  // as JSON WITHOUT writing to stagingItems or touching order status —
  // this phase's own scope is a VISUAL preview to compare against legacy,
  // not yet wiring grouped nesting into the real production pipeline (see
  // lib/nesting/grouped-nesting.ts's own top doc comment).
  if (resolveNestingMode(body) === "grouped-v2") {
    const receiptCodeByOrderId = new Map(parentOrders.map((order) => [order.id, order.receiptCode]));

    const groupedItems: GroupedNestingItem<PackData>[] = pendingRects.map((rect, index) => ({
      id: index,
      orderId: rect.data.orderId,
      width: rect.width,
      height: rect.height,
      originalWidth: rect.width,
      originalHeight: rect.height,
      allowRotation: true,
      data: rect.data,
    }));

    const result = runGroupedNesting(groupedItems);

    return NextResponse.json({
      mode: "grouped-v2",
      dryRun: true,
      groups: result.groups.map((group) => ({
        orderId: group.orderId,
        receiptCode: group.orderId !== null ? (receiptCodeByOrderId.get(group.orderId) ?? null) : null,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        itemCount: group.items.length,
        // PHASE 2C dev diagnostics — which inner layout was picked and how much of its own box it fills.
        candidateCount: group.alternatives.length,
        selectedStrategy: group.candidate.strategy,
        itemArea: group.candidate.metrics.itemArea,
        internalUtilizationPercent: group.candidate.metrics.utilizationPercent,
      })),
      items: result.items.map((item) => ({
        orderId: item.orderId,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotated: item.rotated,
        groupX: item.groupX,
        groupY: item.groupY,
        groupWidth: item.groupWidth,
        groupHeight: item.groupHeight,
        customerName: item.data.customerName,
        templateId: item.data.templateId,
        render: item.data.render,
      })),
      metrics: result.metrics,
      warnings: result.warnings,
      unfitCount: result.unfit.length,
    });
  }

  // LEGACY_FLAT (default): MaxRects packing with Bottom-Left (top-left gravity) scoring (lib/
  // nesting.ts): real free-rectangle tracking, not fixed-height shelf rows —
  // items settle as close to the sheet's top-left as possible, filling the
  // leftover space under shorter neighbors even when a rotated item makes
  // one placement unusually tall, and never scattering toward the edges the
  // way a plain best-fit heuristic could on a sparse sheet. See
  // lib/nesting.ts's own docs for the two real failure modes (a center hole,
  // then dead space under a rotated item) this algorithm was iterated past.
  const packedRects = packMaxRects(
    pendingRects,
    SHEET_WIDTH_MM,
    SHEET_HEIGHT_MM,
    ITEM_PADDING_RIGHT_MM,
    ITEM_PADDING_BOTTOM_MM,
    true
  );

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
    holeOverrideX: rect.data.holeOverride?.x ?? null,
    holeOverrideY: rect.data.holeOverride?.y ?? null,
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
