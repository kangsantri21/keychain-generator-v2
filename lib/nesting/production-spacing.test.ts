/**
 * Production per-axis receipt spacing: side-by-side receipts GROUP_GAP_X 2,
 * stacked receipts ORDER_GAP 8, PART_GAP 2 inside a receipt, camera
 * fiducials as keep-out. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildPrintSvgDocument } from "@/lib/export-print-svg";
import { buildSheetDxfDocument } from "@/lib/export-dxf";
import { FIDUCIAL_RADIUS_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { FIDUCIAL_CENTERS, fiducialDistance, receiptBoxes, receiptsSeparated, validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import { getItemTransform } from "@/lib/staging-transform";
import { runGroupedNesting, resolveConfig } from "./grouped-nesting";
import { FIDUCIAL_CLEARANCE_MM, PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, ORDER_GAP_MM, PART_GAP_MM, SHEET_MARGIN_MM, outerSpacing } from "./grouped-nesting-config";
import { runGroupedNestingV3, validateLayout } from "./grouped-nesting-v3";
import { compoundStage } from "./grouped-nesting-v3-compound";
import { regionStage } from "./grouped-nesting-v3-region";
import { PRODUCTION_SPACING_OVERRIDES, runProductionNesting } from "./production-nesting";
import { realBatch8Orders } from "./test-fixtures/real-batch-8-orders";
import { realBatch5Orders } from "./test-fixtures/real-batch-5-orders";
import type { GroupedNestingItem } from "./grouped-nesting-types";

const EPS = 1e-6;
type Run = ReturnType<typeof runProductionNesting<{ itemId: number }>>;

function placedOf(items: GroupedNestingItem<{ itemId: number }>[], run: Run): PlacedItem[] {
  const byData = new Map(items.map((i) => [i.data, i]));
  return run.placements.map((p) => {
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

const box = (key: string, orderId: number, posX: number, posY: number, width: number, height: number): PlacedItem => ({
  key,
  orderId,
  sheet: 0,
  posX,
  posY,
  width,
  height,
  rotated: false,
  expectedWidth: width,
  expectedHeight: height,
});

/** Clear distance between two footprints (0 when touching/overlapping). */
const rectDistance = (a: PlacedItem, b: PlacedItem) =>
  Math.hypot(
    Math.max(0, b.posX - (a.posX + a.width), a.posX - (b.posX + b.width)),
    Math.max(0, b.posY - (a.posY + a.height), a.posY - (b.posY + b.height))
  );

const combined: GroupedNestingItem<{ itemId: number }>[] = [
  ...realBatch8Orders(),
  ...realBatch5Orders().map((i) => ({ ...i, id: 1000 + Number(i.id), data: { itemId: 1000 + i.data.itemId } })),
];
const fixtures = [
  { name: "71 item / 8 resi", items: realBatch8Orders() },
  { name: "28 item / 5 resi", items: realBatch5Orders() },
  { name: "99 item / 13 resi (multi-sheet)", items: combined },
].map((f) => {
  const run = runProductionNesting(f.items);
  return { ...f, run, placed: placedOf(f.items, run) };
});

describe("Production spacing — model", () => {
  test("Production receipt gaps are 2 mm on both axes; PART_GAP stays 2; the global ORDER_GAP (V2/legacy/experiments) stays 8", () => {
    const s = outerSpacing(resolveConfig(PRODUCTION_SPACING_OVERRIDES));
    assert.deepEqual(s, { marginX: 3, marginY: 11, gapX: 2, gapY: 2 });
    assert.deepEqual([s.marginX + s.gapX, s.marginY + s.gapY], [5, 13], "first receipt 5 mm from the left, 13 mm from the top (unchanged)");
    assert.equal(PRODUCTION_GROUP_GAP_X_MM, 2);
    assert.equal(PRODUCTION_GROUP_GAP_Y_MM, 2);
    assert.equal(PART_GAP_MM, 2);
    assert.equal(ORDER_GAP_MM, 8);
    // Without overrides both axes are the original single gap.
    assert.deepEqual(outerSpacing(resolveConfig({})), { marginX: 5, marginY: 5, gapX: 8, gapY: 8 });
  });

  test("Legacy/V2/old-V3 defaults are untouched by the per-axis refactor", () => {
    const items = realBatch8Orders();
    assert.ok(Math.abs(runGroupedNesting(items).summary.sumUsedHeight - 665.262) < 0.01);
    const cfg = resolveConfig({});
    const v3 = runGroupedNestingV3(items, {}, undefined, { trace: false, compound: compoundStage(cfg), region: regionStage(cfg) });
    assert.ok(Math.abs(v3.result.summary.sumUsedHeight - 620.065) < 0.01, String(v3.result.summary.sumUsedHeight));
  });
});

describe("Production spacing — receipt borders may touch", () => {
  test("1. two receipts side by side, boxes GROUP_GAP_X apart, drawn borders touching: VALID", () => {
    const a = box("a", 1, 5, 13, 80, 26);
    const b = box("b", 2, 5 + 80 + PRODUCTION_GROUP_GAP_X_MM, 13, 80, 26);
    const gate = validatePlacedSheets([a, b], ["a", "b"], "production");
    assert.deepEqual(gate.errors, []);
    // The Staging outline is drawn GROUP_GAP_X / 2 outside each receipt box: right edge of A == left edge of B.
    const pad = PRODUCTION_GROUP_GAP_X_MM / 2;
    assert.equal(a.posX + a.width + pad, b.posX - pad);
  });

  test("receipt gap 1.999 mm INVALID, 2.000 mm VALID — side by side and stacked", () => {
    const a = box("a", 1, 5, 13, 80, 26);
    const gate = (b: PlacedItem) => validatePlacedSheets([a, b], ["a", "b"], "production").ok;
    assert.equal(gate(box("b", 2, 5 + 80 + 1.999, 13, 80, 26)), false);
    assert.equal(gate(box("b", 2, 5 + 80 + 2, 13, 80, 26)), true);
    assert.equal(gate(box("b", 2, 5, 13 + 26 + 1.999, 80, 26)), false);
    assert.equal(gate(box("b", 2, 5, 13 + 26 + 2, 80, 26)), true);
    assert.equal(receiptsSeparated({ x: 5, y: 13, w: 80, h: 26 }, { x: 5, y: 41, w: 80, h: 26 }), true);
    assert.equal(receiptsSeparated({ x: 5, y: 13, w: 80, h: 26 }, { x: 5, y: 40.999, w: 80, h: 26 }), false);
  });

  test("older sheets staged with the 8 mm gap stay VALID", () => {
    const a = box("a", 1, 5, 13, 80, 26);
    assert.equal(validatePlacedSheets([a, box("b", 2, 5, 13 + 26 + 8, 80, 26)], ["a", "b"], "production").ok, true);
  });

  test("the real layouts really use the tight side-by-side gap", () => {
    const { placed } = fixtures[1];
    const boxes = receiptBoxes(placed);
    const tight = boxes.some((a) =>
      boxes.some((b) => a !== b && Math.abs(b.rect.x - (a.rect.x + a.rect.w) - PRODUCTION_GROUP_GAP_X_MM) < 1e-3 && Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) > Math.max(a.rect.y, b.rect.y))
    );
    assert.ok(tight, "expected at least one receipt pair exactly GROUP_GAP_X apart side by side");
  });
});

for (const f of fixtures) {
  describe(`Production spacing — ${f.name}`, () => {
    test("ok, gate clean (7. no duplicate/missing, sizes unchanged)", () => {
      assert.equal(f.run.ok, true, f.run.errors.join("; "));
      assert.equal(f.run.placements.length, f.items.length);
      assert.deepEqual(validatePlacedSheets(f.placed, f.items.map((i) => String(i.id)), "production").errors, []);
      assert.deepEqual(validateLayout(f.run.result.groups, resolveConfig(PRODUCTION_SPACING_OVERRIDES), f.items.map((i) => i.id)), []);
    });

    test("2. artwork of different receipts never overlaps and stays >= PART_GAP apart", () => {
      for (const a of f.placed) {
        for (const b of f.placed) {
          if (a === b || a.sheet !== b.sheet || a.orderId === b.orderId) continue;
          assert.ok(rectDistance(a, b) >= PRODUCTION_GROUP_GAP_X_MM - EPS, `${a.key}/${b.key}: ${rectDistance(a, b)}`);
        }
      }
    });

    test("3. PART_GAP inside a receipt is still 2 mm", () => {
      for (const a of f.placed) {
        for (const b of f.placed) {
          if (a === b || a.sheet !== b.sheet || a.orderId !== b.orderId) continue;
          const separation = Math.max(b.posX - (a.posX + a.width), a.posX - (b.posX + b.width), b.posY - (a.posY + a.height), a.posY - (b.posY + b.height));
          assert.ok(separation >= PART_GAP_MM - EPS, `${a.key}/${b.key}: ${separation}`);
        }
      }
    });

    test("4. no artwork within FIDUCIAL_CLEARANCE of the 4 camera fiducials", () => {
      for (const p of f.placed) assert.ok(fiducialDistance(p) >= FIDUCIAL_CLEARANCE_MM - EPS, `${p.key}: ${fiducialDistance(p)}`);
    });

    test("5. every item inside the media, >= SHEET_MARGIN from left/right/top/bottom", () => {
      for (const p of f.placed) {
        assert.ok(p.posX >= SHEET_MARGIN_MM - EPS && p.posY >= SHEET_MARGIN_MM - EPS, p.key);
        assert.ok(p.posX + p.width <= SHEET_WIDTH_MM - SHEET_MARGIN_MM + EPS && p.posY + p.height <= SHEET_HEIGHT_MM - SHEET_MARGIN_MM + EPS, p.key);
      }
    });

    test("6. one receipt on one sheet", () => {
      const sheets = new Map<number, Set<number>>();
      for (const p of f.placed) sheets.set(p.orderId, (sheets.get(p.orderId) ?? new Set()).add(p.sheet));
      for (const [orderId, s] of sheets) assert.equal(s.size, 1, `order ${orderId}`);
    });

    test("8. deterministic", () => {
      const again = runProductionNesting(f.items);
      assert.deepEqual(again.placements, f.run.placements);
    });
  });
}

describe("Production spacing — results", () => {
  test("71/8: 2 sheets, 557.613 mm (596.635 with y gap 8; 620.065 with the single 8 mm gap)", () => {
    assert.equal(fixtures[0].run.sheetCount, 2);
    assert.ok(Math.abs(fixtures[0].run.sumUsedHeight - 557.613) < 0.01, String(fixtures[0].run.sumUsedHeight));
  });

  test("28/5: 1 sheet, 257.013 mm (261.030 with y gap 8; 289.951 with the single 8 mm gap)", () => {
    assert.equal(fixtures[1].run.sheetCount, 1);
    assert.ok(Math.abs(fixtures[1].run.sumUsedHeight - 257.013) < 0.01, String(fixtures[1].run.sumUsedHeight));
  });

  test("9. multi-sheet (99 items) valid on every sheet", () => {
    const { run, placed } = fixtures[2];
    assert.ok(run.sheetCount >= 2);
    for (let s = 0; s < run.sheetCount; s++) {
      const list = placed.filter((p) => p.sheet === s);
      assert.ok(list.length > 0);
      assert.deepEqual(validatePlacedSheets(list, list.map((p) => p.key), "production").errors, []);
    }
  });
});

describe("Production spacing — fiducials & export", () => {
  test("fiducial keep-out uses exactly the circles both exports draw/cut", () => {
    const svg = buildPrintSvgDocument({ sheetId: 1, items: [] });
    const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) }));
    assert.deepEqual(circles.map(({ x, y }) => ({ x, y })), FIDUCIAL_CENTERS);
    for (const c of circles) assert.equal(c.r, FIDUCIAL_RADIUS_MM);
    assert.equal((buildSheetDxfDocument({ sheetId: 1, items: [] }).match(/CUT_FIDUCIAL/g) ?? []).length >= 4, true);
  });

  test("an item touching a fiducial's clearance is rejected", () => {
    const near = box("n", 1, SHEET_MARGIN_MM, SHEET_MARGIN_MM, 30, 20); // corner 1.04 mm from the top-left fiducial
    assert.ok(fiducialDistance(near) < FIDUCIAL_CLEARANCE_MM);
    const gate = validatePlacedSheets([near], ["n"], "production");
    assert.ok(gate.errors.some((e) => e.includes("marker kamera")), gate.errors.join("; "));
  });

  test("10. JPG/DXF item transform unchanged", () => {
    assert.equal(getItemTransform({ posX: 5, posY: 13, width: 26.207, rotated: false }), "translate(5, 13)");
    assert.equal(getItemTransform({ posX: 87, posY: 13, width: 26.207, rotated: true }), "translate(113.207, 13) rotate(90)");
  });
});
