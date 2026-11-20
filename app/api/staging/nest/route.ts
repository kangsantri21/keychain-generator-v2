import { NextRequest, NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, templates, stagingItems, type NewStagingItem, type HoleOverride } from "@/lib/db/schema";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import type { KeychainRender } from "@/lib/render-types";
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import { runGroupedNesting, resolveConfig, type GroupedNestingItem } from "@/lib/nesting/grouped-nesting";
import { resolveNestingMode } from "@/lib/nesting/nesting-mode";
import { runProductionNesting } from "@/lib/nesting/production-nesting";
import { polygonsFromOutlinePath } from "@/lib/nesting/shape-outline";
import { STAGED_SHAPE } from "@/lib/staging-mode";
import { stagedReceiptConflicts } from "@/lib/production-gate";
import { isSpacingBenchmarkRequest, runSpacingBenchmark } from "@/lib/nesting/grouped-nesting-benchmark";
import { isSlotReflowRequest, runGroupedNestingV3 } from "@/lib/nesting/grouped-nesting-v3";
import { compoundStage, isCompoundRequest } from "@/lib/nesting/grouped-nesting-v3-compound";
import { regionStage, isRegionRequest } from "@/lib/nesting/grouped-nesting-v3-region";
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
  // Selected names that could not become a nestable unit (missing template,
  // asset or name, or an unrenderable glyph). Legacy keeps skipping them as
  // before; Production Nesting refuses to stage a partial batch.
  const unrenderedNames: string[] = [];

  for (const item of selectedItems) {
    // A completed order is done for good — never re-nest its items even if
    // a stale client selection still references them.
    if (orderStatusMap.get(item.orderId) === "completed") continue;

    const requestedIndexes = selectionsByItem.get(item.id) ?? new Set<number>();
    const describe = (nameIndex: number) => `${item.customerNames[nameIndex] ?? `#${nameIndex + 1}`} (item ${item.id})`;

    const template = templateMap.get(item.templateId);
    if (!template) {
      for (const nameIndex of requestedIndexes) unrenderedNames.push(`${describe(nameIndex)}: template tidak ditemukan`);
      continue;
    }

    let assets = assetsCache.get(template.id);
    if (!assets) {
      try {
        assets = await loadTemplateAssets(template);
        assetsCache.set(template.id, assets);
      } catch {
        for (const nameIndex of requestedIndexes) unrenderedNames.push(`${describe(nameIndex)}: aset template gagal dimuat`);
        continue;
      }
    }

    for (const nameIndex of requestedIndexes) {
      const name = item.customerNames[nameIndex];
      if (!name) {
        unrenderedNames.push(`${describe(nameIndex)}: nama tidak ada`);
        continue;
      }

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
        unrenderedNames.push(`${describe(nameIndex)}: gagal dirender`);
        // Skip a single unrenderable name (e.g. a glyph the font can't shape) without failing the whole item.
      }
    }
  }

  // PRODUCTION NESTING (V2 -> V3 slot reflow -> compound -> region repack
  // FAST, ORDER_GAP 8): all-or-nothing. Every selected name must render and
  // be placed, and the production gate must pass, before anything is
  // written; otherwise nothing is staged and the reasons are returned.
  if (resolveNestingMode(body) === "production-v3") {
    // 1 receipt = 1 group = 1 sheet: refuse receipts that already have active
    // units in Staging (re-sending them would stage units twice and put the
    // receipt on two sheets). Nothing is written.
    const activeRows = await db
      .select({ orderId: stagingItems.orderId, sheetId: stagingItems.sheetId, status: stagingItems.status })
      .from(stagingItems)
      .where(inArray(stagingItems.orderId, orderIds));
    const conflicts = stagedReceiptConflicts(orderIds, activeRows);
    if (conflicts.length > 0) {
      const codeOf = new Map(parentOrders.map((order) => [order.id, `${order.receiptCode}${order.manualCode ? ` (${order.manualCode})` : ""}`]));
      return NextResponse.json(
        {
          error: `${conflicts.length} resi sudah ada di Lembar Kerja — tidak ada yang disimpan. Bongkar lembar kerjanya dulu, lalu kirim ulang seluruh resi.`,
          details: conflicts.map((c) => `${codeOf.get(c.orderId) ?? `#${c.orderId}`} sudah di Lembar Kerja #${c.sheetIds.join(", #")}`).slice(0, 20),
        },
        { status: 409 }
      );
    }
    if (unrenderedNames.length > 0) {
      return NextResponse.json(
        { error: `${unrenderedNames.length} item tidak bisa diproses — tidak ada yang disimpan`, details: unrenderedNames.slice(0, 20) },
        { status: 422 }
      );
    }
    if (pendingRects.length === 0) {
      return NextResponse.json({ error: "Tidak ada item yang bisa disusun dari pesanan terpilih" }, { status: 400 });
    }

    const receiptCodeByOrderId = new Map(parentOrders.map((order) => [order.id, order.receiptCode]));
    const productionItems: GroupedNestingItem<PackData>[] = pendingRects.map((rect, index) => ({
      id: index,
      orderId: rect.data.orderId,
      width: rect.width,
      height: rect.height,
      originalWidth: rect.width,
      originalHeight: rect.height,
      allowRotation: true,
      outline: polygonsFromOutlinePath(rect.data.render.outlinePath, rect.width, rect.height),
      receiptCode: receiptCodeByOrderId.get(rect.data.orderId) ?? "",
      data: rect.data,
    }));
    const nesting = runProductionNesting(productionItems);
    if (!nesting.ok) {
      return NextResponse.json(
        { error: "Production Nesting gagal validasi — tidak ada yang disimpan", details: nesting.errors.slice(0, 20) },
        { status: 422 }
      );
    }

    const [{ maxSheet: productionMaxSheet }] = await db
      .select({ maxSheet: sql<number | null>`MAX(${stagingItems.sheetId})` })
      .from(stagingItems);
    const productionOffset = productionMaxSheet ?? 0;
    const productionRows: NewStagingItem[] = nesting.placements.map((placement) => ({
      orderId: placement.data.orderId,
      templateId: placement.data.templateId,
      customerName: placement.data.customerName,
      sheetId: productionOffset + placement.sheetIndex + 1,
      posX: placement.posX,
      posY: placement.posY,
      width: placement.width,
      height: placement.height,
      rotated: placement.rotated,
      rotationDeg: placement.rotationDeg,
      splitPart: placement.splitPart ?? null,
      splitCount: placement.splitCount ?? null,
      // Shape-block sheets: one framed receipt, cut-line gaps, side label.
      // The older box packer is not on this path anymore (it still runs for
      // callers that pass no outline — tests and any future opt-out).
      status: STAGED_SHAPE,
      holeOverrideX: placement.data.holeOverride?.x ?? null,
      holeOverrideY: placement.data.holeOverride?.y ?? null,
    }));
    const productionOrderIds = [...successfulOrderIds];
    // Re-checked inside the write transaction (a second request may have staged the same receipts meanwhile).
    const raced = db.transaction((tx) => {
      const nowActive = tx
        .select({ orderId: stagingItems.orderId, sheetId: stagingItems.sheetId, status: stagingItems.status })
        .from(stagingItems)
        .where(inArray(stagingItems.orderId, orderIds))
        .all();
      const late = stagedReceiptConflicts(orderIds, nowActive);
      if (late.length > 0) return late;
      tx.insert(stagingItems).values(productionRows).run();
      if (productionOrderIds.length > 0) tx.update(orders).set({ status: "processing" }).where(inArray(orders.id, productionOrderIds)).run();
      return [];
    });
    if (raced.length > 0) {
      return NextResponse.json(
        { error: `${raced.length} resi baru saja masuk Lembar Kerja dari permintaan lain — tidak ada yang disimpan`, details: raced.map((c) => `#${c.orderId} di Lembar Kerja #${c.sheetIds.join(", #")}`) },
        { status: 409 }
      );
    }

    return NextResponse.json({
      engine: nesting.engine,
      sheets: nesting.sheetCount,
      items: productionRows.length,
      ordersProcessed: productionOrderIds.length,
      sumUsedHeight: nesting.sumUsedHeight,
      // Debug only: how far each receipt was compacted (left/up) after packing.
      compaction: nesting.compaction.map((m) => ({ orderId: m.orderId, dx: m.dx, dy: m.dy, status: m.status })),
    });
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

    // Dev diagnostic only — measured here, outside the deterministic result.
    const startedAt = performance.now();
    // V3A-1 (EXPERIMENTAL): only for an explicit `slotReflow: true`. It runs
    // V2 first and returns the V2 result unless a relocation is strictly
    // better. Without the flag this is exactly the V2 call.
    // V3A-3 (EXPERIMENTAL): `slotReflowCompound: true` adds the two-group compound stage on top.
    const clock = () => performance.now();
    const compound = isCompoundRequest(body) ? compoundStage<PackData>(resolveConfig({}), undefined, { clock }) : undefined;
    // V3A-4 FAST (EXPERIMENTAL): `slotReflowRegion: true` adds the local region repack stage last.
    const region = isRegionRequest(body) ? regionStage<PackData>(resolveConfig({}), undefined, { clock }) : undefined;
    const v3Run = isSlotReflowRequest(body) ? runGroupedNestingV3(groupedItems, {}, undefined, { clock, compound, region }) : null;
    const result = v3Run ? v3Run.result : runGroupedNesting(groupedItems);
    const elapsedMs = performance.now() - startedAt;

    // Stable per-request item id (its index in groupedItems) so the client can
    // join a benchmark scenario's positions to the main response's renders.
    const itemIdByData = new Map(groupedItems.map((item) => [item.data, item.id]));
    // PHASE 2G — per-sheet metrics only; groups/items carry sheetIndex and the
    // client partitions them, so nothing is sent twice.
    const sheetMetrics = (sheets: typeof result.sheets) =>
      sheets.map((sheet) => ({
        sheetIndex: sheet.sheetIndex,
        width: sheet.width,
        height: sheet.height,
        orderCount: sheet.orderCount,
        itemCount: sheet.itemCount,
        itemArea: sheet.itemArea,
        usedWidth: sheet.usedWidth,
        usedHeight: sheet.usedHeight,
        remainingFullWidthHeight: sheet.remainingFullWidthHeight,
        sideFragmentWidth: sheet.sideFragmentWidth,
        utilizationPercent: sheet.utilizationPercent,
        wastePercent: sheet.wastePercent,
      }));
    const labelFor = (orderId: number | null) => (orderId !== null ? (receiptCodeByOrderId.get(orderId) ?? null) : null);

    // PHASE 2F DEV benchmark: same items re-run once per fixed ORDER_GAP
    // scenario (8/6/4, server-side list) via the engine's per-call override —
    // the main result above is untouched and still uses the production
    // default. Still inside this dry-run branch: nothing is written.
    let benchmark = null;
    if (isSpacingBenchmarkRequest(body)) {
      const benchmarkStartedAt = performance.now();
      const run = runSpacingBenchmark(groupedItems, undefined, () => performance.now());
      benchmark = {
        productionDefaultOrderGapMm: run.recommendation.productionDefaultOrderGapMm,
        recommendation: run.recommendation,
        totalElapsedMs: performance.now() - benchmarkStartedAt,
        scenarios: run.scenarios.map((s) => ({
          orderGapMm: s.orderGapMm,
          partGapMm: s.partGapMm,
          sheetMarginMm: s.sheetMarginMm,
          edgeClearanceMm: s.edgeClearanceMm,
          totalOrders: s.result.metrics.totalOrders,
          totalItems: s.result.metrics.totalItems,
          unfitCount: s.result.unfit.length,
          sheetCount: s.sheetCount,
          overallMaterialUtilizationPercent: s.overallMaterialUtilizationPercent,
          sheets: sheetMetrics(s.result.sheets),
          usedWidth: s.usedWidth,
          usedHeight: s.usedHeight,
          remainingFullWidthHeight: s.remainingFullWidthHeight,
          sideFragmentWidth: s.sideFragmentWidth,
          packingUtilizationPercent: s.result.metrics.packingUtilizationPercent,
          wastePercent: s.result.metrics.wastePercent,
          selectedHeuristic: s.result.optimizer.selectedHeuristic,
          selectedSort: s.result.optimizer.selectedSort,
          candidateStatesEvaluated: s.result.optimizer.candidateStatesEvaluated,
          outerPackAttempts: s.result.optimizer.outerPackAttempts,
          heightSavedVsDefaultMm: s.heightSavedVsDefaultMm,
          heightSavedVsDefaultPercent: s.heightSavedVsDefaultPercent,
          integrity: s.integrity,
          warnings: s.result.warnings,
          elapsedMs: s.elapsedMs ?? null,
          groups: s.result.groups.map((group) => ({
            orderId: group.orderId,
            sheetIndex: group.sheetIndex,
            receiptCode: labelFor(group.orderId),
            x: group.x,
            y: group.y,
            width: group.width,
            height: group.height,
            itemCount: group.items.length,
          })),
          // Positions only — the client reuses each item's render from the main response via itemId.
          items: s.result.items.map((item) => ({
            itemId: itemIdByData.get(item.data) ?? null,
            orderId: item.orderId,
            sheetIndex: item.sheetIndex,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rotated: item.rotated,
            groupX: item.groupX,
            groupY: item.groupY,
            groupWidth: item.groupWidth,
            groupHeight: item.groupHeight,
          })),
        })),
      };
    }

    return NextResponse.json({
      mode: "grouped-v2",
      dryRun: true,
      groups: result.groups.map((group) => ({
        orderId: group.orderId,
        sheetIndex: group.sheetIndex,
        receiptCode: labelFor(group.orderId),
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        itemCount: group.items.length,
        // PHASE 2C dev diagnostics — which inner layout was picked and how much of its own box it fills.
        candidateCount: group.alternatives.length,
        selectedStrategy: group.candidate.strategy,
        localStrategy: group.localCandidate.strategy,
        itemArea: group.candidate.metrics.itemArea,
        internalUtilizationPercent: group.candidate.metrics.utilizationPercent,
      })),
      items: result.items.map((item) => ({
        itemId: itemIdByData.get(item.data) ?? null,
        orderId: item.orderId,
        sheetIndex: item.sheetIndex,
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
      sheets: sheetMetrics(result.sheets),
      summary: result.summary,
      unfitGroups: result.unfitGroups,
      optimizer: { ...result.optimizer, elapsedMs },
      warnings: result.warnings,
      unfitCount: result.unfit.length,
      benchmark,
      slotReflow: v3Run
        ? {
            ...v3Run.diagnostics,
            moves: v3Run.diagnostics.moves.map((move) => ({ ...move, receiptCode: labelFor(move.orderId) })),
            funnel: v3Run.diagnostics.funnel
              ? {
                  ...v3Run.diagnostics.funnel,
                  orders: v3Run.diagnostics.funnel.orders.map((order) => ({ ...order, receiptCode: labelFor(order.orderId) })),
                  topPrunedForeign: v3Run.diagnostics.funnel.topPrunedForeign.map((c) => ({ ...c, receiptCode: labelFor(c.orderId) })),
                }
              : null,
            compound: v3Run.diagnostics.compound
              ? {
                  ...v3Run.diagnostics.compound,
                  moves: v3Run.diagnostics.compound.moves.map((move) => ({
                    ...move,
                    primaryReceiptCode: labelFor(move.primary.orderId),
                    secondaryReceiptCode: labelFor(move.secondary.orderId),
                  })),
                }
              : null,
            region: v3Run.diagnostics.region
              ? {
                  ...v3Run.diagnostics.region,
                  accepted: v3Run.diagnostics.region.accepted.map((a) => ({
                    ...a,
                    receipts: a.receipts.map((r) => ({ ...r, receiptCode: labelFor(r.orderId) })),
                  })),
                }
              : null,
          }
        : null,
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
