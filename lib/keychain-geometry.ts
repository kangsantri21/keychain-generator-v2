/** Shared real-world (mm) layout constants for Modul C nesting & rendering. */

export const SHEET_WIDTH_MM = 310;
export const SHEET_HEIGHT_MM = 470;

/** Gap the packer keeps between neighboring items, for safe laser cutting. */
export const ITEM_PADDING_MM = 2;

/**
 * Legacy nominal character footprint — no longer drives production sizing
 * (lib/keychain-render.ts scales the character node by Template.
 * charTargetHeight instead, independently of the text). Kept only as the
 * live admin preview's px-per-mm reference scale (components/master-template/
 * CharacterTemplateForm.tsx).
 */
export const CHAR_BOX_MM = 25;
/** Gap between the character box and its name text. */
export const TEXT_GAP_MM = 5;
/** Outer clearance kept around every item so the dilated outline never clips. */
export const MARGIN_MM = 3;

/** Ring/keychain hole, offset from the item's top-left corner. */
export const RING_HOLE_OFFSET_MM = 4;
export const RING_HOLE_DIAMETER_MM = 1.9;

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
 * Default *finished* (post-clipper) cutting heights, in mm, for a "dynamic"
 * layoutMode template's two independently-scaled nodes — the character
 * artwork/box and the name text (Template.charTargetHeight/textTargetHeight,
 * lib/db/schema.ts). Each node's raw (pre-dilation) size is back-calculated
 * per render from its own target so the *finished* cut line lands exactly on
 * target regardless of font metrics or artwork aspect ratio — see
 * lib/keychain-render.ts.
 */
export const DEFAULT_CHAR_TARGET_HEIGHT_MM = 26;
export const DEFAULT_TEXT_TARGET_HEIGHT_MM = 20;

/**
 * Hard, absolute ceiling on a rendered item's total on-sheet width (bounding
 * box left to right, including the cut-line) — without this, a long name
 * (more letters, wider glyph advance) makes the item stretch proportionally
 * wider with no limit, wasting acrylic in nesting. Unlike the old two-stage
 * uniform-shrink-then-squeeze scheme, character height is NEVER reduced to
 * fit this cap — only the text may condense horizontally (scale-X only,
 * "gepeng") once it would push the total past this limit; see
 * lib/keychain-render.ts.
 */
export const MAX_ITEM_WIDTH_MM = 80;

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
