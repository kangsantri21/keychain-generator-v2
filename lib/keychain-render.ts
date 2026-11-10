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
  holeCandidates,
  unionBounds,
  circlePathData,
  type PathBounds,
} from "@/lib/laser-outline";
import { computeProductionOutline, unionOutlines } from "@/lib/clipper-outline";
import { parseCharacterSvg, type CharacterVector } from "@/lib/character-svg-server";
import type { Template, HoleOverride } from "@/lib/db/schema";
import type { KeychainRender } from "@/lib/render-types";
import {
  MARGIN_MM,
  RING_HOLE_OFFSET_MM,
  RING_HOLE_DIAMETER_MM,
  RING_HOLE_WASHER_DIAMETER_MM,
  GAP_CLOSE_MM,
  OUTLINE_OFFSET_MM,
  OUTLINE_GROWTH_MM,
  MAX_ITEM_WIDTH_MM,
} from "@/lib/keychain-geometry";

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
  let characterVector: CharacterVector | null = null;

  // A "fixed" layoutMode template reuses this same column for its master
  // SVG (see lib/keychain-render-fixed.ts) even when isCharacter is false,
  // so it must load here too - purely additive: every row that isn't
  // layoutMode "fixed" hits the exact same condition as before.
  if ((template.isCharacter || template.layoutMode === "fixed") && template.characterImagePath) {
    const imageBuffer = await readPublicFile(template.characterImagePath);
    const ext = path.extname(template.characterImagePath).toLowerCase();
    const rawDataUri = `data:${ext === ".svg" ? "image/svg+xml" : "image/png"};base64,${imageBuffer.toString("base64")}`;

    if (ext === ".svg") {
      characterVector = parseCharacterSvg(imageBuffer.toString("utf8"));
    }

    // "fixed" layoutMode master SVGs are multi-layer designer files where
    // the cut-line-detection heuristic below (tuned for single-character
    // dynamic uploads) unreliably mis-tags an inner design layer as the
    // cut-line and strips it out of characterVector.artworkDataUri -
    // corrupting the artwork shown to the customer. The fixed engine
    // (lib/keychain-render-fixed.ts) computes its own cut-line automatically
    // instead and never needs a "cleaned" image, so it always gets the
    // untouched original file, every layer intact.
    characterImageDataUri =
      template.layoutMode === "fixed" ? rawDataUri : (characterVector?.artworkDataUri ?? rawDataUri);
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
 * constants, not design proportions): OUTLINE_OFFSET_MM and GAP_CLOSE_MM
 * (how far the cut sits from the design, and which letter gaps are bridged
 * — properties of the cutting process, not the drawn size),
 * RING_HOLE_DIAMETER_MM (a fixed hardware-fit spec), and
 * MARGIN_MM/RING_HOLE_OFFSET_MM/holeOffsetX/Y (fixed real-world layout
 * spacing, not tied to either node's own size). template.dynamicGapX/
 * dynamicOffsetY are the one exception to "fixed" here - a per-template,
 * admin-tunable horizontal gap and vertical nudge for the text relative to
 * the character, applied below before the Clipper union so the weld
 * recalculates live with every change.
 */
function renderKeychainTextScaled(
  assets: TemplateAssets,
  template: Template,
  text: string,
  textSqueezeX: number,
  holeOverride: HoleOverride | null
): ScaledRenderResult {
  const sampleText = text.trim() || template.defaultText || "Nama";

  const marginMm = MARGIN_MM;
  const ringHoleOffsetMm = RING_HOLE_OFFSET_MM;
  const holeOffsetX = template.holeOffsetX;
  const holeOffsetY = template.holeOffsetY;

  // The name text always receives the final OUTLINE_OFFSET_MM clearance
  // (on its own, then welded to a designer cut-line, or together with a
  // plain character box - see the two outline branches below). The gap
  // closing does not change a straight edge, so the raw glyphs only need
  // to be OUTLINE_GROWTH_MM shorter than template.textTargetHeight for the
  // finished cut line to land on target. Entirely independent of the
  // character's own sizing.
  const textRawHeightMm = Math.max(template.textTargetHeight - OUTLINE_GROWTH_MM, 1);
  const { segments, bbox } = renderColoredGlyphsAtHeight(assets.font, sampleText, textRawHeightMm, template.colors);
  const rawTextWidthMm = Math.max(bbox.x2 - bbox.x1, 1e-6);

  // Character outline is auto-computed via Clipper, exactly like the
  // "fixed" layoutMode engine's own resilience fix (lib/keychain-render-
  // fixed.ts): the old approach trusted a single tagged "cut-line" layer
  // inside the designer's SVG (id="cut-line" / reddish stroke / bare
  // fill:none), which routinely broke on files with no clean pre-made
  // cut-line layer at all - e.g. a starfish upload whose reddish stroke
  // lived on an inner design element, not a proper outer silhouette,
  // cutting straight through the artwork's internal detail instead of
  // wrapping it. Instead, EVERY shape in the character's SVG is unioned
  // together via Clipper (`unionOutlines` - a plain boolean union, no
  // dilate/erode, and it already drops interior holes/counters via
  // keepOuterOrientation) into one solid outer boundary with no internal
  // holes, no matter how the designer's file is laid out.
  const characterAllShapes = template.isCharacter ? (assets.characterVector?.allShapePaths ?? []) : [];
  const hasCharacterVectorShapes = characterAllShapes.length > 0;

  // Side length of the plain (no usable vector artwork - a raster PNG
  // upload, or a degenerate SVG Clipper couldn't union into anything)
  // character placeholder box - this box IS dilated (as part of
  // `shapesForOutline` below), so like the text it needs the same
  // closing-pass compensation to land its *finished* height on
  // template.charTargetHeight exactly.
  const charBoxMm = Math.max(template.charTargetHeight - OUTLINE_GROWTH_MM, 1);

  // Reference shapes for the character's contribution to the outline, and as
  // a bounds fallback if outline computation fails entirely. Computed before
  // text placement so the text's X origin can be measured against the
  // character's *actual* auto-computed silhouette instead of assuming it
  // reaches a nominal edge (real artwork rarely does).
  const characterShapes: string[] = [];
  let positionedCharacterOutline: string[] = [];
  let characterBounds: PathBounds | null = null;
  let hasCharacterOutline = false;
  if (template.isCharacter) {
    if (hasCharacterVectorShapes) {
      // Scale every shape to the real target height FIRST (around the SVG's
      // own origin, height-only so the artwork's real proportions - not a
      // fixed square - determine its width), THEN union - Clipper's offset
      // math needs genuine output-mm coordinates, not the SVG's arbitrary
      // native scale.
      const srcBounds = assets.characterVector!.bounds;
      const fitScale = template.charTargetHeight / srcBounds.height;
      const cutTx = marginMm - srcBounds.x * fitScale;
      const cutTy = marginMm - srcBounds.y * fitScale;
      const scaledShapes = characterAllShapes.map((d) => scaleAndTranslatePathData(d, fitScale, cutTx, cutTy));
      const autoOutline = unionOutlines(scaledShapes);
      if (autoOutline) {
        positionedCharacterOutline = [autoOutline];
        characterShapes.push(autoOutline);
        const b = getPathBounds(autoOutline);
        if (b) characterBounds = b;
        hasCharacterOutline = true;
      }
    }
    if (!hasCharacterOutline) {
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
    // Position the text relative to the character's *actual* auto-computed
    // outline (not a nominal box edge, which real artwork rarely fills).
    // template.dynamicGapX is an admin-tunable horizontal gap (default
    // WELD_CLEARANCE_MM). It must stay under GAP_CLOSE_MM so the closing
    // pass still bridges the character and the text into one contour. The
    // 0.25 mm offset is only clearance; it is not what welds them. An admin
    // can widen the gap to separate them, or shrink it, and the union below
    // re-welds (or un-welds) live.
    const nominalTextOriginX = marginMm + charBoxMm + template.dynamicGapX;
    const textOriginX =
      hasCharacterOutline && characterBounds
        ? characterBounds.x + characterBounds.width + template.dynamicGapX
        : nominalTextOriginX;
    textTranslateX = textOriginX - bbox.x1;
    textAnchorX = textOriginX;
    // Centered vertically against the character's *actual* silhouette height
    // when one is known, not a nominal box, then nudged by the admin-tunable
    // template.dynamicOffsetY (0 = exact center, matching the old fixed
    // behavior) - an off-center cut-line would otherwise leave the text
    // looking misaligned next to the artwork with no way to correct it.
    const charCenterY =
      hasCharacterOutline && characterBounds
        ? characterBounds.y + characterBounds.height / 2
        : marginMm + charBoxMm / 2;
    textTranslateY = charCenterY - (bbox.y1 + bbox.y2) / 2 + template.dynamicOffsetY;
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
  if (hasCharacterOutline) {
    // The auto-computed character outline is already the final intended
    // contour - dilate only the (already-squeezed) text, then union the two
    // as-is instead of re-dilating (and thereby distorting) the character's
    // own geometry.
    const textOutline = computeProductionOutline(textSegments.map((s) => s.d), {
      gapClose: GAP_CLOSE_MM,
      offset: OUTLINE_OFFSET_MM,
    });
    const welded = unionOutlines(
      textOutline ? [textOutline, ...positionedCharacterOutline] : positionedCharacterOutline
    );
    // A plain union of two shapes that only just touch leaves a sharp,
    // narrow concave notch right at the seam - a fragile neck once laser-cut
    // from acrylic, even though it's already topologically one piece. Close
    // that notch with the same gap threshold, and do not add a second
    // offset: the text is already OUTLINE_OFFSET_MM outside its glyphs, and
    // the character silhouette stays on the artwork.
    outlinePath = welded
      ? (computeProductionOutline([welded], { gapClose: GAP_CLOSE_MM, offset: 0 }) ?? welded)
      : null;
  } else {
    outlinePath = computeProductionOutline(shapesForOutline, {
      gapClose: GAP_CLOSE_MM,
      offset: OUTLINE_OFFSET_MM,
    });
  }

  // Character templates: the ring hole sits at a fixed offset from the
  // item's top-left corner, which is safe for the plain-square character box
  // but can miss a designer's non-square/non-convex silhouette entirely (a
  // fixed corner point may fall in a concavity - an armpit, a gap between
  // limbs - that isn't actually part of the cut shape). A manual per-template
  // nudge (mm) shifts the preferred spot first - e.g. pulling it inward from
  // an edge that's prone to snapping off - then the search below still
  // guarantees whatever we land on is genuinely inside the welded outline.
  // Products that don't hang from a ring at all (e.g. flat stick-on acrylic
  // pins) opt out via template.hasHole - skip entirely rather than computing
  // a hole nobody asked for.
  let holePath: string | null = null;
  if (template.hasHole && template.isCharacter) {
    const baseBounds = characterBounds ?? { x: marginMm, y: marginMm, width: charBoxMm, height: charBoxMm };
    const nominalHoleCenter = {
      x: baseBounds.x + ringHoleOffsetMm + holeOffsetX + (holeOverride?.x ?? 0),
      y: marginMm + ringHoleOffsetMm + holeOffsetY + (holeOverride?.y ?? 0),
    };
    let holeCenter = nominalHoleCenter;
    if (outlinePath) {
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
    holePath = circlePathData(holeCenter.x, holeCenter.y, RING_HOLE_DIAMETER_MM / 2);
  } else if (template.hasHole) {
    // Text-only ("Custom Nama") ring-hole pipeline - deterministic geometry
    // per owner spec (2026-09-25), replacing a fixed-corner offset +
    // best-effort relocation search (which never even ran for this branch
    // before) with a fully computed placement:
    //   1. Text -> path: `textSegments` above (already squeezed/positioned).
    //   2. Contour (offset): `outlinePath` above IS this contour - a plain
    //      dilate/erode over every glyph, already computed a few lines up.
    //   3. Bounding box FROM THE CONTOUR, not the raw glyph bbox: a letter's
    //      dilated left edge depends on that letter's own shape (straight
    //      "B" vs slanted "A" vs curved "J"), so anchoring to the
    //      pre-dilation glyph bbox (the old approach) drifted off the mark
    //      name to name - that's the actual QA-reported bug.
    //   4. X = the contour's own leftmost point minus template.holeOffsetX
    //      ("Jarak Lubang (mm)" in the Custom Nama template form - now the
    //      one surviving manual control for this template type, replacing
    //      the old X/Y sliders). Y follows the vertical midpoint of the
    //      FIRST LETTER's own contour specifically - not the whole name's,
    //      which a taller/shorter later letter could skew away from where
    //      the first letter actually sits.
    //   5. Union: weld a RING_HOLE_WASHER_DIAMETER_MM washer - strictly
    //      bigger than the RING_HOLE_DIAMETER_MM hole drilled out of its
    //      center below - onto the text contour, so the hole area is made
    //      solid rather than merely hoped to already be solid. Reassigning
    //      `outlinePath` itself (not just computing holePath) is
    //      deliberate: everything downstream (the item's reported width/
    //      height fed to the nesting packer, the normalized bounds every
    //      other path below gets shifted against) must already account for
    //      the washer's protrusion, the same way the character branch's own
    //      weld above does for its text.
    const firstGlyphContour = textSegments[0]
      ? computeProductionOutline([textSegments[0].d], { gapClose: GAP_CLOSE_MM, offset: OUTLINE_OFFSET_MM })
      : null;
    const firstGlyphBounds = firstGlyphContour ? getPathBounds(firstGlyphContour) : null;
    const outlineBounds = outlinePath ? getPathBounds(outlinePath) : null;

    const minX = outlineBounds?.x ?? marginMm;
    const midY = firstGlyphBounds
      ? firstGlyphBounds.y + firstGlyphBounds.height / 2
      : (outlineBounds ? outlineBounds.y + outlineBounds.height / 2 : marginMm + textRawHeightMm / 2);

    // A-Z Letter Mapping (owner spec, 2026-09-25): the geometric midY above
    // is a plain vertical center of the first letter's own dilated contour,
    // which on bubble/script fonts doesn't land on that letterform's actual
    // visual weight - "J"'s descending tail, "A"'s wide diagonal legs, "V"'s
    // point all pull the true "balanced" hole spot away from a bounding
    // box's geometric middle. Rather than trying to detect that
    // automatically per font, the admin corrects it once per letter per
    // template (Template.letterOffsets, lib/db/schema.ts) and every future
    // name starting with that letter reuses the same fix.
    const firstLetterKey = sampleText.trim().charAt(0).toUpperCase();
    const letterOffset = template.letterOffsets?.[firstLetterKey] ?? null;

    const holeCenter = {
      x: minX - holeOffsetX + (letterOffset?.x ?? 0) + (holeOverride?.x ?? 0),
      y: midY + (letterOffset?.y ?? 0) + (holeOverride?.y ?? 0),
    };

    const washer = circlePathData(holeCenter.x, holeCenter.y, RING_HOLE_WASHER_DIAMETER_MM / 2);
    const welded = outlinePath ? unionOutlines([outlinePath, washer]) : washer;
    // Same rationale as the character branch's own seam-close pass above: a
    // plain union of two shapes that only just touch (or barely overlap)
    // leaves a sharp, narrow concave notch at the seam - a fragile neck once
    // laser-cut, even though it's already topologically one piece.
    outlinePath = welded
      ? (computeProductionOutline([welded], { gapClose: GAP_CLOSE_MM, offset: 0 }) ?? welded)
      : outlinePath;

    holePath = circlePathData(holeCenter.x, holeCenter.y, RING_HOLE_DIAMETER_MM / 2);
  }

  const fallbackWidth = template.isCharacter
    ? marginMm + template.charTargetHeight + template.dynamicGapX + Math.max(bbox.x2 - bbox.x1, 1) + marginMm
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
  // computed footprint (the auto-computed outline's real bounds, or the
  // square placeholder box otherwise) - no extra reserved padding, since
  // that footprint is already what the outline above was built from.
  const characterWidthMm = hasCharacterOutline && characterBounds ? characterBounds.width : charBoxMm;
  const characterHeightMm = hasCharacterOutline && characterBounds ? characterBounds.height : charBoxMm;

  return {
    render: {
      width: bounds.width,
      height: bounds.height,
      outlinePath: outlinePath ? normalizePath(outlinePath, bounds) : null,
      holePath: holePath ? normalizePath(holePath, bounds) : null,
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
 * The fixed-mm outline offset adds a roughly constant absolute
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
  text: string,
  holeOverride: HoleOverride | null = null
): KeychainRender {
  let textSqueezeX = 1;
  let { render, rawTextWidthMm } = renderKeychainTextScaled(assets, template, text, textSqueezeX, holeOverride);

  for (
    let i = 0;
    i < WIDTH_CONSTRAINT_MAX_ITERATIONS && render.width > MAX_ITEM_WIDTH_MM + WIDTH_CONSTRAINT_TOLERANCE_MM;
    i++
  ) {
    const currentTextWidthMm = rawTextWidthMm * textSqueezeX;
    const fixedPortionMm = render.width - currentTextWidthMm;
    const availableForTextMm = MAX_ITEM_WIDTH_MM - fixedPortionMm;
    textSqueezeX = Math.max(MIN_TEXT_SQUEEZE_X, availableForTextMm / rawTextWidthMm);
    ({ render, rawTextWidthMm } = renderKeychainTextScaled(assets, template, text, textSqueezeX, holeOverride));
  }

  return render;
}
