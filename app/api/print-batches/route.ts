import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { printBatches, orderItems, orders, stagingItems, templates } from "@/lib/db/schema";
import { isUniqueConstraintError } from "@/lib/template-files";
import { loadTemplateAssets, type TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import { shapeGateFields } from "@/lib/nesting/shape-placed";
import { matchSubmittedToStaged, validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import type { StagingItemPayload } from "@/lib/staging-types";
import { MIXED_MODE_ERROR, sheetModeOf } from "@/lib/staging-mode";
import { activeProductionFrame } from "@/lib/active-frame";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function formatMMDD(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${mm}${dd}`;
}

function isValidLayoutItem(value: unknown): value is StagingItemPayload {
  const item = value as Partial<StagingItemPayload> | null;
  return (
    !!item &&
    typeof item === "object" &&
    typeof item.id === "number" &&
    typeof item.orderId === "number" &&
    typeof item.templateId === "number"
  );
}

export async function GET() {
  const rows = await db.select().from(printBatches).orderBy(desc(printBatches.createdAt));
  return NextResponse.json({ batches: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const sheetId = Number(body?.sheetId);
  const items: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const canvasWidth = Number(body?.canvasWidth);
  const canvasHeight = Number(body?.canvasHeight);
  const requestedCode = typeof body?.batchCode === "string" ? body.batchCode.trim() : "";

  if (!Number.isInteger(sheetId)) {
    return badRequest("ID lembar kerja tidak valid");
  }
  if (items.length === 0 || !items.every(isValidLayoutItem)) {
    return badRequest("Lembar kerja kosong atau datanya tidak valid");
  }
  if (!Number.isInteger(canvasWidth) || canvasWidth <= 0 || !Number.isInteger(canvasHeight) || canvasHeight <= 0) {
    return badRequest("Ukuran kanvas tidak valid");
  }

  // VALIDATION GATE: the staging rows in the DB are the single source of
  // truth for placement (they are what the Staging Area preview shows). The
  // submitted sheet must match them exactly, and the sheet must pass the
  // production gate (lib/production-gate.ts); otherwise nothing is saved.
  const submitted = items as StagingItemPayload[];
  const dbRows = await db
    .select()
    .from(stagingItems)
    .where(and(eq(stagingItems.sheetId, sheetId), ne(stagingItems.status, "completed")));
  if (dbRows.length === 0) {
    return badRequest("Lembar kerja tidak ditemukan di Staging Area", 404);
  }

  const gateErrors: string[] = [];
  const match = matchSubmittedToStaged(dbRows, submitted);
  if (match.mismatched > 0 || submitted.length !== dbRows.length) {
    gateErrors.push(
      `Layout yang dikirim berbeda dari Staging Area (${match.mismatched} item tidak cocok, ${submitted.length} dikirim vs ${dbRows.length} tersimpan) — muat ulang halaman`
    );
  }

  // Artwork size check: re-render every unit and compare with its stored footprint.
  const templateRows = await db.select().from(templates).where(inArray(templates.id, [...new Set(dbRows.map((r) => r.templateId))]));
  const templateMap = new Map(templateRows.map((t) => [t.id, t]));
  const assetsCache = new Map<number, TemplateAssets | null>();
  const placed: PlacedItem[] = [];
  for (const row of dbRows) {
    let expected = { width: NaN, height: NaN };
    let rendered: { width: number; height: number; outlinePath: string | null } | null = null;
    const template = templateMap.get(row.templateId);
    if (template) {
      let assets = assetsCache.get(template.id);
      if (assets === undefined) {
        assets = await loadTemplateAssets(template).catch(() => null);
        assetsCache.set(template.id, assets);
      }
      if (assets) {
        try {
          const holeOverride = row.holeOverrideX !== null && row.holeOverrideY !== null ? { x: row.holeOverrideX, y: row.holeOverrideY } : null;
          const render = renderTemplateItem(assets, template, row.customerName, holeOverride);
          expected = { width: render.width, height: render.height };
          rendered = { width: render.width, height: render.height, outlinePath: render.outlinePath };
        } catch {
          // leaves NaN -> reported as an artwork mismatch below
        }
      }
    }
    placed.push({
      key: String(row.id),
      orderId: row.orderId,
      sheet: row.sheetId,
      posX: row.posX,
      posY: row.posY,
      width: row.width,
      height: row.height,
      rotated: row.rotated,
      expectedWidth: expected.width,
      expectedHeight: expected.height,
      ...shapeGateFields(row, rendered),
    });
  }
  // Mode comes from the explicit staging marker (lib/staging-mode.ts), not from geometry.
  const { mode } = sheetModeOf(dbRows);
  if (mode === "mixed") gateErrors.push(MIXED_MODE_ERROR);
  const gate = validatePlacedSheets(placed, dbRows.map((row) => String(row.id)), mode === "mixed" ? "production" : mode);
  gateErrors.push(...gate.errors);

  // A production sheet must hold every staged unit of its receipts (one receipt = one group on one sheet).
  if (mode !== "legacy") {
    const sheetOrderIds = [...new Set(dbRows.map((row) => row.orderId))];
    const elsewhere = await db
      .select({ orderId: stagingItems.orderId, sheetId: stagingItems.sheetId })
      .from(stagingItems)
      .where(and(inArray(stagingItems.orderId, sheetOrderIds), ne(stagingItems.sheetId, sheetId), ne(stagingItems.status, "completed")));
    if (elsewhere.length > 0) {
      gateErrors.push(`${new Set(elsewhere.map((e) => e.orderId)).size} resi juga memiliki item di lembar kerja lain — resi tidak boleh terpecah`);
    }
  }
  // The physical export frame (adaptive height on Production sheets) must hold the validated layout.
  gateErrors.push(...activeProductionFrame({ items: match.layout }).errors);

  if (gateErrors.length > 0) {
    return NextResponse.json({ error: "Validasi lembar kerja gagal — batch tidak disimpan", details: gateErrors.slice(0, 20) }, { status: 422 });
  }

  // Saved layout = the validated DB placement (same numbers the preview showed), with the client's render payload.
  const layoutData: StagingItemPayload[] = match.layout;
  const orderIds = [...new Set(layoutData.map((item) => item.orderId))];

  // A staged item only carries orderId+templateId, not the order_items row
  // it came from — back into that row by matching those two fields (see
  // the batchId doc comment in lib/db/schema.ts for the caveat this implies
  // when one item's names get split across separate nesting runs).
  const candidateOrderItems = orderIds.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
    : [];
  const pairsInBatch = new Set(layoutData.map((item) => `${item.orderId}:${item.templateId}`));
  const matchedOrderItemIds = candidateOrderItems
    .filter((oi) => pairsInBatch.has(`${oi.orderId}:${oi.templateId}`))
    .map((oi) => oi.id);

  let batchCode = requestedCode || `BATCH-${formatMMDD(new Date())}`;
  let suffix = 1;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const batch = db.transaction((tx) => {
        const [inserted] = tx
          .insert(printBatches)
          .values({
            batchCode,
            layoutData,
            canvasWidth,
            canvasHeight,
            status: "pending",
          })
          .returning()
          .all();

        if (matchedOrderItemIds.length > 0) {
          tx.update(orderItems)
            .set({ batchId: inserted.id })
            .where(inArray(orderItems.id, matchedOrderItemIds))
            .run();
        }
        if (orderIds.length > 0) {
          tx.update(orders).set({ status: "completed" }).where(inArray(orders.id, orderIds)).run();
        }
        tx.delete(stagingItems).where(eq(stagingItems.sheetId, sheetId)).run();

        return inserted;
      });

      return NextResponse.json({ batch }, { status: 201 });
    } catch (error) {
      if (isUniqueConstraintError(error) && !requestedCode) {
        suffix += 1;
        batchCode = `BATCH-${formatMMDD(new Date())}-${suffix}`;
        continue;
      }
      if (isUniqueConstraintError(error)) {
        return badRequest("Kode batch sudah digunakan, gunakan kode lain");
      }
      return badRequest("Gagal menyimpan batch produksi", 500);
    }
  }

  return badRequest("Gagal membuat kode batch unik, coba lagi", 500);
}
