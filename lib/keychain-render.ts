import { promises as fs } from "fs";
import path from "path";
import * as opentype from "opentype.js";
import { renderColoredGlyphs, type GlyphSegment } from "@/lib/font-preview";
import {
  translatePathData,
  scaleAndTranslatePathData,
  getPathBounds,
  findHoleCenterInside,
  type PathBounds,
} from "@/lib/laser-outline";
import { computeLaserOutlineClipper, unionOutlines } from "@/lib/clipper-outline";
import { parseCharacterSvg, type CharacterVector } from "@/lib/character-svg-server";
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
  /** Parsed cut-line + cleaned artwork from an SVG character upload, if any. */
  characterVector: CharacterVector | null;
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

/**
 * Candidate ring-hole centers within `bounds`, closest to the preferred
 * (nominal top-left) position first — used to find a spot that actually
 * lands on solid material for non-square/non-convex character silhouettes.
 */
function holeCandidates(
  preferred: { x: number; y: number },
  bounds: PathBounds,
  radius: number,
  step: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let y = bounds.y + radius; y <= bounds.y + bounds.height - radius; y += step) {
    for (let x = bounds.x + radius; x <= bounds.x + bounds.width - radius; x += step) {
      points.push({ x, y });
    }
  }
  points.sort((a, b) => {
    const da = (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2;
    const db = (b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2;
    return da - db;
  });
  return points;
}

function unionBounds(a: PathBounds, b: PathBounds): PathBounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
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
  let characterVector: CharacterVector | null = null;

  if (template.isCharacter && template.characterImagePath) {
    const imageBuffer = await readPublicFile(template.characterImagePath);
    const ext = path.extname(template.characterImagePath).toLowerCase();

    if (ext === ".svg") {
      characterVector = parseCharacterSvg(imageBuffer.toString("utf8"));
    }

    characterImageDataUri = characterVector
      ? characterVector.artworkDataUri
      : `data:${ext === ".svg" ? "image/svg+xml" : "image/png"};base64,${imageBuffer.toString("base64")}`;
  }

  return { font, characterImageDataUri, characterVector };
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

  const cutLines = template.isCharacter ? (assets.characterVector?.cutLinePaths ?? []) : [];
  const hasDesignerCutLine = cutLines.length > 0;

  // Reference shapes for the character's contribution to the outline, and as
  // a bounds fallback if outline computation fails entirely. Computed before
  // text placement so the text's X origin can be measured against the
  // character cut-line's *actual* silhouette instead of assuming it reaches
  // the nominal CHAR_BOX_MM edge (real artwork rarely does).
  const characterShapes: string[] = [];
  let positionedCutLines: string[] = [];
  let characterBounds: PathBounds | null = null;
  if (template.isCharacter) {
    if (hasDesignerCutLine) {
      const srcBounds = assets.characterVector!.bounds;
      const fitScale = Math.min(CHAR_BOX_MM / srcBounds.width, CHAR_BOX_MM / srcBounds.height);
      const cutTx = MARGIN_MM + (CHAR_BOX_MM - srcBounds.width * fitScale) / 2 - srcBounds.x * fitScale;
      const cutTy = MARGIN_MM + (CHAR_BOX_MM - srcBounds.height * fitScale) / 2 - srcBounds.y * fitScale;
      positionedCutLines = cutLines.map((d) => scaleAndTranslatePathData(d, fitScale, cutTx, cutTy));
      characterShapes.push(...positionedCutLines);
      for (const d of positionedCutLines) {
        const b = getPathBounds(d);
        if (b) characterBounds = characterBounds ? unionBounds(characterBounds, b) : b;
      }
    } else {
      characterShapes.push(rectPathData(MARGIN_MM, MARGIN_MM, CHAR_BOX_MM, CHAR_BOX_MM));
    }
  }

  let textTranslateX: number;
  let textTranslateY: number;

  if (template.isCharacter) {
    // When the designer's own cut-line is used as-is (not re-dilated), only
    // the text side gets pushed outward during the outline closing pass. If
    // positioned by a fixed nominal gap, the character's real silhouette
    // (which rarely reaches the full CHAR_BOX_MM edge) leaves a gap too wide
    // for dilation to close, splitting the laser cut into two disconnected
    // islands. Instead, measure the character cut-line's *actual* right
    // edge and push the text's raw (pre-dilation) bounding box to already
    // overlap it by a small safety margin — dilation only grows the text
    // shape further, so genuine overlap here guarantees Clipper's union
    // welds the two into one contour regardless of the character's shape.
    const OVERLAP_BUFFER_MM = 1.5;
    const nominalTextOriginX = MARGIN_MM + CHAR_BOX_MM + TEXT_GAP_MM;
    const textOriginX =
      hasDesignerCutLine && characterBounds
        ? Math.min(nominalTextOriginX, characterBounds.x + characterBounds.width - OVERLAP_BUFFER_MM)
        : nominalTextOriginX;
    const textOriginY = MARGIN_MM;
    textTranslateX = textOriginX - bbox.x1;
    textTranslateY = textOriginY + CHAR_BOX_MM / 2 - (bbox.y1 + bbox.y2) / 2;
  } else {
    textTranslateX = MARGIN_MM - bbox.x1;
    textTranslateY = MARGIN_MM - bbox.y1;
  }

  const textSegments: GlyphSegment[] = segments.map((segment) => ({
    d: translatePathData(segment.d, textTranslateX, textTranslateY),
    color: segment.color,
  }));

  const shapesForOutline = [...characterShapes, ...textSegments.map((s) => s.d)];

  let outlinePath: string | null;
  if (hasDesignerCutLine) {
    // The designer's cut-line is already the final intended contour — dilate
    // only the text, then union the two as-is instead of re-dilating
    // (and thereby distorting) the character's own geometry.
    const textOutline = computeLaserOutlineClipper(textSegments.map((s) => s.d), {
      dilateMm: DILATE_MM,
      erodeMm: ERODE_MM,
    });
    outlinePath = unionOutlines(textOutline ? [textOutline, ...positionedCutLines] : positionedCutLines);
  } else {
    outlinePath = computeLaserOutlineClipper(shapesForOutline, { dilateMm: DILATE_MM, erodeMm: ERODE_MM });
  }

  // The ring hole normally sits at a fixed offset from the item's top-left
  // corner, which is safe for the plain-square character box but can miss a
  // designer's non-square/non-convex silhouette entirely (a fixed corner
  // point may fall in a concavity — an armpit, a gap between limbs — that
  // isn't actually part of the cut shape). When a real cut-line is in play,
  // search nearby candidates for one that's genuinely inside the welded
  // outline, preferring the position closest to the nominal corner spot.
  const nominalHoleCenter = { x: MARGIN_MM + RING_HOLE_OFFSET_MM, y: MARGIN_MM + RING_HOLE_OFFSET_MM };
  let holeCenter = nominalHoleCenter;
  if (hasDesignerCutLine && outlinePath && characterBounds) {
    const searchBounds = unionBounds(characterBounds, {
      x: nominalHoleCenter.x - RING_HOLE_DIAMETER_MM,
      y: nominalHoleCenter.y - RING_HOLE_DIAMETER_MM,
      width: RING_HOLE_DIAMETER_MM * 2,
      height: RING_HOLE_DIAMETER_MM * 2,
    });
    const found = findHoleCenterInside(
      outlinePath,
      holeCandidates(nominalHoleCenter, searchBounds, RING_HOLE_DIAMETER_MM / 2, 0.75),
      RING_HOLE_DIAMETER_MM / 2
    );
    if (found) holeCenter = found;
  }

  const holePath = circlePathData(holeCenter.x, holeCenter.y, RING_HOLE_DIAMETER_MM / 2);

  const fallbackWidth = template.isCharacter
    ? MARGIN_MM + CHAR_BOX_MM + TEXT_GAP_MM + Math.max(bbox.x2 - bbox.x1, 1) + MARGIN_MM
    : Math.max(bbox.x2 - bbox.x1, 1) + MARGIN_MM * 2;
  const fallbackHeight = template.isCharacter
    ? CHAR_BOX_MM + MARGIN_MM * 2
    : Math.max(bbox.y2 - bbox.y1, 1) + MARGIN_MM * 2;

  let bounds =
    getPathBounds(outlinePath ?? shapesForOutline[0]) ?? {
      x: 0,
      y: 0,
      width: fallbackWidth,
      height: fallbackHeight,
    };

  if (hasDesignerCutLine) {
    // The artwork image always renders at the full nominal CHAR_BOX_MM
    // square (that's the reserved layout slot), but a designer's cut-line
    // shape — a circle, a blob, anything non-square — won't necessarily
    // reach every edge of that square. Widen the footprint to guarantee it
    // always covers the artwork's reserved space, even though that square
    // isn't part of the actual red cutting line.
    const nominalCharBoxBounds = getPathBounds(rectPathData(MARGIN_MM, MARGIN_MM, CHAR_BOX_MM, CHAR_BOX_MM));
    if (nominalCharBoxBounds) {
      bounds = unionBounds(bounds, nominalCharBoxBounds);
    }
  }

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
