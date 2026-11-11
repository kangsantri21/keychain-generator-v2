/**
 * Cut lines for the names on Rofiq's manual sheet.
 *
 * Finished sizes he measured: a name-only keychain is 26 mm tall, and the
 * character in front of a name is 29 mm tall. The contour is the app's
 * 2.5 mm round offset. Coffee Soda (Khurasan, free for commercial use) is
 * the bubbly face; it is read from local-fonts/ and is not committed.
 * Glossy Sheen Shine is personal-use only, so it is not used.
 */
import { existsSync, readFileSync } from "node:fs";
import * as opentypeNs from "opentype.js";
import { computeProductionOutline } from "@/lib/clipper-outline";
import { renderColoredGlyphsAtHeight } from "@/lib/font-preview";
import { OUTLINE_GROWTH_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { getPathBounds, translatePathData, squeezeHorizontalPathData } from "@/lib/laser-outline";
import type { ManualPiece } from "@/lib/nesting/manual-sheet-pieces";
import type { ShapeBlockItem } from "@/lib/nesting/shape-block-nesting";
import { polygonsFromOutlinePath, type Pt } from "@/lib/nesting/shape-outline";

const opentype = ((opentypeNs as unknown as { default?: typeof opentypeNs }).default ?? opentypeNs) as typeof opentypeNs;

/** Finished cut height of a name-only keychain, mm. Rofiq: about 2.6 cm. */
export const NAME_FINISHED_MM = 26;
/** Finished height of the character bust in front of a name, mm. Rofiq: about 2.9 cm. */
export const CHARACTER_FINISHED_MM = 29;

const TEXT_RAW_MM = NAME_FINISHED_MM - OUTLINE_GROWTH_MM;
const BUST_RAW_MM = CHARACTER_FINISHED_MM - OUTLINE_GROWTH_MM;
const MAX_PIECE_MM = SHEET_WIDTH_MM - 40;

export function manualFontPath(): string {
  const fromEnv = process.env.MANUAL_FONT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = "local-fonts/CoffeeSoda.ttf";
  if (existsSync(local)) return local;
  return "/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf";
}

export const MANUAL_FONT_PATH = manualFontPath();

export interface RealPiece {
  piece: ManualPiece;
  width: number;
  height: number;
  outlinePath: string;
  outline: Pt[][];
}

/**
 * Chibi head and shoulders, about as wide as it is tall. The crown is the
 * top, the shoulders the bottom. Scaled so the raw height is `h` mm.
 */
function bustPath(targetHeight: number): string {
  // The control points span 22.8 mm when s = 1. Scale so the raw bust is exactly targetHeight.
  const s = targetHeight / 22.8;
  const p = (x: number, y: number) => `${(x * s).toFixed(2)} ${(y * s).toFixed(2)}`;
  return `M ${p(11, 0.6)} C ${p(4.2, 0.8)} ${p(1.4, 5.2)} ${p(1.6, 10)} C ${p(1.7, 13.6)} ${p(3.6, 15.6)} ${p(6.2, 16.6)} C ${p(3.2, 17.6)} ${p(0.8, 20)} ${p(0.6, 23.4)} L ${p(21.4, 23.4)} C ${p(21.2, 20)} ${p(18.8, 17.6)} ${p(15.8, 16.6)} C ${p(18.4, 15.6)} ${p(20.3, 13.6)} ${p(20.4, 10)} C ${p(20.6, 5.2)} ${p(17.8, 0.8)} ${p(11, 0.6)} Z`;
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
  if (box.width <= MAX_PIECE_MM) return box;
  const squeeze = MAX_PIECE_MM / box.width;
  const narrow = textShapes(font, name, Math.max(0.45, squeeze));
  const again = computeProductionOutline(narrow);
  return again ? normalize(again) : box;
}

function renderWithBust(font: opentypeNs.Font, name: string): { d: string; width: number; height: number } | null {
  const text = textShapes(font, name, 1);
  const textBounds = text.map((d) => getPathBounds(d)).filter((b): b is NonNullable<typeof b> => !!b);
  const textH = Math.max(...textBounds.map((b) => b.height), 1);
  const bust = bustPath(BUST_RAW_MM);
  const bustBounds = getPathBounds(bust);
  const bustW = bustBounds?.width ?? BUST_RAW_MM;
  // The bust is taller. The name sits on the same baseline band, touching the shoulder.
  const textY = Math.max(0, (BUST_RAW_MM - textH) / 2);
  const shapes = [bust, ...text.map((d) => translatePathData(d, bustW - 0.4, textY))];
  const outline = computeProductionOutline(shapes);
  if (!outline) return null;
  const box = normalize(outline);
  if (box.width <= MAX_PIECE_MM) return box;
  return renderText(font, name);
}

export function renderManualPieces(pieces: ManualPiece[], fontPath = manualFontPath()): RealPiece[] {
  const bytes = readFileSync(fontPath);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return pieces.map((piece) => {
    const box = piece.kind === "text" || piece.kind === "badge" ? renderText(font, piece.name) : renderWithBust(font, piece.name);
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
