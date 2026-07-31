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
import type { KeychainRender } from "@/lib/render-types";
import {
  TEXT_GAP_MM,
  MARGIN_MM,
  RING_HOLE_OFFSET_MM,
  RING_HOLE_DIAMETER_MM,
  DILATE_MM,
  ERODE_MM,
  WELD_CLEARANCE_MM,
  SEAM_CLOSE_MM,
  MAX_ITEM_WIDTH_MM,
} from "@/lib/keychain-geometry";

/**
 * Net outward growth a dilate(DILATE_MM)-then-erode(ERODE_MM) closing pass
 * adds to a locally-flat edge's dimension (both sides combined) - a raw,
 * pre-clipper shape must be rendered this much *smaller* than its finished
 * target height so the shape that comes out the other end of the clipper
 * pipeline lands exactly on target. Applies to any node whose path actually
 * goes through that closing pass; a designer's own cut-line does not (see
 * `renderKeychainTextScaled`'s character-sizing branch below), so it needs
 * no such compensation.
 */
const CLOSING_GROWTH_MM = 2 * (DILATE_MM - ERODE_MM);

export interface TemplateAssets {
  font: opentype.Font;
  characterImageDataUri: string | null;
  /** Parsed cut-line + cleaned artwork from an SVG character upload, if any. */
  characterVector: CharacterVector | null;
}

// Re-exported for existing importers (e.g. app/api/staging/route.ts) - the
// type itself now lives in lib/render-types.ts so both the "dynamic" engine
// here and the "fixed" layoutMode engine (lib/keychain-render-fixed.ts) can
// share one definition without either file depending on the other.
export type { KeychainRender } from "@/lib/render-types";

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
 * (nominal top-left) position first - used to find a spot that actually
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

  // A "fixed" layoutMode template reuses this same column for its master
  // SVG (see lib/keychain-render-fixed.ts) even when isCharacter is false,
  // so it must load here too - purely additive: every row that isn't
  // layoutMode "fixed" hits the exact same condition as before.
  if ((template.isCharacter || template.layoutMode === "fixed") && template.characterImagePath) {
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

/** Internal-only: the raw (pre-squeeze) text width, needed by the caller's width-fit loop below. */
interface ScaledRenderResult {
  render: KeychainRender;
  /** Width (mm) of the unsqueezed text bounding box - invariant across textSqueezeX. */
  rawTextWidthMm: number;
}

/**
 * Computes the combined character+text (or text-only) cutting outline for one
 * nested unit, dimensioned in mm and normalized to a (0, 0) origin so the
 * result can be placed directly at a packer-assigned (pos_x, pos_y).
 *
 * The character and text nodes are scaled fully independently, each to its
 * own *finished* (post-clipper) target height - `template.charTargetHeight`
 * and `template.textTargetHeight` respectively - then vertically centered
 * against each other. Neither ever resizes to accommodate the other, or to
 * fit MAX_ITEM_WIDTH_MM: only `textSqueezeX` (see the exported
 * `renderKeychainText` wrapper below, which drives this to satisfy that
 * width cap) condenses the text horizontally ("gepeng") - it must never
 * apply to the character artwork/cut-line, which would desync the
 * character's raster image (kept at its own aspect ratio via
 * `preserveAspectRatio="xMidYMid meet"`) from its outline - exactly the
 * image-vs-outline mismatch previously diagnosed in the Miko/Aldo cut-line
 * bug. Defaults to 1 (no squeeze) for a normal, unconstrained render.
 *
 * Kept fixed regardless of either target height (physical/hardware
 * constants, not design proportions): DILATE_MM/ERODE_MM/SEAM_CLOSE_MM
 * (laser kerf & seam-closing are properties of the cutting process, not the
 * drawn size), RING_HOLE_DIAMETER_MM (a fixed hardware-fit spec), and
 * MARGIN_MM/TEXT_GAP_MM/RING_HOLE_OFFSET_MM/WELD_CLEARANCE_MM/holeOffsetX/Y
 * (fixed real-world layout spacing, not tied to either node's own size).
 */
function renderKeychainTextScaled(
  assets: TemplateAssets,
  template: Template,
  text: string,
  textSqueezeX: number
): ScaledRenderResult {
  const sampleText = text.trim() || template.defaultText || "Nama";

  const marginMm = MARGIN_MM;
  const textGapMm = TEXT_GAP_MM;
  const weldClearanceMm = WELD_CLEARANCE_MM;
  const ringHoleOffsetMm = RING_HOLE_OFFSET_MM;
  const holeOffsetX = template.holeOffsetX;
  const holeOffsetY = template.holeOffsetY;

  // The name text always passes through a DILATE_MM/ERODE_MM closing pass
  // (dilated on its own then welded to a designer cut-line, or dilated
  // together with a plain character box - see the two outline branches
  // below), so its raw glyphs must be rendered CLOSING_GROWTH_MM shorter
  // than template.textTargetHeight for the *finished* cut line to land on
  // target exactly, regardless of font metrics. Entirely independent of the
  // character's own sizing.
  const textRawHeightMm = Math.max(template.textTargetHeight - CLOSING_GROWTH_MM, 1);
  const { segments, bbox } = renderColoredGlyphsAtHeight(assets.font, sampleText, textRawHeightMm, template.colors);
  const rawTextWidthMm = Math.max(bbox.x2 - bbox.x1, 1e-6);

  const cutLines = template.isCharacter ? (assets.characterVector?.cutLinePaths ?? []) : [];
  const hasDesignerCutLine = cutLines.length > 0;

  // Side length of the plain (no designer cut-line) character placeholder
  // box - this box IS dilated (as part of `shapesForOutline` below), so like
  // the text it needs the same closing-pass compensation to land its
  // *finished* height on template.charTargetHeight exactly.
  const charBoxMm = Math.max(template.charTargetHeight - CLOSING_GROWTH_MM, 1);

  // Reference shapes for the character's contribution to the outline, and as
  // a bounds fallback if outline computation fails entirely. Computed before
  // text placement so the text's X origin can be measured against the
  // character cut-line's *actual* silhouette instead of assuming it reaches
  // a nominal edge (real artwork rarely does).
  const characterShapes: string[] = [];
  let positionedCutLines: string[] = [];
  let characterBounds: PathBounds | null = null;
  if (template.isCharacter) {
    if (hasDesignerCutLine) {
      // A designer's own cut-line is unioned into the final outline verbatim
      // (never itself dilated - only the near-zero-net SEAM_CLOSE_MM closing
      // pass touches the welded union, see the outline branch below), so it
      // needs no offset compensation: scale directly, by height only, so the
      // artwork's real proportions (not a fixed square) determine its width.
      const srcBounds = assets.characterVector!.bounds;
      const fitScale = template.charTargetHeight / srcBounds.height;
      const cutTx = marginMm - srcBounds.x * fitScale;
      const cutTy = marginMm - srcBounds.y * fitScale;
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
  // X to anchor the horizontal squeeze around, so condensing long names
  // never pulls the text away from the character (or, for text-only
  // templates, away from its left margin).
  let textAnchorX: number;

  if (template.isCharacter) {
    // Position the text just clear of the character's *actual* cut-line
    // silhouette (not a nominal box edge, which real artwork rarely fills)
    // - a small positive WELD_CLEARANCE_MM gap keeps the raw glyphs from
    // ever visually overlapping the character artwork, while staying under
    // the text's net dilation growth (DILATE_MM - ERODE_MM) so the *dilated*
    // cutting outline still reaches the character and Clipper welds the two
    // into one contour.
    const nominalTextOriginX = marginMm + charBoxMm + textGapMm;
    const textOriginX =
      hasDesignerCutLine && characterBounds
        ? characterBounds.x + characterBounds.width + weldClearanceMm
        : nominalTextOriginX;
    textTranslateX = textOriginX - bbox.x1;
    textAnchorX = textOriginX;
    // Center the text vertically against the character's *actual* silhouette
    // height when one is known, not a nominal box - an off-center cut-line
    // would otherwise leave the text looking misaligned next to the artwork.
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

  // The squeeze ("gepeng") is applied here, BEFORE the outline is computed
  // below - so Clipper always dilates/unions the already-condensed text
  // shape, and the red cut-line wraps the squeezed glyphs precisely instead
  // of the original (wider) ones.
  const textSegments: GlyphSegment[] = segments.map((segment) => {
    const translated = translatePathData(segment.d, textTranslateX, textTranslateY);
    const d = textSqueezeX === 1 ? translated : squeezeHorizontalPathData(translated, textSqueezeX, textAnchorX);
    return { d, color: segment.color };
  });

  const shapesForOutline = [...characterShapes, ...textSegments.map((s) => s.d)];

  let outlinePath: string | null;
  if (hasDesignerCutLine) {
    // The designer's cut-line is already the final intended contour - dilate
    // only the (already-squeezed) text, then union the two as-is instead of
    // re-dilating (and thereby distorting) the character's own geometry.
    const textOutline = computeLaserOutlineClipper(textSegments.map((s) => s.d), {
      dilateMm: DILATE_MM,
      erodeMm: ERODE_MM,
    });
    const welded = unionOutlines(textOutline ? [textOutline, ...positionedCutLines] : positionedCutLines);
    // A plain union of two shapes that only just touch leaves a sharp,
    // narrow concave notch right at the seam - a fragile neck once laser-cut
    // from acrylic, even though it's already topologically one piece. An
    // extra closing pass fills that notch into a smooth, rounded bridge
    // without changing the overall outer size.
    outlinePath = welded
      ? (computeLaserOutlineClipper([welded], { dilateMm: SEAM_CLOSE_MM, erodeMm: SEAM_CLOSE_MM }) ?? welded)
      : null;
  } else {
    outlinePath = computeLaserOutlineClipper(shapesForOutline, { dilateMm: DILATE_MM, erodeMm: ERODE_MM });
  }

  // The ring hole normally sits at a fixed offset from the item's top-left
  // corner, which is safe for the plain-square character box but can miss a
  // designer's non-square/non-convex silhouette entirely (a fixed corner
  // point may fall in a concavity - an armpit, a gap between limbs - that
  // isn't actually part of the cut shape). A manual per-template nudge (mm)
  // shifts the preferred spot first - e.g. pulling it inward from an edge
  // that's prone to snapping off - then the search below still guarantees
  // whatever we land on is genuinely inside the welded outline.
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
    ? marginMm + template.charTargetHeight + textGapMm + Math.max(bbox.x2 - bbox.x1, 1) + marginMm
    : Math.max(bbox.x2 - bbox.x1, 1) + marginMm * 2;
  const fallbackHeight = template.isCharacter
    ? template.charTargetHeight + marginMm * 2
    : Math.max(bbox.y2 - bbox.y1, 1) + marginMm * 2;

  const bounds =
    getPathBounds(outlinePath ?? shapesForOutline[0]) ?? {
      x: 0,
      y: 0,
      width: fallbackWidth,
      height: fallbackHeight,
    };

  // The artwork/box image slot is sized to exactly the character's own
  // computed footprint (real cut-line bounds for a designer SVG, or the
  // square placeholder box otherwise) - no extra reserved padding, since
  // that footprint is already what the outline above was built from.
  const characterWidthMm = hasDesignerCutLine && characterBounds ? characterBounds.width : charBoxMm;
  const characterHeightMm = hasDesignerCutLine && characterBounds ? characterBounds.height : charBoxMm;

  return {
    render: {
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
            width: characterWidthMm,
            height: characterHeightMm,
          }
        : null,
    },
    rawTextWidthMm,
  };
}

/** Converge-loop tolerance and iteration cap for `renderKeychainText` below. */
const WIDTH_CONSTRAINT_TOLERANCE_MM = 0.05;
const WIDTH_CONSTRAINT_MAX_ITERATIONS = 6;
/**
 * Safety floor for `textSqueezeX` - guards against a degenerate (zero or
 * negative) horizontal scale in the pathological case where the character
 * and margins alone already reach MAX_ITEM_WIDTH_MM, leaving no room at all
 * for the text. The name renders unreadably condensed rather than crashing;
 * production should catch that case operationally (an oversized
 * charTargetHeight for the item's own expected name lengths).
 */
const MIN_TEXT_SQUEEZE_X = 0.05;

/**
 * Public entry point: renders the character and text each at their own
 * independent target height (template.charTargetHeight / textTargetHeight,
 * never resized to fit one another) first, then - only if the resulting
 * total footprint (bounding box left to right, including the cut-line)
 * would exceed the absolute MAX_ITEM_WIDTH_MM cap - re-renders with the
 * text alone condensed horizontally ("gepeng"): `textSqueezeX` shrinks only
 * its scale-X, anchored where it meets the character (or the left margin),
 * while its scale-Y stays exactly what `textTargetHeight` computed. The
 * character/artwork is never resized or distorted to make room - see
 * `renderKeychainTextScaled`'s docs.
 *
 * The fixed-mm dilate/erode "closing" pass adds a roughly constant absolute
 * amount to the finished width no matter how much the text is squeezed, so a
 * single closed-form solve for `textSqueezeX` can slightly overshoot
 * MAX_ITEM_WIDTH_MM for very long names. Each loop iteration below
 * attributes the *entire* measured excess width to the text's own (already
 * squeezed) width contribution - the only thing this loop is allowed to
 * shrink - and recomputes the squeeze needed to close that excess exactly,
 * converging onto the real target width regardless of that nonlinearity.
 */
export function renderKeychainText(
  assets: TemplateAssets,
  template: Template,
  text: string
): KeychainRender {
  let textSqueezeX = 1;
  let { render, rawTextWidthMm } = renderKeychainTextScaled(assets, template, text, textSqueezeX);

  for (
    let i = 0;
    i < WIDTH_CONSTRAINT_MAX_ITERATIONS && render.width > MAX_ITEM_WIDTH_MM + WIDTH_CONSTRAINT_TOLERANCE_MM;
    i++
  ) {
    const currentTextWidthMm = rawTextWidthMm * textSqueezeX;
    const fixedPortionMm = render.width - currentTextWidthMm;
    const availableForTextMm = MAX_ITEM_WIDTH_MM - fixedPortionMm;
    textSqueezeX = Math.max(MIN_TEXT_SQUEEZE_X, availableForTextMm / rawTextWidthMm);
    ({ render, rawTextWidthMm } = renderKeychainTextScaled(assets, template, text, textSqueezeX));
  }

  return render;
}
