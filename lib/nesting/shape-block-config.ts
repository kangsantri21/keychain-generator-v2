/**
 * Spacing for shape-block nesting (P0.4–P0.6).
 *
 * The old production packer keeps 2 mm between bounding boxes. This packer
 * keeps `cutClearanceMm` between the real cut lines, draws a thin frame
 * around each receipt, and reserves a gutter for one receipt code beside
 * that frame. Change the numbers here — they are the single source for the
 * packer, the gate, and the print marks.
 */
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";

/** Minimum gap between two cut lines, mm. Outlines may nest into each other's notches down to this distance. */
export const CUT_CLEARANCE_MM = 1;

/** Empty band between the items' bounding box and the printed frame, mm. */
export const FRAME_PAD_MM = 0.8;

/** Gap between two receipt footprints (frame + label gutter), mm. */
export const BLOCK_GAP_MM = 1;

/** Printed receipt-code size. Small, like the handwritten sheets. */
export const LABEL_FONT_MM = 1.8;
export const LABEL_MIN_FONT_MM = 1.2;
/** Width of one character relative to the font size. Matches the print label. */
export const LABEL_CHAR_EM = 0.72;
/** Gutter thickness: the font plus a little air on both sides of the stroke. */
export const LABEL_GUTTER_MM = 2.6;

/**
 * Items stay this far from the sheet edge. 6 mm clears the corner camera
 * marks (center 2.5 mm in, radius 2.5 mm, plus 2 mm keep-out) on both axes.
 * The production gate still only requires 5 mm.
 */
export const SHAPE_SHEET_MARGIN_MM = 6;

export interface ShapeBlockConfig {
  cutClearanceMm: number;
  framePadMm: number;
  blockGapMm: number;
  labelFontMm: number;
  labelGutterMm: number;
  sheetMarginMm: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** When false, a whole receipt block stays in the orientation it was built. */
  allowBlockRotation: boolean;
}

export function resolveShapeConfig(partial?: Partial<ShapeBlockConfig>): ShapeBlockConfig {
  return {
    cutClearanceMm: partial?.cutClearanceMm ?? CUT_CLEARANCE_MM,
    framePadMm: partial?.framePadMm ?? FRAME_PAD_MM,
    blockGapMm: partial?.blockGapMm ?? BLOCK_GAP_MM,
    labelFontMm: partial?.labelFontMm ?? LABEL_FONT_MM,
    labelGutterMm: partial?.labelGutterMm ?? LABEL_GUTTER_MM,
    sheetMarginMm: partial?.sheetMarginMm ?? SHAPE_SHEET_MARGIN_MM,
    sheetWidthMm: partial?.sheetWidthMm ?? SHEET_WIDTH_MM,
    sheetHeightMm: partial?.sheetHeightMm ?? SHEET_HEIGHT_MM,
    allowBlockRotation: partial?.allowBlockRotation ?? true,
  };
}

export function labelTextLength(text: string, fontMm: number): number {
  return Math.max(1, text.length) * LABEL_CHAR_EM * fontMm;
}

/** Shrink the font until the code fits along `alongMm`, but never below the minimum. */
export function labelFontThatFits(text: string, alongMm: number, preferred = LABEL_FONT_MM): number {
  let font = preferred;
  while (font > LABEL_MIN_FONT_MM + 1e-6 && labelTextLength(text, font) > alongMm + 1e-6) {
    font = Math.round((font - 0.1) * 10) / 10;
  }
  return font;
}

/**
 * The code sits in a gutter on the left of the frame, reading upward.
 * Putting it under a wide block would add a strip of waste to every row.
 * A very short frame (under 8 mm) cannot hold the code on that edge, so the
 * gutter moves under the frame instead. Same rule at pack time and at print
 * time, so the reserved strip is where the text is drawn.
 */
export function labelSide(frameWidth: number, frameHeight: number): "left" | "bottom" {
  if (frameHeight < 8 && frameWidth > frameHeight) return "bottom";
  return "left";
}
