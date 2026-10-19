/**
 * Internal receipt labels (lib/receipt-labels.ts): a QC annotation pass on
 * a FINAL layout — never a nesting constraint. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSheetDxfDocument } from "@/lib/export-dxf";
import { buildPrintSvgDocument } from "@/lib/export-print-svg";
import { FIDUCIAL_CLEARANCE_MM } from "@/lib/nesting/grouped-nesting-config";
import { fiducialDistance, receiptBoxes, summarizeSheet, validatePlacedSheets } from "@/lib/production-gate";
import { internalLabelsOf, LABEL_CLEARANCE_MM, placeInternalReceiptLabels, type InternalLabel } from "@/lib/receipt-labels";
import { STAGED_LEGACY, STAGED_PRODUCTION } from "@/lib/staging-mode";
import { productionGroupOverlay } from "@/lib/staging-overlay";
import type { StagingItemPayload } from "@/lib/staging-types";
import { runProductionNesting } from "./production-nesting";
import { realBatch5Orders } from "./test-fixtures/real-batch-5-orders";
import { realBatch8Orders } from "./test-fixtures/real-batch-8-orders";

const EPS = 1e-6;
const code = (orderId: number) => `PROD-TEST-${String(orderId).padStart(3, "0")}`;

type Fp = { orderId: number; posX: number; posY: number; width: number; height: number; sheetIndex: number };

const runs = [
  { name: "28 item / 5 resi", run: runProductionNesting(realBatch5Orders()) },
  { name: "71 item / 8 resi", run: runProductionNesting(realBatch8Orders()) },
].map(({ name, run }) => {
  const footprints: Fp[] = run.placements.map((p) => ({ orderId: p.orderId!, posX: p.posX, posY: p.posY, width: p.width, height: p.height, sheetIndex: p.sheetIndex }));
  const sheets = [...new Set(footprints.map((f) => f.sheetIndex))].sort((a, b) => a - b);
  return { name, run, footprints, sheets };
});

/** Labels per sheet, computed on a deep-frozen copy of the layout (any mutation would throw). */
function labelSheets(footprints: Fp[], sheets: number[]) {
  return sheets.map((s) => {
    const items = footprints.filter((f) => f.sheetIndex === s).map((f) => Object.freeze({ ...f }));
    return { sheet: s, items, labels: placeInternalReceiptLabels(Object.freeze(items) as Fp[], code) };
  });
}

const rectsOverlap = (a: { x: number; y: number; w: number; h: number }, b: Fp, pad = 0) =>
  a.x < b.posX + b.width + pad - EPS && a.x + a.w > b.posX - pad + EPS && a.y < b.posY + b.height + pad - EPS && a.y + a.h > b.posY - pad + EPS;

for (const { name, run, footprints, sheets } of runs) {
  describe(`Internal receipt labels — ${name}`, () => {
    const before = JSON.stringify(run.placements);
    const boxesBefore = sheets.map((s) => receiptBoxes(footprints.filter((f) => f.sheetIndex === s)));
    const summaryBefore = sheets.map((s) => summarizeSheet(footprints.filter((f) => f.sheetIndex === s)));
    const labelled = labelSheets(footprints, sheets);

    test("1. layout coordinates before vs after labelling are 100% identical", () => {
      assert.equal(JSON.stringify(run.placements), before);
      assert.deepEqual(labelled.flatMap((l) => l.items), footprints.filter((f) => sheets.includes(f.sheetIndex)).sort((a, b) => a.sheetIndex - b.sheetIndex));
    });

    test("2. receipt box width/height identical", () => {
      assert.deepEqual(sheets.map((s) => receiptBoxes(footprints.filter((f) => f.sheetIndex === s))), boxesBefore);
    });

    test("3./4. used height, used width and sheet count identical", () => {
      assert.deepEqual(sheets.map((s) => summarizeSheet(footprints.filter((f) => f.sheetIndex === s))), summaryBefore);
      assert.equal(new Set(footprints.map((f) => f.sheetIndex)).size, run.sheetCount);
    });

    test("one entry per receipt, PLACED or NO_SAFE_INTERNAL_LABEL", () => {
      for (const { items, labels } of labelled) {
        assert.deepEqual(labels.map((l) => l.orderId).sort((a, b) => a - b), [...new Set(items.map((i) => i.orderId))].sort((a, b) => a - b));
      }
    });

    test("5./6./7. placed labels use existing free space only: inside their own box, clear of every artwork, out of the fiducial keep-out", () => {
      for (const { items, labels } of labelled) {
        const boxes = new Map(receiptBoxes(items).map((b) => [b.orderId, b.rect]));
        for (const label of labels.filter((l) => l.status === "PLACED")) {
          const r = label.rect!;
          const box = boxes.get(label.orderId)!;
          assert.ok(r.x >= box.x - EPS && r.y >= box.y - EPS && r.x + r.w <= box.x + box.w + EPS && r.y + r.h <= box.y + box.h + EPS, `label ${label.orderId} inside its box`);
          for (const item of items) assert.equal(rectsOverlap(r, item, LABEL_CLEARANCE_MM), false, `label ${label.orderId} vs artwork`);
          assert.ok(fiducialDistance({ posX: r.x, posY: r.y, width: r.w, height: r.h }) >= FIDUCIAL_CLEARANCE_MM - EPS);
        }
      }
    });

    test("10. deterministic", () => {
      assert.deepEqual(labelSheets(footprints, sheets).map((l) => l.labels), labelled.map((l) => l.labels));
    });
  });
}

describe("Internal receipt labels — fallback and isolation", () => {
  test("8. a full receipt box gets NO_SAFE_INTERNAL_LABEL — nothing moves, nothing grows", () => {
    // Two 40 x 20 parts PART_GAP apart: the only free space is a 2 mm strip.
    const items: Fp[] = [
      { orderId: 7, posX: 20, posY: 20, width: 40, height: 20, sheetIndex: 0 },
      { orderId: 7, posX: 62, posY: 20, width: 40, height: 20, sheetIndex: 0 },
    ];
    const snapshot = JSON.stringify(items);
    const [label] = placeInternalReceiptLabels(items, code);
    assert.equal(label.status, "NO_SAFE_INTERNAL_LABEL");
    assert.equal(label.rect, undefined);
    assert.equal(JSON.stringify(items), snapshot);
    assert.deepEqual(receiptBoxes(items)[0].rect, { x: 20, y: 20, w: 82, h: 20 });
  });

  test("a receipt with a real void gets its label in that void", () => {
    const items: Fp[] = [
      { orderId: 8, posX: 20, posY: 20, width: 80, height: 26, sheetIndex: 0 },
      { orderId: 8, posX: 20, posY: 48, width: 30, height: 26, sheetIndex: 0 },
    ];
    const [label] = placeInternalReceiptLabels(items, code);
    assert.equal(label.status, "PLACED");
    assert.equal(label.fontSize, 3);
    assert.ok(label.rect!.x >= 50 + LABEL_CLEARANCE_MM - EPS && label.rect!.y >= 46 + LABEL_CLEARANCE_MM - EPS);
  });

  test("a failed label never makes the sheet invalid (labels are not part of the gate)", () => {
    const items = [
      { key: "a", orderId: 7, sheet: 0, posX: 20, posY: 20, width: 40, height: 20, rotated: false, expectedWidth: 40, expectedHeight: 20 },
      { key: "b", orderId: 7, sheet: 0, posX: 62, posY: 20, width: 40, height: 20, rotated: false, expectedWidth: 40, expectedHeight: 20 },
    ];
    assert.equal(placeInternalReceiptLabels(items, code)[0].status, "NO_SAFE_INTERNAL_LABEL");
    assert.equal(validatePlacedSheets(items, ["a", "b"], "production").ok, true);
  });

  test("labels are not an input of the nesting engine (no engine module references them)", () => {
    for (const file of [
      "lib/nesting/production-nesting.ts",
      "lib/nesting/grouped-nesting.ts",
      "lib/nesting/grouped-nesting-candidates.ts",
      "lib/nesting/grouped-nesting-global.ts",
      "lib/nesting/grouped-nesting-outer.ts",
      "lib/nesting/outer-maxrects.ts",
      "lib/nesting/slot-reflow.ts",
      "lib/nesting/grouped-nesting-v3.ts",
      "lib/nesting/grouped-nesting-v3-compound.ts",
      "lib/nesting/grouped-nesting-v3-region.ts",
    ]) {
      const imports = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^import\b|^\s+[A-Za-z_, ]+$|from "/.test(line))
        .join("\n");
      assert.doesNotMatch(imports, /receipt-labels|receiptLabel|RECEIPT_LABEL|ITEM_PADDING_BOTTOM|keychain-geometry/, file);
    }
  });
});

describe("Internal receipt labels — export", () => {
  const { footprints } = runs[0];
  const payload = (status: string): StagingItemPayload[] =>
    footprints.map((f, i) => ({
      id: i + 1,
      orderId: f.orderId,
      templateId: 1,
      customerName: `N${i}`,
      sheetId: 1,
      posX: f.posX,
      posY: f.posY,
      width: f.width,
      height: f.height,
      rotated: false,
      status,
      order: { id: f.orderId, receiptCode: code(f.orderId), manualCode: "" },
      template: null,
      render: { width: f.width, height: f.height, outlinePath: "M0 0h1v1z", holePath: null, textSegments: [], characterImage: null },
    })) as unknown as StagingItemPayload[];

  test("9. DXF identical with or without labels and contains no label text", () => {
    const production = buildSheetDxfDocument({ sheetId: 1, items: payload(STAGED_PRODUCTION) });
    // Different receipt codes = different label text and placement: the DXF must not change at all.
    const relabelled = payload(STAGED_PRODUCTION).map((i) => ({ ...i, order: { ...i.order!, receiptCode: `OTHER-CODE-${i.orderId}-XYZ` } }));
    assert.equal(buildSheetDxfDocument({ sheetId: 1, items: relabelled }), production);
    assert.equal(/PROD-TEST|OTHER-CODE/.test(production), false);
    // Legacy DXF of the same items still builds (full 470 frame, see active-frame tests).
    assert.ok(buildSheetDxfDocument({ sheetId: 1, items: payload(STAGED_LEGACY) }).includes("CUT_OUTLINE"));
  });

  test("print (JPG) shows exactly the placed internal labels, at the same transform as the preview", () => {
    const items = payload(STAGED_PRODUCTION);
    const labels = internalLabelsOf({ items }) as InternalLabel[];
    const svg = buildPrintSvgDocument({ sheetId: 1, items });
    const placed = labels.filter((l) => l.status === "PLACED");
    assert.equal((svg.match(/>PROD-TEST-\d+<\/text>/g) ?? []).length, placed.length);
    for (const l of placed) assert.ok(svg.includes(`<text transform="${l.transform}"`));
  });

  test("legacy sheets keep the per-item label exactly as before", () => {
    const items = payload(STAGED_LEGACY);
    assert.equal(internalLabelsOf({ items }), null);
    const svg = buildPrintSvgDocument({ sheetId: 1, items });
    assert.equal((svg.match(/>PROD-TEST-\d+<\/text>/g) ?? []).length, items.length);
  });
});

describe("Staging overlay — external receipt code only in debug", () => {
  const { footprints } = runs[0];
  const items = footprints.map((f) => ({ ...f, order: { receiptCode: code(f.orderId) } }));
  const production = { summary: { profile: "production" }, items };
  const legacy = { summary: { profile: "legacy" }, items };
  const canvas = readFileSync("components/staging-area/StagingCanvas.tsx", "utf8");

  test("Production normal: receipt outlines, NO external group label", () => {
    const overlay = productionGroupOverlay(production, false);
    assert.equal(overlay.outlines.length, 5);
    assert.deepEqual(overlay.externalLabels, []);
  });

  test("Production debug: external group label allowed", () => {
    const overlay = productionGroupOverlay(production, true);
    assert.equal(overlay.externalLabels.length, 5);
    assert.ok(overlay.externalLabels.every((l) => l.text.startsWith("PROD-TEST-")));
  });

  test("NO_SAFE_INTERNAL_LABEL gets no external fallback in normal view", () => {
    const full = { summary: { profile: "production" }, items: [
      { orderId: 7, posX: 20, posY: 20, width: 40, height: 20, order: { receiptCode: "FULL-7" } },
      { orderId: 7, posX: 62, posY: 20, width: 40, height: 20, order: { receiptCode: "FULL-7" } },
    ] };
    assert.equal(placeInternalReceiptLabels(full.items, () => "FULL-7")[0].status, "NO_SAFE_INTERNAL_LABEL");
    assert.deepEqual(productionGroupOverlay(full, false).externalLabels, []);
  });

  test("Legacy unchanged: no outlines, no external labels (per-item labels stay)", () => {
    assert.deepEqual(productionGroupOverlay(legacy, false), { outlines: [], externalLabels: [] });
    assert.deepEqual(productionGroupOverlay(legacy, true), { outlines: [], externalLabels: [] });
    assert.match(canvas, /item\.order &&\s*!internalLabels &&/);
  });

  test("the canvas draws group codes only from the overlay (debug-gated), not from the boxes directly", () => {
    assert.match(canvas, /productionGroupOverlay\(sheet, showDebug\)/);
    assert.match(canvas, /overlay\.externalLabels\.map/);
    assert.doesNotMatch(canvas, /receiptCodeOf/);
  });

  test("overlay does not move artwork or change footprints", () => {
    const before = JSON.stringify(items);
    productionGroupOverlay(production, true);
    assert.equal(JSON.stringify(items), before);
    const overlay = productionGroupOverlay(production, false);
    for (const [i, box] of receiptBoxes(items).entries()) {
      assert.deepEqual(overlay.outlines[i], { orderId: box.orderId, x: box.rect.x - 1, y: box.rect.y - 1, w: box.rect.w + 2, h: box.rect.h + 2 });
    }
  });
});
