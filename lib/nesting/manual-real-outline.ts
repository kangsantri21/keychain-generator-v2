/**
 * Cut lines for the manual-sheet names, through the same contour the app
 * uses: finished text height 20 mm, character height 26 mm, offset 2.5 mm,
 * notch closing 2 mm. The shop's own font file is not in the repo. Noto
 * Sans Display Bold is the installed display face used in its place.
 */
import { readFileSync } from "node:fs";
import * as opentypeNs from "opentype.js";
import { computeProductionOutline } from "@/lib/clipper-outline";
import { renderColoredGlyphsAtHeight } from "@/lib/font-preview";
import {
  DEFAULT_CHAR_TARGET_HEIGHT_MM,
  DEFAULT_TEXT_TARGET_HEIGHT_MM,
  MAX_ITEM_WIDTH_MM,
  OUTLINE_GROWTH_MM,
} from "@/lib/keychain-geometry";
import { circlePathData, getPathBounds, translatePathData, squeezeHorizontalPathData } from "@/lib/laser-outline";
import type { ManualPiece } from "@/lib/nesting/manual-sheet-pieces";
import type { ShapeBlockItem } from "@/lib/nesting/shape-block-nesting";
import { polygonsFromOutlinePath, type Pt } from "@/lib/nesting/shape-outline";

const opentype = ((opentypeNs as unknown as { default?: typeof opentypeNs }).default ?? opentypeNs) as typeof opentypeNs;

export const MANUAL_FONT_PATH = "/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf";

const TEXT_RAW_MM = DEFAULT_TEXT_TARGET_HEIGHT_MM - OUTLINE_GROWTH_MM;
const CHAR_RAW_MM = DEFAULT_CHAR_TARGET_HEIGHT_MM - OUTLINE_GROWTH_MM;

export interface RealPiece {
  piece: ManualPiece;
  width: number;
  height: number;
  outlinePath: string;
  outline: Pt[][];
}

function roundRectPath(w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2);
  return `M ${radius} 0 H ${w - radius} A ${radius} ${radius} 0 0 1 ${w} ${radius} V ${h - radius} A ${radius} ${radius} 0 0 1 ${w - radius} ${h} H ${radius} A ${radius} ${radius} 0 0 1 0 ${h - radius} V ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`;
}

function textShapes(font: opentypeNs.Font, name: string, squeeze: number): string[] {
  const { segments, bbox } = renderColoredGlyphsAtHeight(font, name, TEXT_RAW_MM, ["#111111"]);
  return segments.map((segment) => {
    const moved = translatePathData(segment.d, -bbox.x1, -bbox.y1);
    return squeeze === 1 ? moved : squeezeHorizontalPathData(moved, squeeze, 0);
  });
}

function normalize(d: string): { d: string; width: number; height: number } {
  const bounds = getPathBounds(d);
  if (!bounds) return { d, width: 1, height: 1 };
  return {
    d: translatePathData(d, -bounds.x, -bounds.y),
    width: bounds.width,
    height: bounds.height,
  };
}

function renderText(font: opentypeNs.Font, name: string): { d: string; width: number; height: number } | null {
  const full = textShapes(font, name, 1);
  const first = computeProductionOutline(full);
  if (!first) return null;
  const box = normalize(first);
  if (box.width <= MAX_ITEM_WIDTH_MM + 0.2) return box;
  const squeeze = MAX_ITEM_WIDTH_MM / box.width;
  const narrow = textShapes(font, name, Math.max(0.45, squeeze));
  const again = computeProductionOutline(narrow);
  return again ? normalize(again) : box;
}

function renderCharacter(font: opentypeNs.Font, name: string): { d: string; width: number; height: number } | null {
  const diameter = CHAR_RAW_MM;
  const text = textShapes(font, name, 1);
  const textBounds = text.map((d) => getPathBounds(d)).filter((b): b is NonNullable<typeof b> => !!b);
  const textW = Math.max(...textBounds.map((b) => b.x + b.width), 1);
  const textH = Math.max(...textBounds.map((b) => b.y + b.height), 1);
  const gap = 1;
  const textY = Math.max(0, (diameter - textH) / 2);
  const shapes = [
    circlePathData(diameter / 2, diameter / 2, diameter / 2),
    ...text.map((d) => translatePathData(d, diameter + gap, textY)),
  ];
  const outline = computeProductionOutline(shapes);
  if (!outline) return null;
  const box = normalize(outline);
  if (box.width <= MAX_ITEM_WIDTH_MM + 0.2) return box;
  return renderText(font, name);
}

function renderCup(): { d: string; width: number; height: number } | null {
  // The name is printed on the cup, not a second cut. One rounded plate.
  const outline = computeProductionOutline([roundRectPath(36, 28, 10)]);
  return outline ? normalize(outline) : null;
}

function renderBadge(font: opentypeNs.Font, name: string): { d: string; width: number; height: number } | null {
  const text = renderText(font, name);
  if (!text) return null;
  const padX = 4;
  const padY = 2.5;
  const w = text.width + padX * 2;
  const h = Math.max(text.height + padY * 2, 12);
  const plate = computeProductionOutline([roundRectPath(w, h, 3)]);
  return plate ? normalize(plate) : text;
}

export function renderManualPieces(pieces: ManualPiece[], fontPath = MANUAL_FONT_PATH): RealPiece[] {
  const bytes = readFileSync(fontPath);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return pieces.map((piece) => {
    const box =
      piece.kind === "cup"
        ? renderCup()
        : piece.kind === "badge"
          ? renderBadge(font, piece.name)
          : piece.kind === "character"
            ? renderCharacter(font, piece.name)
            : renderText(font, piece.name);
    if (!box) throw new Error(`Garis potong gagal: ${piece.name}`);
    return {
      piece,
      width: box.width,
      height: box.height,
      outlinePath: box.d,
      outline: polygonsFromOutlinePath(box.d, box.width, box.height),
    };
  });
}

export function toRealShapeItems(rendered: RealPiece[]): ShapeBlockItem<{ name: string }>[] {
  return rendered.map((item, index) => ({
    id: index + 1,
    orderId: item.piece.orderId,
    width: item.width,
    height: item.height,
    allowRotation: true,
    outline: item.outline,
    receiptCode: item.piece.code,
    data: { name: item.piece.name },
  }));
}
