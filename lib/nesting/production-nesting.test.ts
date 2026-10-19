/**
 * Production Nesting (V3 FAST; receipts GROUP_GAP_X 2 side by side, ORDER_GAP 8 stacked) + production validation gate.
 * `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { packMaxRects } from "@/lib/nesting";
import { ITEM_PADDING_BOTTOM_MM, ITEM_PADDING_RIGHT_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { classifySheetProfile, matchSubmittedToStaged, receiptBoxes, receiptLabelFits, validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import { buildPrintSvgDocument } from "@/lib/export-print-svg";
import { buildSheetDxfDocument } from "@/lib/export-dxf";
import { appendBlockReason, MIXED_MODE_ERROR, sheetModeOf, STAGED_LEGACY, STAGED_PRODUCTION, STAGING_COMPLETED } from "@/lib/staging-mode";
import { readFileSync } from "node:fs";
import { getItemTransform } from "@/lib/staging-transform";
import type { StagingItemPayload } from "@/lib/staging-types";
import { runGroupedNesting } from "./grouped-nesting";
import { PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM, PRODUCTION_SHEET_MARGIN_X_MM } from "./grouped-nesting-config";
import { resolveNestingMode } from "./nesting-mode";
import { PRODUCTION_NESTING_RULES, runProductionNesting } from "./production-nesting";
import { realBatch8Orders } from "./test-fixtures/real-batch-8-orders";
import { internalLabelsOf } from "@/lib/receipt-labels";
import type { GroupedNestingItem } from "./grouped-nesting-types";

const items = realBatch8Orders();
const run = runProductionNesting(items);

/** Production placements as PlacedItem (what the gate checks), keyed by fixture item id. */
function placedOf(r: typeof run): PlacedItem[] {
  const byData = new Map(items.map((i) => [i.data, i]));
  return r.placements.map((p) => {
    const src = byData.get(p.data)!;
    return {
      key: String(src.id),
      orderId: p.orderId!,
      sheet: p.sheetIndex,
      posX: p.posX,
      posY: p.posY,
      width: p.width,
      height: p.height,
      rotated: p.rotated,
      expectedWidth: src.originalWidth,
      expectedHeight: src.originalHeight,
    };
  });
}
const keys = items.map((i) => String(i.id));

/** The staging rows / payload the route would write, for the export checks. */
function stagingPayload(r: typeof run): StagingItemPayload[] {
  return r.placements.map((p, index) => ({
    id: index + 1,
    orderId: p.orderId!,
    templateId: 1,
    customerName: `N${index}`,
    sheetId: p.sheetIndex + 1,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotated: p.rotated,
    status: STAGED_PRODUCTION,
    order: { id: p.orderId!, receiptCode: `R${p.orderId}`, manualCode: "" },
    template: null,
    render: {
      width: p.rotated ? p.height : p.width,
      height: p.rotated ? p.width : p.height,
      outlinePath: null,
      holePath: null,
      textSegments: [{ d: "M0 0h1v1z", color: "#000" }],
      characterImage: null,
    },
  }));
}

describe("Production Nesting — real batch 8 receipts / 71 items, per-axis receipt spacing", () => {
  test("production rules are the locked defaults", () => {
    assert.deepEqual(PRODUCTION_NESTING_RULES, { sheetWidthMm: 310, sheetHeightMm: 470, sheetMarginMm: 5, partGapMm: 2, groupGapXMm: 2, groupGapYMm: 2 });
    // Global ORDER_GAP (V2 / legacy-era experiments) stays 8; only Production uses the 2 / 2 receipt gaps.
    assert.deepEqual([ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM, PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, PRODUCTION_SHEET_MARGIN_X_MM], [8, 2, 5, 2, 2, 3]);
  });

  test("ok, 71/71 placed, ~557.6 mm on 2 sheets (V2 665.3 at the old single 8 mm gap)", () => {
    assert.equal(run.ok, true, run.errors.join("; "));
    assert.equal(run.placements.length, 71);
    assert.equal(run.sheetCount, 2);
    assert.ok(Math.abs(run.sumUsedHeight - 557.613) < 0.01, String(run.sumUsedHeight));
    assert.ok(Math.abs(runGroupedNesting(items).summary.sumUsedHeight - 665.262) < 0.01);
    assert.equal(run.engine, "V3");
  });

  test("0 duplicate, 0 missing, 0 overlap, 0 out of sheet, sizes unchanged, receipt integrity (gate)", () => {
    const gate = validatePlacedSheets(placedOf(run), keys, "production");
    assert.deepEqual(gate.errors, []);
    const ids = placedOf(run).map((p) => p.key);
    assert.equal(new Set(ids).size, 71);
    const sheetsPerOrder = new Map<number, Set<number>>();
    for (const p of run.placements) sheetsPerOrder.set(p.orderId!, (sheetsPerOrder.get(p.orderId!) ?? new Set()).add(p.sheetIndex));
    for (const s of sheetsPerOrder.values()) assert.equal(s.size, 1, "one receipt on one sheet");
    for (const p of run.placements) {
      assert.ok(p.posX >= 0 && p.posY >= 0 && p.posX + p.width <= SHEET_WIDTH_MM && p.posY + p.height <= SHEET_HEIGHT_MM);
    }
  });

  test("deterministic", () => {
    const again = runProductionNesting(realBatch8Orders());
    const strip = (r: typeof run) => r.placements.map((p) => [p.orderId, p.sheetIndex, p.posX, p.posY, p.width, p.height, p.rotated]);
    assert.deepEqual(strip(again), strip(run));
  });

  test("multi-sheet: each sheet classifies as a production layout", () => {
    for (const sheet of [0, 1]) {
      const list = run.placements.filter((p) => p.sheetIndex === sheet);
      assert.ok(list.length > 0);
      assert.equal(classifySheetProfile(list), "production");
    }
  });

  test("an item too large for the media makes the whole run fail (nothing partial)", () => {
    const big: GroupedNestingItem<{ itemId: number }> = { id: 999, orderId: 999, width: 400, height: 50, originalWidth: 400, originalHeight: 50, allowRotation: false, data: { itemId: 999 } };
    const r = runProductionNesting([...realBatch8Orders(), big]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("tidak muat")));
  });
});

describe("Validation gate blocks invalid layouts", () => {
  const good = placedOf(run);
  const tamper = (fn: (list: PlacedItem[]) => PlacedItem[]) => validatePlacedSheets(fn(good.map((p) => ({ ...p }))), keys, "auto");

  test("the untouched layout passes", () => {
    assert.equal(tamper((l) => l).ok, true);
  });
  test("overlap", () => {
    const r = tamper((l) => { l[1].posX = l[0].posX; l[1].posY = l[0].posY; return l; });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("tumpang tindih")));
  });
  test("out of sheet", () => {
    const r = tamper((l) => { l[0].posX = SHEET_WIDTH_MM - 1; return l; });
    assert.ok(r.errors.some((e) => e.includes("keluar media")));
  });
  test("missing and duplicate", () => {
    assert.ok(tamper((l) => l.slice(1)).errors.some((e) => e.includes("hilang")));
    assert.ok(tamper((l) => [...l, { ...l[0] }]).errors.some((e) => e.includes("duplikat")));
  });
  test("artwork resized", () => {
    assert.ok(tamper((l) => { l[0].width += 1; return l; }).errors.some((e) => e.includes("ukuran")));
  });
  test("receipts closer than the 2 mm receipt gap stacked / mixed", () => {
    const r = tamper((l) => {
      // Put another receipt's box 1.5 mm straight below receipt A's box (x-aligned): stacked needs 2 mm.
      const [boxA, boxB] = receiptBoxes(l.filter((p) => p.sheet === 0));
      const sheetB = l.filter((p) => p.orderId === boxB.orderId);
      for (const p of sheetB) {
        p.posX += boxA.rect.x - boxB.rect.x;
        p.posY += boxA.rect.y + boxA.rect.h + 1.5 - boxB.rect.y;
      }
      return l;
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("terlalu dekat")), r.errors.join("; "));
  });
  test("receipt split across sheets", () => {
    const r = tamper((l) => {
      const p = l.find((x) => x.sheet === 0)!;
      p.sheet = 1;
      p.posX = 6;
      p.posY = 460 - p.height;
      return l;
    });
    assert.ok(r.errors.some((e) => e.includes("terpecah") || e.includes("margin") || e.includes("terlalu dekat") || e.includes("tumpang")));
  });
  test("margin 5 mm on a production sheet", () => {
    const r = validatePlacedSheets(good.map((p) => ({ ...p })), keys, "production");
    assert.equal(r.ok, true);
    const bad = good.map((p) => ({ ...p }));
    const first = bad.find((p) => p.sheet === 0)!;
    first.posX = SHEET_WIDTH_MM - SHEET_MARGIN_MM - first.width + 1;
    assert.ok(validatePlacedSheets(bad, keys, "production").errors.some((e) => e.includes("margin")));
  });
  test("batch lock: a submitted layout that differs from the staged rows is rejected", () => {
    const staged = stagingPayload(run);
    assert.equal(matchSubmittedToStaged(staged, staged).mismatched, 0);
    const moved = staged.map((s, i) => (i === 0 ? { ...s, posX: s.posX + 0.5 } : s));
    assert.equal(matchSubmittedToStaged(staged, moved).mismatched, 1);
    assert.ok(matchSubmittedToStaged(staged, staged.slice(1)).mismatched >= 1);
  });
});

describe("Preview placement == exported placement", () => {
  test("the saved layout keeps the staged placement, and the print SVG uses the same transform as the preview", () => {
    const staged = stagingPayload(run);
    const { layout } = matchSubmittedToStaged(staged, staged);
    for (const sheet of [1, 2]) {
      const sheetItems = layout.filter((i) => i.sheetId === sheet);
      const svg = buildPrintSvgDocument({ sheetId: sheet, items: sheetItems });
      for (const item of sheetItems) assert.ok(svg.includes(`transform="${getItemTransform(item)}"`), "same transform as StagingCanvas");
    }
    assert.deepEqual(
      layout.map((i) => [i.id, i.posX, i.posY, i.width, i.height, i.rotated]),
      staged.map((i) => [i.id, i.posX, i.posY, i.width, i.height, i.rotated])
    );
  });

  test("production sheets print only the internal receipt labels (no per-item band labels)", () => {
    const staged = stagingPayload(run);
    for (const sheet of [1, 2]) {
      const sheetItems = staged.filter((i) => i.sheetId === sheet);
      const labels = internalLabelsOf({ items: sheetItems })!;
      const placed = labels.filter((l) => l.status === "PLACED");
      const svg = buildPrintSvgDocument({ sheetId: sheet, items: sheetItems });
      assert.equal((svg.match(/>R\d+<\/text>/g) ?? []).length, placed.length);
      for (const l of placed) assert.ok(svg.includes(`transform="${l.transform}"`));
    }
  });
});

describe("Legacy is unchanged", () => {
  test("legacy flat layout keeps every per-item receipt label and classifies as legacy", () => {
    const packed = packMaxRects(items.map((i) => ({ width: i.width, height: i.height, data: i })), SHEET_WIDTH_MM, SHEET_HEIGHT_MM, ITEM_PADDING_RIGHT_MM, ITEM_PADDING_BOTTOM_MM, true);
    assert.equal(packed.length, 71);
    for (const sheet of [...new Set(packed.map((p) => p.sheetIndex))]) {
      const list = packed.filter((p) => p.sheetIndex === sheet).map((p) => ({ posX: p.x, posY: p.y, width: p.width, height: p.height }));
      assert.equal(classifySheetProfile(list), "legacy");
      for (const item of list) assert.equal(receiptLabelFits(item, list), true);
    }
  });

  test("API default stays legacy; production only on explicit mode", () => {
    assert.equal(resolveNestingMode({}), "legacy");
    assert.equal(resolveNestingMode({ mode: "grouped-v2" }), "grouped-v2");
    assert.equal(resolveNestingMode({ mode: "production-v3" }), "production-v3");
  });
});

describe("Production flow guards (explicit mode marker, no legacy fallback)", () => {
  const rowsOf = (status: string, r = run) =>
    r.placements.map((p) => ({ status, posX: p.posX, posY: p.posY, sheet: p.sheetIndex }));

  test("production rows carry the explicit marker and resolve as production, not from geometry", () => {
    const rows = rowsOf(STAGED_PRODUCTION);
    assert.deepEqual(sheetModeOf(rows), { mode: "production", source: "explicit" });
    // Explicit marker wins over geometry: a production-marked sheet is production even if it touched the 2 mm border.
    assert.equal(sheetModeOf([{ status: STAGED_PRODUCTION, posX: 2, posY: 2 }]).mode, "production");
  });

  test("Staging Area never re-runs nesting itself (no silent legacy run); Order Queue sends Production Nesting by default", () => {
    const staging = readFileSync("app/staging-area/page.tsx", "utf8") + readFileSync("components/staging-area/ControlPanel.tsx", "utf8");
    assert.equal(staging.includes("/api/staging/nest"), false);
    const queue = readFileSync("app/order-queue/page.tsx", "utf8");
    assert.ok(queue.includes('useState<NestingMode>("production")'));
    assert.ok(queue.includes('mode: "production-v3"'));
  });

  test("a production sheet rejects the legacy append; legacy sheets still accept it", () => {
    assert.match(appendBlockReason(rowsOf(STAGED_PRODUCTION)) ?? "", /Production Nesting/);
    const legacyRows = [{ status: STAGED_LEGACY, posX: 2, posY: 2 }];
    assert.equal(appendBlockReason(legacyRows), null);
    const appendRoute = readFileSync("app/api/staging/sheets/[sheetId]/append/route.ts", "utf8");
    assert.ok(appendRoute.indexOf("appendBlockReason(existingItems)") < appendRoute.indexOf("packIntoExistingSheet("), "guard runs before the legacy packer");
  });

  test("legacy historical flow: legacy rows stay legacy (explicit), completed history falls back to geometry", () => {
    assert.deepEqual(sheetModeOf([{ status: STAGED_LEGACY, posX: 2, posY: 2 }]), { mode: "legacy", source: "explicit" });
    assert.deepEqual(sheetModeOf([{ status: STAGING_COMPLETED, posX: 2, posY: 2 }]), { mode: "legacy", source: "geometry" });
    assert.deepEqual(sheetModeOf(rowsOf(STAGING_COMPLETED)), { mode: "production", source: "geometry" });
  });

  test("mixed-mode sheets are blocked (append and lock)", () => {
    const mixed = [...rowsOf(STAGED_PRODUCTION), { status: STAGED_LEGACY, posX: 2, posY: 2, sheet: 0 }];
    assert.equal(sheetModeOf(mixed).mode, "mixed");
    assert.ok(appendBlockReason(mixed));
    assert.match(MIXED_MODE_ERROR, /campuran/);
  });

  test("preview == persisted == export: locked layout keeps the staged placement and the production marker", () => {
    const staged = stagingPayload(run).map((s) => ({ ...s, status: STAGED_PRODUCTION }));
    const submitted = staged.map((s) => ({ ...s, status: "staged" })); // a stale client status must not win
    const { mismatched, layout } = matchSubmittedToStaged(staged, submitted);
    assert.equal(mismatched, 0);
    assert.ok(layout.every((item) => item.status === STAGED_PRODUCTION));
    assert.deepEqual(
      layout.map((i) => [i.id, i.sheetId, i.posX, i.posY, i.width, i.height, i.rotated]),
      staged.map((i) => [i.id, i.sheetId, i.posX, i.posY, i.width, i.height, i.rotated])
    );
    for (const sheet of [1, 2]) {
      const svg = buildPrintSvgDocument({ sheetId: sheet, items: layout.filter((i) => i.sheetId === sheet) });
      for (const item of layout.filter((i) => i.sheetId === sheet)) assert.ok(svg.includes(`transform="${getItemTransform(item)}"`));
    }
  });

  test("every receipt gets an internal label or is reported NO_SAFE_INTERNAL_LABEL; labels are not in the cut file", () => {
    const staged = stagingPayload(run);
    for (const sheet of [1, 2]) {
      const sheetItems = staged.filter((i) => i.sheetId === sheet);
      const labels = internalLabelsOf({ items: sheetItems })!;
      assert.deepEqual(labels.map((l) => l.orderId).sort(), [...new Set(sheetItems.map((i) => i.orderId))].sort());
      for (const l of labels) assert.ok(l.status === "PLACED" || l.status === "NO_SAFE_INTERNAL_LABEL");
      const dxf = buildSheetDxfDocument({ sheetId: sheet, items: sheetItems });
      assert.equal(/R\d{2}/.test(dxf), false, "receipt labels are not cut geometry");
    }
  });
});
