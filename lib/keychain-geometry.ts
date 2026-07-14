/** Shared real-world (mm) layout constants for Modul C nesting & rendering. */

export const SHEET_WIDTH_MM = 310;
export const SHEET_HEIGHT_MM = 470;

/** Gap the packer keeps between neighboring items, for safe laser cutting. */
export const ITEM_PADDING_MM = 2;

/** Character image footprint (square) for Template Karakter items. */
export const CHAR_BOX_MM = 25;
/** Gap between the character box and its name text. */
export const TEXT_GAP_MM = 5;
/** Outer clearance kept around every item so the dilated outline never clips. */
export const MARGIN_MM = 3;

/** Cap-height-ish font size used when rendering a name next to a character box. */
export const FONT_SIZE_CHAR_MM = 14;
/** Cap-height-ish font size used when rendering a name for a standalone font template. */
export const FONT_SIZE_STANDARD_MM = 18;

/** Ring/keychain hole, offset from the item's top-left corner. */
export const RING_HOLE_OFFSET_MM = 4;
export const RING_HOLE_DIAMETER_MM = 3;

/** Manual per-template hole offset nudge (Template.holeOffset* columns) is clamped to this range, in mm. */
export const MAX_LAYOUT_OFFSET_MM = 15;

/**
 * Laser-cutting clearance: dilate outward then erode back (a "closing" pass)
 * to merge nearby letters into one silhouette and round off concavities.
 * Net growth is DILATE_MM - ERODE_MM. These are real mm values for the
 * clipper-lib-based outline engine (lib/clipper-outline.ts).
 */
export const DILATE_MM = 4.0;
export const ERODE_MM = 1.5;

/**
 * Visual gap (mm) kept between a character's *actual* cut-line silhouette and
 * the raw (pre-dilation) text glyphs next to it — guarantees the letters
 * never visually overlap the character artwork. Must stay comfortably below
 * the text's net dilation growth (DILATE_MM - ERODE_MM ≈ 2.5mm) so the
 * *dilated* text outline still reaches the character's cut-line and Clipper
 * welds them into one contour; verified empirically against real CorelDraw
 * artwork that a bare hair's-width beyond ~2.0-2.25mm stops welding.
 */
export const WELD_CLEARANCE_MM = 1.0;
