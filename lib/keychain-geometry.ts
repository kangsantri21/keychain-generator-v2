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
 * Production spec for a character template's name text: the *final* cutting
 * outline height (raw glyphs + the dilate/erode closing pass on both the top
 * and bottom edges) must land in the 25-27mm range, target 26mm. Since the
 * closing pass grows a locally-flat edge outward by (DILATE_MM - ERODE_MM)
 * on each side, the raw glyphs must be rendered at that much less than the
 * target so the *finished* cut line comes out at TEXT_CUT_HEIGHT_MM — not
 * the glyphs themselves. Font size is then back-calculated per render (see
 * `renderColoredGlyphsAtHeight` in lib/font-preview.ts) so this holds
 * regardless of the uploaded font's own metrics or which characters (with or
 * without descenders) appear in a given name.
 */
export const TEXT_CUT_HEIGHT_MM = 26;
export const TEXT_RAW_HEIGHT_MM = TEXT_CUT_HEIGHT_MM - 2 * (DILATE_MM - ERODE_MM);

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

/**
 * Extra morphological closing (dilate then erode by this same amount, round
 * joins) applied to the *final* character+text union — plain unioning two
 * shapes that only just touch leaves a sharp, narrow concave "armpit" right
 * at the seam (a fragile neck in laser-cut acrylic, even though the contour
 * is already topologically a single welded piece). Dilating first makes the
 * two banks of that notch touch and merge; eroding back by the identical
 * amount restores the overall outer size everywhere else (verified this
 * keeps the locked TEXT_CUT_HEIGHT_MM exact), while the notch itself stays
 * filled in as a smooth, rounded bridge. Empirically, 2mm was already enough
 * to fully close the seam void on real CorelDraw character artwork; this
 * keeps a safety margin above that measured minimum.
 */
export const SEAM_CLOSE_MM = 3.0;

/**
 * Corner registration/fiducial marks shared by both sheet-level exports —
 * the print JPEG (lib/export-print-svg.ts) draws them as a visual alignment
 * aid for the operator, and the laser DXF (lib/export-dxf.ts) cuts them as
 * real holes, so the print and the cut can be physically pinned together.
 * A single shared constant keeps both exports from ever drifting apart.
 */
export const FIDUCIAL_DIAMETER_MM = 5;
export const FIDUCIAL_RADIUS_MM = FIDUCIAL_DIAMETER_MM / 2;
