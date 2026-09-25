/**
 * Client-side (browser-safe, paper.js-backed) mirror of lib/keychain-
 * render.ts's text-only ("Custom Nama") ring-hole pipeline — used by both
 * CharacterTemplateForm's sibling, FontTemplateForm.tsx (template-level
 * preview), and the Order Queue's HoleOverrideModal.tsx (per-name preview),
 * so both live previews stay mathematically identical to each other and to
 * production, instead of two hand-copied implementations drifting apart.
 *
 * Mirrors the owner-specified pipeline (2026-09-25) at preview (px) scale:
 *   1. Text -> path: the caller's own `ColoredTextRender` (font-preview.ts).
 *   2. Contour (offset): `computeLaserOutlineClipper` dilate/erode.
 *   3. Bounding box FROM THE CONTOUR, not the raw glyph bbox.
 *   4. Hole anchor: X = contour's own leftmost point; Y = the vertical
 *      midpoint of the FIRST LETTER's own separately-dilated contour.
 *   5. Boolean Union: weld a washer (bigger than the actual functional hole)
 *      onto the text contour, then a seam-closing pass.
 */
import { translatePathData, getPathBounds, circlePathData, DILATE_PX, ERODE_PX } from "@/lib/laser-outline";
import { computeLaserOutlineClipper, unionOutlines } from "@/lib/clipper-outline";
import type { ColoredTextRender } from "@/lib/font-preview";
import {
  CHAR_BOX_MM,
  DILATE_MM,
  ERODE_MM,
  SEAM_CLOSE_MM,
  RING_HOLE_DIAMETER_MM,
  RING_HOLE_WASHER_DIAMETER_MM,
} from "@/lib/keychain-geometry";

/** Manual per-template mm values (real-world scale) rendered at this fixed px-per-mm reference — matches CharacterTemplateForm's own PX_PER_MM exactly. */
export const PX_PER_MM = 96 / CHAR_BOX_MM;
export const RING_HOLE_DIAMETER_PX = RING_HOLE_DIAMETER_MM * PX_PER_MM;
export const RING_HOLE_WASHER_DIAMETER_PX = RING_HOLE_WASHER_DIAMETER_MM * PX_PER_MM;
/** Preview-scale dilate/erode for the text contour — matches CharacterTemplateForm's DILATE_PX/ERODE_PX (lib/laser-outline.ts), already calibrated to this same PX_PER_MM. */
export { DILATE_PX, ERODE_PX };
export const SEAM_CLOSE_PX = SEAM_CLOSE_MM * PX_PER_MM;
/** Net outward growth a dilate+erode closing pass adds — mirrors production's CLOSING_GROWTH_MM (lib/keychain-render.ts). */
export const CLOSING_GROWTH_MM = 2 * (DILATE_MM - ERODE_MM);

/** Translated (positioned), ready-for-outline per-glyph path data — px space, mirrors production's mm-space textSegments. */
export function toGlyphShapes(preview: ColoredTextRender | null, translateX: number, translateY: number): string[] {
  return preview ? preview.segments.map((segment) => translatePathData(segment.d, translateX, translateY)) : [];
}

export interface RingHoleAnchor {
  minX: number;
  midY: number;
}

/** Steps 2-4: contour-based minX, first-letter-contour midY. `fallbackY` covers the degenerate case (no glyphs at all). */
export function computeRingHoleAnchor(glyphShapes: string[], textContour: string | null, fallbackY: number): RingHoleAnchor {
  const outlineBounds = textContour ? getPathBounds(textContour) : null;
  const firstGlyphContour =
    glyphShapes.length > 0
      ? computeLaserOutlineClipper([glyphShapes[0]], { dilateMm: DILATE_PX, erodeMm: ERODE_PX })
      : null;
  const firstGlyphBounds = firstGlyphContour ? getPathBounds(firstGlyphContour) : null;

  return {
    minX: outlineBounds?.x ?? 0,
    midY: firstGlyphBounds
      ? firstGlyphBounds.y + firstGlyphBounds.height / 2
      : outlineBounds
        ? outlineBounds.y + outlineBounds.height / 2
        : fallbackY,
  };
}

/** Step 5: welds a ring-hole washer onto the text contour, then closes the seam — returns the final outline the item would actually be cut to. */
export function weldRingHoleWasher(textContour: string | null, holeCenter: { x: number; y: number }): string | null {
  const washer = circlePathData(holeCenter.x, holeCenter.y, RING_HOLE_WASHER_DIAMETER_PX / 2);
  const welded = textContour ? unionOutlines([textContour, washer]) : washer;
  return welded
    ? (computeLaserOutlineClipper([welded], { dilateMm: SEAM_CLOSE_PX, erodeMm: SEAM_CLOSE_PX }) ?? welded)
    : textContour;
}
