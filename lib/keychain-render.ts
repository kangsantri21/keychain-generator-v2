import { promises as fs } from "fs";
import path from "path";
import * as opentype from "opentype.js";
import { renderColoredGlyphsAtHeight, type GlyphSegment } from "@/lib/font-preview";
import {
  translatePathData,
  scaleAndTranslatePathData,
  squeezeHorizontalPathData,
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
  RING_HOLE_OFFSET_MM,
  RING_HOLE_DIAMETER_MM,
  DILATE_MM,
  ERODE_MM,
  WELD_CLEARANCE_MM,
  TEXT_RAW_HEIGHT_MM,
  SEAM_CLOSE_MM,
  MAX_ITEM_WIDTH_MM,
  MIN_TEXT_CUT_HEIGHT_MM,
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
 *
 * `uniformScale` and `textSqueezeX` implement the MAX_ITEM_WIDTH_MM
 * constraint (see the exported `renderKeychainText` wrapper below) and
 * default to 1 (no change) for a normal, unconstrained render:
 * - `uniformScale` shrinks the whole layout (character box, gap, text
 *   height, hole position) together, uniformly — safe because it preserves
 *   every spatial relationship exactly, including character-image-to-
 *   cut-line alignment.
 * - `textSqueezeX` additionally condenses ONLY the text's horizontal
 *   letter-spacing (anchored where the text meets the character, so it
 *   never drifts away from it) — used only once `uniformScale` has already
 *   been driven down to MIN_TEXT_CUT_HEIGHT_MM and the item is still too
 *   wide. It must never apply to the character artwork/cut-line: doing so
 *   would desync the character's raster image (which keeps its own aspect
 *   ratio via `preserveAspectRatio="xMidYMid meet"`) from its outline —
 *   exactly the image-vs-outline mismatch previously diagnosed in the
 *   Miko/Aldo cut-line bug.
 *
 * Kept fixed regardless of scale (physical/hardware constants, not design
 * proportions): DILATE_MM/ERODE_MM/SEAM_CLOSE_MM (laser kerf & seam-closing
 * are properties of the cutting process, not the drawn size) and
 * RING_HOLE_DIAMETER_MM (the keyring hole is a fixed hardware-fit spec).
 */
function renderKeychainTextScaled(
  assets: TemplateAssets,
  template: Template,
  text: string,
  uniformScale: number,
  textSqueezeX: number
): KeychainRender {
  const sampleText = text.trim() || template.defaultText || "Nama";

  const charBoxMm = CHAR_BOX_MM * uniformScale;
  const marginMm = MARGIN_MM * uniformScale;
  const textGapMm = TEXT_GAP_MM * uniformScale;
  const weldClearanceMm = WELD_CLEARANCE_MM * uniformScale;
  const textRawHeightMm = TEXT_RAW_HEIGHT_MM * uniformScale;
  const ringHoleOffsetMm = RING_HOLE_OFFSET_MM * uniformScale;
  const holeOffsetX = template.holeOffsetX * uniformScale;
  const holeOffsetY = template.holeOffsetY * uniformScale;

  // Every name text is locked to a fixed *finished* cutting height
  // (TEXT_CUT_HEIGHT_MM, via TEXT_RAW_HEIGHT_MM before the dilate pass) — a
  // production spec, not a mere visual size — so it's rescaled per render to
  // hit that target exactly regardless of font metrics. This applies
  // identically to character and text-only (non-character) templates alike,
  // so both render at the same physical text height when nested side by
  // side; a plain fixed fontSize (as text-only templates used previously)
  // can't guarantee that, since a font's own em-to-glyph-height ratio varies
  // per font.
  const { segments, bbox } = renderColoredGlyphsAtHeight(assets.font, sampleText, textRawHeightMm, template.colors);

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
      const fitScale = Math.min(charBoxMm / srcBounds.width, charBoxMm / srcBounds.height);
      const cutTx = marginMm + (charBoxMm - srcBounds.width * fitScale) / 2 - srcBounds.x * fitScale;
      const cutTy = marginMm + (charBoxMm - srcBounds.height * fitScale) / 2 - srcBounds.y * fitScale;
      positionedCutLines = cutLines.map((d) => scaleAndTranslatePathData(d, fitScale, cutTx, cutTy));
      characterShapes.push(...positionedCutLines);
      for (const d of positionedCutLines) {
        const b = getPathBounds(d);
        if (b) characterBounds = characterBounds ? unionBounds(characterBounds, b) : b;
      }
    } else {
      characterShapes.push(rectPathData(marginMm, marginMm, charBoxMm, charBoxMm));
    }
  }

  let textTranslateX: number;
  let textTranslateY: number;
  // X to anchor the horizontal letter-spacing squeeze around, so condensing
  // long names never pulls the text away from the character (or, for
  // text-only templates, away from its left margin).
  let textAnchorX: number;

  if (template.isCharacter) {
    // Position the text just clear of the character's *actual* cut-line
    // silhouette (not the nominal CHAR_BOX_MM square, which real artwork
    // rarely fills) — a small positive WELD_CLEARANCE_MM gap keeps the raw
    // glyphs from ever visually overlapping the character artwork, while
    // staying under the text's net dilation growth (DILATE_MM - ERODE_MM)
    // so the *dilated* cutting outline still reaches the character and
    // Clipper welds the two into one contour.
    const nominalTextOriginX = marginMm + charBoxMm + textGapMm;
    const textOriginX =
      hasDesignerCutLine && characterBounds
        ? characterBounds.x + characterBounds.width + weldClearanceMm
        : nominalTextOriginX;
    textTranslateX = textOriginX - bbox.x1;
    textAnchorX = textOriginX;
    // Center vertically against the character's *actual* silhouette height
    // when one is known, not the nominal box — an off-center cut-line would
    // otherwise leave the text looking misaligned next to the artwork.
    const charCenterY =
      hasDesignerCutLine && characterBounds
        ? characterBounds.y + characterBounds.height / 2
        : marginMm + charBoxMm / 2;
    textTranslateY = charCenterY - (bbox.y1 + bbox.y2) / 2;
  } else {
    textTranslateX = marginMm - bbox.x1;
    textTranslateY = marginMm - bbox.y1;
    textAnchorX = marginMm;
  }

  const textSegments: GlyphSegment[] = segments.map((segment) => {
    const translated = translatePathData(segment.d, textTranslateX, textTranslateY);
    const d = textSqueezeX === 1 ? translated : squeezeHorizontalPathData(translated, textSqueezeX, textAnchorX);
    return { d, color: segment.color };
  });

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
    const welded = unionOutlines(textOutline ? [textOutline, ...positionedCutLines] : positionedCutLines);
    // A plain union of two shapes that only just touch leaves a sharp,
    // narrow concave notch right at the seam — a fragile neck once laser-cut
    // from acrylic, even though it's already topologically one piece. An
    // extra closing pass (equal dilate/erode) fills that notch into a
    // smooth, rounded bridge without changing the overall outer size.
    outlinePath = welded
      ? (computeLaserOutlineClipper([welded], { dilateMm: SEAM_CLOSE_MM, erodeMm: SEAM_CLOSE_MM }) ?? welded)
      : null;
  } else {
    outlinePath = computeLaserOutlineClipper(shapesForOutline, { dilateMm: DILATE_MM, erodeMm: ERODE_MM });
  }

  // The ring hole normally sits at a fixed offset from the item's top-left
  // corner, which is safe for the plain-square character box but can miss a
  // designer's non-square/non-convex silhouette entirely (a fixed corner
  // point may fall in a concavity — an armpit, a gap between limbs — that
  // isn't actually part of the cut shape). A manual per-template nudge (mm)
  // shifts the preferred spot first — e.g. pulling it inward from an edge
  // that's prone to snapping off — then the search below still guarantees
  // whatever we land on is genuinely inside the welded outline. Note the
  // hole's DIAMETER is intentionally NOT scaled by uniformScale — it's a
  // fixed hardware-fit spec (the physical keyring must pass through it),
  // not a design proportion that should shrink with a long name.
  const nominalHoleCenter = {
    x: marginMm + ringHoleOffsetMm + holeOffsetX,
    y: marginMm + ringHoleOffsetMm + holeOffsetY,
  };
  let holeCenter = nominalHoleCenter;
  if (template.isCharacter && outlinePath) {
    const baseBounds = characterBounds ?? { x: marginMm, y: marginMm, width: charBoxMm, height: charBoxMm };
    const searchBounds = unionBounds(baseBounds, {
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
    ? marginMm + charBoxMm + textGapMm + Math.max(bbox.x2 - bbox.x1, 1) + marginMm
    : Math.max(bbox.x2 - bbox.x1, 1) + marginMm * 2;
  const fallbackHeight = template.isCharacter
    ? charBoxMm + marginMm * 2
    : Math.max(bbox.y2 - bbox.y1, 1) + marginMm * 2;

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
    const nominalCharBoxBounds = getPathBounds(rectPathData(marginMm, marginMm, charBoxMm, charBoxMm));
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
          x: marginMm - bounds.x,
          y: marginMm - bounds.y,
          size: charBoxMm,
        }
      : null,
  };
}

/** Converge-loop tolerance and iteration cap for `renderKeychainText` below. */
const WIDTH_CONSTRAINT_TOLERANCE_MM = 0.05;
const WIDTH_CONSTRAINT_MAX_ITERATIONS = 6;

/**
 * Public entry point: renders at natural size first, then — only if the
 * result would exceed MAX_ITEM_WIDTH_MM (a long name stretching the item
 * arbitrarily wide, wasting acrylic in nesting) — re-renders with a width
 * constraint applied:
 *
 * 1. Uniformly shrink the whole item (character + text + outline together)
 *    just enough to fit MAX_ITEM_WIDTH_MM, as long as that keeps the text's
 *    finished cut height at or above MIN_TEXT_CUT_HEIGHT_MM (the low end of
 *    the locked 25-27mm production spec).
 * 2. If hitting that height floor still leaves the item too wide (very long
 *    names), lock the uniform shrink at exactly the floor height, then
 *    absorb the remaining excess width by condensing the text's horizontal
 *    letter-spacing only — the character artwork and its cut-line are never
 *    non-uniformly distorted, which would desync the raster image from its
 *    outline (see `renderKeychainTextScaled`'s docs).
 *
 * The fixed-mm dilate/erode "closing" pass (kept constant regardless of
 * scale, for the same physical reason RING_HOLE_DIAMETER_MM is) adds a
 * roughly constant absolute amount to the finished width no matter how much
 * the glyphs are squeezed, so a single closed-form (uniformScale,
 * textSqueezeX) solve can slightly overshoot MAX_ITEM_WIDTH_MM for very long
 * names. Each loop iteration below recomputes the needed correction from the
 * *actual* previous render's measured width/height rather than assuming a
 * purely linear relationship, so it converges onto the real target width
 * regardless of that nonlinearity.
 */
export function renderKeychainText(
  assets: TemplateAssets,
  template: Template,
  text: string
): KeychainRender {
  let uniformScale = 1;
  let textSqueezeX = 1;
  let render = renderKeychainTextScaled(assets, template, text, uniformScale, textSqueezeX);

  for (
    let i = 0;
    i < WIDTH_CONSTRAINT_MAX_ITERATIONS && render.width > MAX_ITEM_WIDTH_MM + WIDTH_CONSTRAINT_TOLERANCE_MM;
    i++
  ) {
    const scaleNeeded = MAX_ITEM_WIDTH_MM / render.width;
    if (render.height * scaleNeeded >= MIN_TEXT_CUT_HEIGHT_MM) {
      uniformScale *= scaleNeeded;
    } else {
      const heightScaleNeeded = MIN_TEXT_CUT_HEIGHT_MM / render.height;
      uniformScale *= heightScaleNeeded;
      const widthAfterHeightLock = render.width * heightScaleNeeded;
      textSqueezeX *= MAX_ITEM_WIDTH_MM / widthAfterHeightLock;
    }
    render = renderKeychainTextScaled(assets, template, text, uniformScale, textSqueezeX);
  }

  return render;
}
