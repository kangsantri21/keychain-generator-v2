/**
 * Active Production Frame V1 (lib/active-frame.ts): adaptive height, one
 * frame for Staging preview, print JPG and DXF. `npm test`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  activeProductionFrame,
  frameFiducials,
  frameViolations,
  productionContentRects,
  placeBatchLabel,
  rectToFiducial,
} from "@/lib/active-frame";
import { buildSheetDxfDocument } from "@/lib/export-dxf";
import { batchLabelOf, buildPrintSvgDocument, printPixelsOf } from "@/lib/export-print-svg";
import { FIDUCIAL_RADIUS_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { receiptBoxes } from "@/lib/production-gate";
import { internalLabelsOf, LABEL_CLEARANCE_MM } from "@/lib/receipt-labels";
import { STAGED_LEGACY, STAGED_PRODUCTION } from "@/lib/staging-mode";
import { getItemTransform } from "@/lib/staging-transform";
import type { StagingItemPayload, StagingSheet } from "@/lib/staging-types";
import { FIDUCIAL_CLEARANCE_MM, PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, PART_GAP_MM, SHEET_MARGIN_MM } from "./grouped-nesting-config";
import { acceptedProductionLayout } from "./test-fixtures/accepted-production-layout";

const EPS = 1e-6;

type Item = ReturnType<typeof acceptedProductionLayout>[number];

/** Shortest valid frame: valid at H, a violation at H - 1 (or H is the 470 media). */
function assertShortest(items: Item[], H: number) {
  const content = productionContentRects(items);
  assert.deepEqual(frameViolations(content, H), []);
  if (H < SHEET_HEIGHT_MM) assert.ok(frameViolations(content, H - 1).length > 0);
}

/** DXF LWPOLYLINE points of the given layers, in order. */
const dxfPoints = (dxf: string, layer: RegExp) =>
  dxf
    .split("\n0\n")
    .filter((e) => layer.test(e))
    .flatMap((e) => {
      const l = e.split("\n");
      const pts: [number, number][] = [];
      for (let k = 0; k < l.length; k++) if (l[k] === "10") pts.push([Number(l[k + 1]), Number(l[k + 3])]);
      return pts;
    });

/** Staging/locked payload for the export builders (render = footprint-sized outline, no artwork bitmap). */
function payload(items: Item[], status = STAGED_PRODUCTION): StagingSheet {
  return {
    sheetId: 1,
    items: items.map((i) => ({
      ...i,
      templateId: 1,
      customerName: `N${i.id}`,
      sheetId: 1,
      status,
      order: { id: i.orderId, receiptCode: i.order.receiptCode, manualCode: "" },
      template: null,
      render: {
        width: i.rotated ? i.height : i.width,
        height: i.rotated ? i.width : i.height,
        outlinePath: `M0 0h${i.rotated ? i.height : i.width}v${i.rotated ? i.width : i.height}h-${i.rotated ? i.height : i.width}z`,
        holePath: null,
        textSegments: [{ d: "M1 1h1v1z", color: "#000" }],
        characterImage: null,
      },
    })) as unknown as StagingItemPayload[],
  };
}

const item = (id: number, orderId: number, posX: number, posY: number, width: number, height: number): Item => ({
  id,
  orderId,
  posX,
  posY,
  width,
  height,
  rotated: false,
  status: STAGED_PRODUCTION,
  order: { receiptCode: `R${orderId}` },
});

const accepted = acceptedProductionLayout();
const acceptedFrame = activeProductionFrame({ items: accepted });
const dxfCircles = (dxf: string) =>
  dxf
    .split("\n0\n")
    .filter((e) => e.includes("\nCUT_FIDUCIAL\n") && e.startsWith("CIRCLE"))
    .map((e) => {
      const l = e.split("\n");
      return { x: Number(l[l.indexOf("10") + 1]), y: Number(l[l.indexOf("20") + 1]), r: Number(l[l.indexOf("40") + 1]) };
    });

describe("Active frame — height", () => {
  test("1. SMALL batch: content only at the top -> frame < 470, bottom markers move up", () => {
    const items = [item(1, 1, 5, 13, 80, 26), item(2, 2, 87, 13, 80, 26)];
    const frame = activeProductionFrame({ items });
    assert.equal(frame.adaptive, true);
    assert.ok(frame.heightMm >= 39 + SHEET_MARGIN_MM && frame.heightMm < 60);
    assertShortest(items, frame.heightMm);
    const bottom = frame.fiducials.filter((f) => f.corner.startsWith("bottom"));
    assert.deepEqual(bottom.map((f) => f.y), [frame.heightMm - FIDUCIAL_RADIUS_MM, frame.heightMm - FIDUCIAL_RADIUS_MM]);
    assert.deepEqual(frame.errors, []);
  });

  test("2. MEDIUM batch: the frame follows the content (100 mm lower content -> 100 mm taller frame)", () => {
    const a = activeProductionFrame({ items: [item(1, 1, 20, 13, 80, 100)] });
    const b = activeProductionFrame({ items: [item(1, 1, 20, 113, 80, 100)] });
    assert.equal(b.heightMm - a.heightMm, 100);
  });

  test("3. FULL batch: content needing (almost) the whole media keeps 310 x 470; more is INVALID, never re-laid", () => {
    const full = activeProductionFrame({ items: [item(1, 1, 20, 13, 80, SHEET_HEIGHT_MM - SHEET_MARGIN_MM - 13)] });
    assert.equal(full.heightMm, SHEET_HEIGHT_MM);
    assert.deepEqual(full.errors, []);
    const tooTall = activeProductionFrame({ items: [item(1, 1, 20, 13, 80, SHEET_HEIGHT_MM - 13)] });
    assert.equal(tooTall.heightMm, SHEET_HEIGHT_MM);
    assert.ok(tooTall.errors.length > 0);
    assert.throws(() => buildPrintSvgDocument(payload([item(1, 1, 20, 13, 80, SHEET_HEIGHT_MM - 13)])));
    assert.throws(() => buildSheetDxfDocument(payload([item(1, 1, 20, 13, 80, SHEET_HEIGHT_MM - 13)])));
  });

  test("whole-mm, the shortest valid height: one mm less violates a rule", () => {
    assert.equal(acceptedFrame.heightMm % 1, 0);
    assertShortest(accepted, acceptedFrame.heightMm);
  });

  test("4./5. fiducial clearance: exactly 2 mm VALID, 1.999 mm INVALID", () => {
    const H = 200;
    const bl = frameFiducials(H).find((f) => f.corner === "bottom-left")!;
    // Directly above the bottom-left marker: clearance = (marker top) - (rect bottom).
    const at = (gap: number) => ({ x: 0, y: bl.y - bl.r - gap - 10, w: 10, h: 10 });
    assert.ok(Math.abs(rectToFiducial(at(2), bl) - 2) < 1e-9);
    const fiducialErrors = (gap: number) => frameViolations([at(gap)], H).filter((e) => e.includes("marker kamera"));
    assert.deepEqual(fiducialErrors(FIDUCIAL_CLEARANCE_MM), []);
    assert.equal(fiducialErrors(1.999).length, 1);
  });

  test("12. deterministic", () => {
    assert.deepEqual(activeProductionFrame({ items: acceptedProductionLayout() }), acceptedFrame);
  });
});

describe("Active frame — accepted real layout (26 items / 4 receipts)", () => {
  test("frame 310 x 229: content bottom 222.424, 241 mm saved (no batch-label band)", () => {
    assert.equal(acceptedFrame.widthMm, 310);
    assert.equal(acceptedFrame.heightMm, 229);
    assert.ok(Math.abs(acceptedFrame.contentBottomMm - 222.424) < 1e-6);
    assert.equal(acceptedFrame.savedMm, 241);
    assert.deepEqual(acceptedFrame.errors, []);
  });

  test("10. receipt groups and every item position identical (the frame never touches the layout)", () => {
    const fresh = acceptedProductionLayout();
    assert.deepEqual(accepted, fresh);
    assert.deepEqual(receiptBoxes(accepted), receiptBoxes(fresh));
  });

  test("8. markers: same size, top unchanged, bottom x unchanged, only bottom y moves", () => {
    const before = frameFiducials(SHEET_HEIGHT_MM);
    acceptedFrame.fiducials.forEach((f, i) => {
      assert.equal(f.r, before[i].r);
      assert.equal(f.x, before[i].x);
      if (f.corner.startsWith("top")) assert.equal(f.y, before[i].y);
      else assert.equal(f.y, acceptedFrame.heightMm - FIDUCIAL_RADIUS_MM);
    });
  });

  test("11. internal labels and all artwork clear every marker by >= 2 mm and stay inside the frame", () => {
    const labels = internalLabelsOf({ items: accepted })!.filter((l) => l.rect);
    assert.ok(labels.length > 0);
    for (const r of [...labels.map((l) => l.rect!), ...accepted.map((i) => ({ x: i.posX, y: i.posY, w: i.width, h: i.height }))]) {
      for (const f of acceptedFrame.fiducials) assert.ok(rectToFiducial(r, f) >= FIDUCIAL_CLEARANCE_MM - EPS);
      assert.ok(r.y + r.h <= acceptedFrame.heightMm - SHEET_MARGIN_MM + EPS);
    }
  });
});

describe("Active frame — exports", () => {
  const sheet = payload(accepted);
  const fullSheet = payload(accepted, STAGED_LEGACY);
  const svg = buildPrintSvgDocument(sheet, "BATCH-1019");
  const dxf = buildSheetDxfDocument(sheet);
  const H = acceptedFrame.heightMm;

  test("6. JPG: crop, not scale — 1 viewBox unit = 1 mm, same item transforms, same 300 DPI", () => {
    assert.match(svg, /<svg [^>]*width="310mm" height="229mm" viewBox="0 0 310 229">/);
    for (const i of sheet.items) assert.ok(svg.includes(`<g transform="${getItemTransform(i)}">`));
    assert.equal(printPixelsOf(SHEET_WIDTH_MM), 3661);
    assert.equal(printPixelsOf(H), Math.round((H / 25.4) * 300));
    assert.ok(Math.abs(printPixelsOf(H) / H - printPixelsOf(SHEET_HEIGHT_MM) / SHEET_HEIGHT_MM) < 0.01, "same px per mm");
  });

  test("9. JPG mirror unchanged (horizontal, width 310)", () => {
    assert.ok(svg.includes(`<g id="print-layer-mirrored" transform="translate(310, 0) scale(-1, 1)">`));
  });

  test("JPG: border and markers on the active frame; the batch code sits in existing whitespace (not bottom-center)", () => {
    assert.ok(svg.includes(`<rect x="0" y="0" width="310" height="229" fill="none"`));
    assert.ok(svg.includes(`<circle cx="2.5" cy="226.5" r="2.5" fill="#000000" />`));
    assert.ok(svg.includes(`<circle cx="2.5" cy="2.5" r="2.5" fill="#000000" />`));
    const label = batchLabelOf(sheet, "BATCH-1019")!;
    assert.equal(label.status, "PLACED_INTERNAL");
    assert.ok(svg.includes(`<text transform="${label.transform}" x="0" y="0" font-size="6" textLength="${label.textLength}" lengthAdjust="spacingAndGlyphs" fill="#000000">BATCH-1019</text>`));
    assert.doesNotMatch(svg, /text-anchor="middle"/);
  });

  test("batch label uses existing whitespace only: inside the frame, clear of all content, markers and the border; frame unchanged", () => {
    const label = batchLabelOf(sheet, "BATCH-1019")!;
    const r = label.rect!;
    assert.ok(r.x >= 2 - EPS && r.y >= 2 - EPS && r.x + r.w <= 310 - 2 + EPS && r.y + r.h <= H - 2 + EPS);
    for (const c of productionContentRects(accepted)) {
      const gap = Math.hypot(Math.max(0, c.x - (r.x + r.w), r.x - (c.x + c.w)), Math.max(0, c.y - (r.y + r.h), r.y - (c.y + c.h)));
      assert.ok(gap >= LABEL_CLEARANCE_MM - EPS);
    }
    for (const f of acceptedFrame.fiducials) assert.ok(rectToFiducial(r, f) >= FIDUCIAL_CLEARANCE_MM - EPS);
    assert.deepEqual(activeProductionFrame(sheet), acceptedFrame);
  });

  test("no safe position -> NO_SAFE_POSITION, nothing printed, frame and export still valid", () => {
    const longCode = "X".repeat(200);
    const label = placeBatchLabel(sheet, acceptedFrame, longCode);
    assert.equal(label.status, "NO_SAFE_POSITION");
    assert.ok(label.reason);
    const svgNoLabel = buildPrintSvgDocument(sheet, longCode);
    assert.doesNotMatch(svgNoLabel, /XXXXXXXXXX/);
    assert.match(svgNoLabel, /viewBox="0 0 310 229"/);
    assert.doesNotThrow(() => buildSheetDxfDocument(sheet));
  });

  test("the active height never depends on the batch code", () => {
    for (const code of [undefined, "", "B", "BATCH-1019", "X".repeat(200)]) {
      assert.match(buildPrintSvgDocument(sheet, code), /width="310mm" height="229mm" viewBox="0 0 310 229"/);
    }
  });

  test("7. DXF uses the active frame as its coordinate system: extent 0..310 x 0..229", () => {
    const all = [...dxfPoints(dxf, /\nCUT_(OUTLINE|HOLE|BORDER)\n/), ...dxfCircles(dxf).flatMap((c) => [[c.x - c.r, c.y - c.r], [c.x + c.r, c.y + c.r]] as [number, number][])];
    assert.deepEqual([Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))], [0, 310]);
    assert.deepEqual([Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))], [0, H]);
    assert.deepEqual(dxfPoints(dxf, /\nCUT_BORDER\n/), [[0, H], [310, H], [310, 0], [0, 0]]);
  });

  test("7. DXF relative cut geometry identical: every cut point = the 470 version shifted by exactly H - 470 (3-decimal output)", () => {
    const [a, b] = [dxfPoints(dxf, /\nCUT_(OUTLINE|HOLE)\n/), dxfPoints(buildSheetDxfDocument(fullSheet), /\nCUT_(OUTLINE|HOLE)\n/)];
    assert.ok(a.length >= accepted.length * 4);
    assert.equal(a.length, b.length);
    a.forEach((p, i) => {
      assert.equal(p[0], b[i][0]);
      assert.ok(Math.abs(p[1] - b[i][1] - (H - SHEET_HEIGHT_MM)) <= 0.0011, `${p} vs ${b[i]}`);
    });
  });

  test("JPG and DXF place every item at the same physical spot; only the JPG is mirrored", () => {
    // DXF: each item's outline (its footprint rect) sits at posX..posX+w, Y-up in the active frame — not mirrored.
    const outlines = dxf.split("\n0\n").filter((e) => e.startsWith("LWPOLYLINE") && /\nCUT_OUTLINE\n/.test(e));
    assert.equal(outlines.length, accepted.length);
    accepted.forEach((i, k) => {
      const l = outlines[k].split("\n");
      const pts: [number, number][] = [];
      for (let j = 0; j < l.length; j++) if (l[j] === "10") pts.push([Number(l[j + 1]), Number(l[j + 3])]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      assert.ok(Math.abs(Math.min(...xs) - i.posX) < 0.002 && Math.abs(Math.max(...xs) - (i.posX + i.width)) < 0.002, `item ${i.id} x`);
      assert.ok(Math.abs(Math.max(...ys) - (H - i.posY)) < 0.002 && Math.abs(Math.min(...ys) - (H - i.posY - i.height)) < 0.002, `item ${i.id} y`);
    });
    // JPG: the same sheet transform per item, inside the one horizontal mirror of the print layer.
    for (const i of sheet.items) assert.ok(svg.includes(`<g transform="${getItemTransform(i)}">`));
    assert.equal((svg.match(/scale\(-1, 1\)/g) ?? []).length, 1);
    assert.doesNotMatch(dxf, /scale|mirror/i);
  });

  test("8. DXF marker geometry: same radius and x; top markers keep their distance to the artwork; bottom ones follow the frame", () => {
    const [after, before] = [dxfCircles(dxf), dxfCircles(buildSheetDxfDocument(fullSheet))];
    assert.equal(after.length, 4);
    after.forEach((c, i) => {
      assert.equal(c.x, before[i].x);
      assert.equal(c.r, before[i].r);
    });
    // Y-up in the frame: top markers at H - 2.5 (same offset from the artwork as before), bottom ones at 2.5 (frame bottom).
    assert.deepEqual(after.map((c) => c.y).sort((x, y) => x - y), [2.5, 2.5, H - 2.5, H - 2.5]);
    assert.deepEqual(before.map((c) => c.y).sort((x, y) => x - y), [2.5, 2.5, 467.5, 467.5]);
  });

  test("preview, JPG and DXF read the same frame object", () => {
    for (const file of ["components/staging-area/StagingCanvas.tsx", "components/staging-area/SheetMetrics.tsx", "lib/export-print-svg.ts", "lib/export-dxf.ts"]) {
      assert.match(readFileSync(file, "utf8"), /activeProductionFrame\(/, file);
    }
  });

  test("the batch lock and the Staging summary refuse a layout the frame cannot hold", () => {
    assert.match(readFileSync("app/api/print-batches/route.ts", "utf8"), /activeProductionFrame\(\{ items: match\.layout \}\)\.errors/);
    assert.match(readFileSync("app/api/staging/route.ts", "utf8"), /activeProductionFrame\(\{ items: sheetItems \}\)\.errors/);
  });
});

describe("Active frame — regressions", () => {
  const filesUnder = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
    });

  test("13. Legacy keeps the full 310 x 470 frame, markers in the corners, the DXF border 0..470", () => {
    const legacy = payload(accepted, STAGED_LEGACY);
    const frame = activeProductionFrame(legacy);
    assert.deepEqual([frame.adaptive, frame.heightMm, frame.savedMm], [false, 470, 0]);
    const svg = buildPrintSvgDocument(legacy);
    assert.match(svg, /width="310mm" height="470mm" viewBox="0 0 310 470"/);
    assert.ok(svg.includes(`<circle cx="307.5" cy="467.5" r="2.5" fill="#000000" />`));
    assert.deepEqual(dxfCircles(buildSheetDxfDocument(legacy)).map((c) => c.y).sort((a, b) => a - b), [2.5, 2.5, 467.5, 467.5]);
  });

  test("14. Mahar never uses the active frame", () => {
    for (const p of [...filesUnder("lib").filter((x) => /mahar/.test(x)), ...filesUnder("app/mahar-nesting"), ...filesUnder("app/mahar-generator"), ...filesUnder("components/mahar")]) {
      assert.doesNotMatch(readFileSync(p, "utf8"), /active-frame/, p);
    }
  });

  test("15. the solver does not know the active frame; Production spacing unchanged", () => {
    for (const p of filesUnder("lib/nesting").filter((x) => !x.endsWith(".test.ts"))) {
      assert.doesNotMatch(readFileSync(p, "utf8"), /active-frame/, p);
    }
    assert.deepEqual([PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, PART_GAP_MM], [2, 2, 2]);
  });
});
