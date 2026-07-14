import { promises as fs } from "fs";
import path from "path";
import * as opentype from "opentype.js";
import { renderColoredGlyphs, type GlyphSegment } from "@/lib/font-preview";
import { translatePathData, getPathBounds, type PathBounds } from "@/lib/laser-outline";
import { computeLaserOutlineClipper } from "@/lib/clipper-outline";
import type { Template } from "@/lib/db/schema";
import {
  CHAR_BOX_MM,
  TEXT_GAP_MM,
  MARGIN_MM,
  FONT_SIZE_CHAR_MM,
  FONT_SIZE_STANDARD_MM,
  RING_HOLE_OFFSET_MM,
  RING_HOLE_DIAMETER_MM,
  DILATE_MM,
  ERODE_MM,
} from "@/lib/keychain-geometry";

export interface TemplateAssets {
  font: opentype.Font;
  characterImageDataUri: string | null;
}

export interface KeychainRender {
  width: number;
  height: number;
  /** Red laser cutting line for the outer silhouette. */
  outlinePath: string | null;
  /** Red laser cutting line for the keyring hole. */
  holePath: string | null;
  textSegments: GlyphSegment[];
  characterImage: { dataUri: string; x: number; y: number; size: number } | null;
}

function rectPathData(x: number, y: number, width: number, height: number): string {
  return `M ${x},${y} H ${x + width} V ${y + height} H ${x} Z`;
}

function circlePathData(cx: number, cy: number, r: number): string {
  return `M ${cx - r},${cy} A ${r},${r} 0 1,0 ${cx + r},${cy} A ${r},${r} 0 1,0 ${cx - r},${cy} Z`;
}

function normalizePath(d: string, bounds: PathBounds): string {
  return translatePathData(d, -bounds.x, -bounds.y);
}

async function readPublicFile(publicPath: string): Promise<Buffer> {
  return fs.readFile(path.join(process.cwd(), "public", publicPath));
}

export async function loadTemplateAssets(template: Template): Promise<TemplateAssets> {
  const fontBuffer = await readPublicFile(template.filePath);
  const font = opentype.parse(
    fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength)
  );

  let characterImageDataUri: string | null = null;
  if (template.isCharacter && template.characterImagePath) {
    const imageBuffer = await readPublicFile(template.characterImagePath);
    const ext = path.extname(template.characterImagePath).toLowerCase();
    const mimeType = ext === ".svg" ? "image/svg+xml" : "image/png";
    characterImageDataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  }

  return { font, characterImageDataUri };
}

/**
 * Computes the combined character+text (or text-only) cutting outline for one
 * nested unit, dimensioned in mm and normalized to a (0, 0) origin so the
 * result can be placed directly at a packer-assigned (pos_x, pos_y).
 */
export function renderKeychainText(
  assets: TemplateAssets,
  template: Template,
  text: string
): KeychainRender {
  const sampleText = text.trim() || template.defaultText || "Nama";

  const fontSize = template.isCharacter ? FONT_SIZE_CHAR_MM : FONT_SIZE_STANDARD_MM;
  const { segments, bbox } = renderColoredGlyphs(assets.font, sampleText, fontSize, template.colors);

  const shapesForOutline: string[] = [];
  let textTranslateX: number;
  let textTranslateY: number;

  if (template.isCharacter) {
    const textOriginX = MARGIN_MM + CHAR_BOX_MM + TEXT_GAP_MM;
    const textOriginY = MARGIN_MM;
    textTranslateX = textOriginX - bbox.x1;
    textTranslateY = textOriginY + CHAR_BOX_MM / 2 - (bbox.y1 + bbox.y2) / 2;
    shapesForOutline.push(rectPathData(MARGIN_MM, MARGIN_MM, CHAR_BOX_MM, CHAR_BOX_MM));
  } else {
    textTranslateX = MARGIN_MM - bbox.x1;
    textTranslateY = MARGIN_MM - bbox.y1;
  }

  const textSegments: GlyphSegment[] = segments.map((segment) => ({
    d: translatePathData(segment.d, textTranslateX, textTranslateY),
    color: segment.color,
  }));
  shapesForOutline.push(...textSegments.map((s) => s.d));

  const holePath = circlePathData(MARGIN_MM + RING_HOLE_OFFSET_MM, MARGIN_MM + RING_HOLE_OFFSET_MM, RING_HOLE_DIAMETER_MM / 2);
  const outlinePath = computeLaserOutlineClipper(shapesForOutline, { dilateMm: DILATE_MM, erodeMm: ERODE_MM });

  const fallbackWidth = template.isCharacter
    ? MARGIN_MM + CHAR_BOX_MM + TEXT_GAP_MM + Math.max(bbox.x2 - bbox.x1, 1) + MARGIN_MM
    : Math.max(bbox.x2 - bbox.x1, 1) + MARGIN_MM * 2;
  const fallbackHeight = template.isCharacter
    ? CHAR_BOX_MM + MARGIN_MM * 2
    : Math.max(bbox.y2 - bbox.y1, 1) + MARGIN_MM * 2;

  const bounds =
    getPathBounds(outlinePath ?? shapesForOutline[0]) ?? {
      x: 0,
      y: 0,
      width: fallbackWidth,
      height: fallbackHeight,
    };

  return {
    width: bounds.width,
    height: bounds.height,
    outlinePath: outlinePath ? normalizePath(outlinePath, bounds) : null,
    holePath: normalizePath(holePath, bounds),
    textSegments: textSegments.map((segment) => ({
      ...segment,
      d: normalizePath(segment.d, bounds),
    })),
    characterImage: assets.characterImageDataUri
      ? {
          dataUri: assets.characterImageDataUri,
          x: MARGIN_MM - bounds.x,
          y: MARGIN_MM - bounds.y,
          size: CHAR_BOX_MM,
        }
      : null,
  };
}
