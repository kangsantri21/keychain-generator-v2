/**
 * Contour clearance, letter-gap closing, and smooth hole/curve export.
 * `npm test` (this file is included next to lib/nesting/*.test.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import paper from "paper";
import * as opentypeNs from "opentype.js";
import { computeLaserOutlineClipper, computeProductionOutline } from "@/lib/clipper-outline";
import { buildSheetDxfDocument } from "@/lib/export-dxf";
import { GAP_CLOSE_MM, OUTLINE_OFFSET_MM, RING_HOLE_DIAMETER_MM } from "@/lib/keychain-geometry";
import {
  circleFromPathData,
  circlePathData,
  flattenPathToPolygons,
  translatePathData,
  type FlatPoint,
} from "@/lib/laser-outline";
import type { StagingSheet } from "@/lib/staging-types";

paper.setup(new paper.Size(10, 10));

const opentype = ((opentypeNs as unknown as { default?: typeof opentypeNs }).default ?? opentypeNs) as typeof opentypeNs;
const fontBytes = fs.readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
const font = opentype.parse(fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength));

function rect(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
}

function subpaths(d: string | null): number {
  return d ? (d.match(/M /g) ?? []).length : 0;
}

function polygons(d: string): FlatPoint[][] {
  return flattenPathToPolygons(d, 0.005);
}

function pointsOf(d: string): FlatPoint[] {
  return polygons(d).flat();
}

function boundsOf(points: FlatPoint[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function distToPolygons(p: FlatPoint, polys: FlatPoint[][]): number {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + t * dx;
      const qy = a.y + t * dy;
      best = Math.min(best, Math.hypot(p.x - qx, p.y - qy));
    }
  }
  return best;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
}

/** Glyph outlines at a raw height, without OpenType layout (DejaVu's GSUB trips opentype.js). */
function glyphPaths(text: string, targetHeight: number): string[] {
  const size = 100;
  let x = 0;
  const paths = [];
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    paths.push(glyph.getPath(x, 0, size));
    x += glyph.advanceWidth ? (glyph.advanceWidth * size) / font.unitsPerEm : size * 0.5;
  }
  const boxes = paths.map((p) => p.getBoundingBox());
  const y1 = Math.min(...boxes.map((b) => b.y1));
  const y2 = Math.max(...boxes.map((b) => b.y2));
  const scale = targetHeight / (y2 - y1 || 1);
  return paths.map((p) => {
    const item = paper.PathItem.create(p.toPathData(2));
    item.scale(scale, new paper.Point(0, 0));
    const d = item.pathData;
    item.remove();
    return d;
  });
}

function outlineOf(text: string, rawHeight = 19.5) {
  const shapes = glyphPaths(text, rawHeight);
  const outline = computeProductionOutline(shapes);
  assert.ok(outline, text);
  return { shapes, outline };
}

describe("production contour", () => {
  test("a straight edge is offset by about 0.25 mm, and the corner stays a short arc", () => {
    const outline = computeProductionOutline([rect(0, 0, 30, 12)]);
    assert.ok(outline);
    const b = boundsOf(pointsOf(outline));
    assert.ok(Math.abs(-b.minX - OUTLINE_OFFSET_MM) < 0.03, `left ${-b.minX}`);
    assert.ok(Math.abs(b.maxX - 30 - OUTLINE_OFFSET_MM) < 0.03, `right ${b.maxX - 30}`);
    assert.ok(Math.abs(-b.minY - OUTLINE_OFFSET_MM) < 0.03, `top ${-b.minY}`);
    assert.ok(Math.abs(b.maxY - 12 - OUTLINE_OFFSET_MM) < 0.03, `bottom ${b.maxY - 12}`);
    const n = pointsOf(outline).length;
    assert.ok(n > 8 && n < 80, `rectangle point count ${n} should stay small`);
  });

  test("offset and gap threshold are configurable, and the defaults match the decision", () => {
    assert.equal(OUTLINE_OFFSET_MM, 0.25);
    assert.equal(GAP_CLOSE_MM, 6);

    const wide = computeProductionOutline([rect(0, 0, 20, 10)], { offset: 1, gapClose: 0 });
    assert.ok(wide);
    const b = boundsOf(pointsOf(wide));
    assert.ok(Math.abs(-b.minX - 1) < 0.03);

    const closed = computeProductionOutline([rect(0, 0, 10, 16), rect(14, 0, 10, 16)], { gapClose: 5, offset: 0 });
    const open = computeProductionOutline([rect(0, 0, 10, 16), rect(14, 0, 10, 16)], { gapClose: 3, offset: 0 });
    assert.equal(subpaths(closed), 1, "a 4 mm gap closes when the threshold is 5 mm");
    assert.equal(subpaths(open), 2, "the same 4 mm gap stays open when the threshold is 3 mm");
  });

  test("default closing bridges letter gaps up to 6 mm and leaves a wider gap open", () => {
    const near = computeProductionOutline([rect(0, 0, 10, 16), rect(14.9, 0, 10, 16)], { offset: 0 });
    const far = computeProductionOutline([rect(0, 0, 10, 16), rect(16.5, 0, 10, 16)], { offset: 0 });
    assert.equal(subpaths(near), 1, "4.9 mm gap closes");
    assert.equal(subpaths(far), 2, "6.5 mm gap stays open");
  });

  test("the old dilate-4/erode-1.5 pass still measures about 2.5 mm outside the shape", () => {
    const outline = computeLaserOutlineClipper([rect(0, 0, 30, 12)], {
      dilateMm: 4,
      erodeMm: 1.5,
      curveTolerance: 0.05,
      arcTolerance: 0.00025,
    });
    assert.ok(outline);
    const b = boundsOf(pointsOf(outline));
    assert.ok(Math.abs(-b.minX - 2.5) < 0.05);
    assert.ok(Math.abs(b.maxY - 12 - 2.5) < 0.05);
  });

  test("a ring's inner hole is not a second cut line", () => {
    const outer = circlePathData(0, 0, 8);
    const inner = circlePathData(0, 0, 3);
    const outline = computeProductionOutline([outer, inner], { gapClose: 0, offset: 0.25 });
    assert.equal(subpaths(outline), 1);
    const radii = pointsOf(outline!).map((p) => Math.hypot(p.x, p.y));
    assert.ok(Math.min(...radii) > 7, "the inner circle was dropped");
  });
});

describe("sample names", () => {
  const RAW_HEIGHT = 20 - OUTLINE_OFFSET_MM * 2;

  test("five names: offset near 0.25 mm, small letter gaps closed, word space open, file stays modest", () => {
    const joined = ["O", "BOBO", "Ali", "Siti", "Qonita"];
    for (const name of joined) {
      const { shapes, outline } = outlineOf(name, RAW_HEIGHT);
      assert.equal(subpaths(outline), 1, `${name} should be one piece`);
      const src = shapes.flatMap((d) => polygons(d));
      const distances = pointsOf(outline).map((p) => distToPolygons(p, src));
      const mid = median(distances);
      assert.ok(mid > 0.18 && mid < 0.45, `${name} median offset ${mid}`);
      assert.ok(pointsOf(outline).length < 4000, `${name} point count ${pointsOf(outline).length}`);
    }

    const long = outlineOf("Muhammad Al-Fatih", RAW_HEIGHT);
    assert.equal(subpaths(long.outline), 2, "the word space stays open; each word is one piece");
    const src = long.shapes.flatMap((d) => polygons(d));
    const mid = median(pointsOf(long.outline).map((p) => distToPolygons(p, src)));
    assert.ok(mid > 0.18 && mid < 0.45, `long name median offset ${mid}`);
    assert.ok(pointsOf(long.outline).length < 12000, `long name points ${pointsOf(long.outline).length}`);

    const round = outlineOf("O", RAW_HEIGHT);
    const srcB = boundsOf(round.shapes.flatMap((d) => pointsOf(d)));
    const outB = boundsOf(pointsOf(round.outline));
    const grow = (outB.height - srcB.height) / 2;
    assert.ok(Math.abs(grow - OUTLINE_OFFSET_MM) < 0.08, `O height growth ${grow}`);
  });
});

describe("smooth curves and the ring hole", () => {
  test("an offset circle stays within 0.02 mm of a true circle and does not explode", () => {
    const outline = computeProductionOutline([circlePathData(0, 0, 10)], { gapClose: 0, offset: 0.25 });
    assert.ok(outline);
    const pts = pointsOf(outline);
    assert.ok(pts.length > 40 && pts.length < 250, `circle points ${pts.length}`);
    let worst = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      worst = Math.max(worst, Math.abs(Math.hypot(a.x, a.y) - 10.25));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      worst = Math.max(worst, Math.abs(Math.hypot(mx, my) - 10.25));
    }
    assert.ok(worst < 0.02, `radial error ${worst}`);
  });

  test("flattening the 1.9 mm hole at the old 0.05 mm tolerance is about 16 sides", () => {
    const pts = flattenPathToPolygons(circlePathData(0, 0, RING_HOLE_DIAMETER_MM / 2), 0.05).flat();
    assert.ok(pts.length >= 14 && pts.length <= 18, `old hole sides ${pts.length}`);
  });

  test("the ring hole is recovered as a circle after paper.js rewrites the arcs", () => {
    const rewritten = translatePathData(circlePathData(4, 6, 0.95), 1.2, -0.4);
    const circle = circleFromPathData(rewritten);
    assert.ok(circle);
    assert.ok(Math.abs(circle.x - 5.2) < 0.03, `cx ${circle.x}`);
    assert.ok(Math.abs(circle.y - 5.6) < 0.03, `cy ${circle.y}`);
    assert.ok(Math.abs(circle.r - 0.95) < 0.03, `r ${circle.r}`);
  });

  test("DXF exports the ring hole as a CIRCLE, including after a 90 degree rotation", () => {
    const hole = translatePathData(circlePathData(5, 8, RING_HOLE_DIAMETER_MM / 2), 0, 0);
    const sheet = (rotated: boolean): StagingSheet => ({
      sheetId: 1,
      items: [
        {
          id: 1,
          orderId: 1,
          templateId: 1,
          customerName: "O",
          sheetId: 1,
          posX: 40,
          posY: 50,
          width: 30,
          height: 20,
          rotated,
          status: "staged",
          order: { id: 1, receiptCode: "R", manualCode: "" },
          template: null,
          render: {
            width: rotated ? 20 : 30,
            height: rotated ? 30 : 20,
            outlinePath: rect(0, 0, 30, 20),
            holePath: hole,
            textSegments: [],
            characterImage: null,
          },
        },
      ],
    });

    const circles = (dxf: string) =>
      dxf
        .split("\n0\n")
        .filter((entity) => entity.startsWith("CIRCLE") && entity.includes("\nCUT_HOLE\n"))
        .map((entity) => {
          const lines = entity.split("\n");
          return {
            x: Number(lines[lines.indexOf("10") + 1]),
            y: Number(lines[lines.indexOf("20") + 1]),
            r: Number(lines[lines.indexOf("40") + 1]),
          };
        });

    const flat = buildSheetDxfDocument(sheet(false));
    const flatHoles = circles(flat);
    assert.equal(flatHoles.length, 1);
    assert.ok(Math.abs(flatHoles[0].x - 45) < 0.02);
    assert.ok(Math.abs(flatHoles[0].y - (470 - 58)) < 0.02);
    assert.ok(Math.abs(flatHoles[0].r - 0.95) < 0.02);
    assert.equal(flat.split("\n0\n").filter((e) => e.startsWith("LWPOLYLINE") && e.includes("\nCUT_HOLE\n")).length, 0);

    const turned = circles(buildSheetDxfDocument(sheet(true)));
    assert.equal(turned.length, 1);
    // rotate(90) maps (x, y) -> (-y, x), then the item translate.
    assert.ok(Math.abs(turned[0].x - (-8 + 40 + 30)) < 0.02, `rotated x ${turned[0].x}`);
    assert.ok(Math.abs(turned[0].y - (470 - (5 + 50))) < 0.02, `rotated y ${turned[0].y}`);
    assert.ok(Math.abs(turned[0].r - 0.95) < 0.02);
  });
});
