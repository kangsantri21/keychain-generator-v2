/** Shared real-world (mm) layout constants for Modul C nesting & rendering. */

export const SHEET_WIDTH_MM = 310;
export const SHEET_HEIGHT_MM = 470;

/**
 * Asymmetric packer clearance (lib/nesting.ts's `packMaxRects`/
 * `packIntoExistingSheet`), applied in ON-SHEET space, always, regardless
 * of which way a given item gets rotated:
 *
 * - ITEM_PADDING_RIGHT_MM: tight gap trailing each item's on-sheet RIGHT
 *   edge, and the sheet's own outer border on every side. A uniform 5mm
 *   here (the original fix for the receipt-label bleed bug below) turned
 *   out to waste real acrylic on every horizontal gap and every sheet
 *   edge, not just the ones that actually needed room for a label — QA
 *   flagged it (2026-09-26) as material waste, not a safety concern.
 * - ITEM_PADDING_BOTTOM_MM: generous gap trailing each item's on-sheet
 *   BOTTOM edge only — this is the receipt-code label's own waste band.
 *   With a 1.8mm label font-size (RECEIPT_LABEL_FONT_SIZE_MM) a value
 *   below ~2mm would put the label's baseline back on the boundary itself,
 *   reintroducing the original bleed-into-the-neighbor's-cut-line bug this
 *   constant exists to prevent.
 *
 * Both apply post-rotation-decision, never pre-: naively inflating an
 * item's HEIGHT before handing it to the packer (so the packer's own
 * always-symmetric per-orientation padding "just works") reserves the
 * extra room on the WRONG physical side once an item is rotated — lib/
 * staging-transform.ts's `rotate(90)` transform maps an item's own local
 * "bottom" edge to the on-sheet LEFT edge, not the on-sheet bottom, so a
 * height-inflated-then-rotated item would have its real label-bearing
 * edge sitting at only the tight ITEM_PADDING_RIGHT_MM, while the
 * generous margin ends up wasted on the item's on-sheet right side
 * instead (verified with a direct point-transform simulation before
 * choosing this design). `lib/nesting.ts`'s `findBestNode` instead
 * computes each orientation's on-sheet width/height FIRST, then adds
 * paddingRight/paddingBottom to whichever role that on-sheet dimension
 * plays — so the generous clearance always lands trailing the on-sheet
 * bottom, and `lib/staging-transform.ts`'s label position is itself
 * rotation-conditional (drawn at local-x instead of local-y, for a
 * rotated item) so the label always physically renders into that same
 * on-sheet-bottom band no matter which way the item was rotated.
 */
export const ITEM_PADDING_RIGHT_MM = 2;
export const ITEM_PADDING_BOTTOM_MM = 5;

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

/**
 * Text-only ("Custom Nama") ring-hole pipeline only (lib/keychain-render.ts):
 * the outer diameter of the solid "washer" circle unioned onto the text's
 * own contour at the hole's position, strictly larger than
 * RING_HOLE_DIAMETER_MM (the actual functional hole cut out of its center).
 * Without this margin, unioning then drilling the SAME size circle would
 * leave the ring of material around the hole at zero thickness everywhere
 * the hole sits outside the letter's own ink — snapping the instant it's
 * laser-cut. 5mm outer / 1.9mm hole leaves a ~1.55mm wall on every side,
 * confirmed with the owner as a safe minimum for the acrylic in use (matches
 * FIDUCIAL_DIAMETER_MM's own 5mm, already a proven safe circular-feature
 * size elsewhere in this same pipeline).
 */
export const RING_HOLE_WASHER_DIAMETER_MM = 5;

/** Manual per-template hole offset nudge (Template.holeOffset* columns) is clamped to this range, in mm. */
export const MAX_LAYOUT_OFFSET_MM = 15;

/**
 * How far the laser cut sits outside the design edge, in mm.
 * Decided by Rofiq on 10 Nov 2026: 0.25 mm. This is applied AFTER the gap
 * closing below, so the clearance and the bridge between letters are not
 * the same number. Change this constant to retune production; the preview
 * and the renderer both read it.
 */
export const OUTLINE_OFFSET_MM = 0.25;

/**
 * Gaps narrower than this (mm) are closed before the final offset, so
 * nearby letters stay one strong acrylic piece. The closing radius is half
 * of this width. 6 mm covers the widest letter-to-letter gap measured on
 * the sample names at the default 20 mm text height (about 4.8 mm) and
 * still leaves a normal word space (about 10 mm) open. A straight edge does
 * not move during this step — only the final OUTLINE_OFFSET_MM does.
 */
export const GAP_CLOSE_MM = 6;

/**
 * Finished-size growth along one dimension (both sides) caused by
 * OUTLINE_OFFSET_MM. The gap closing does not add to it. Raw glyphs and the
 * plain character box are drawn this much shorter than their target height
 * so the cut line lands on the target.
 */
export const OUTLINE_GROWTH_MM = OUTLINE_OFFSET_MM * 2;

/**
 * Largest distance allowed between a true curve and the straight segments
 * that replace it, in mm. Also the round-join tolerance of the offset.
 * 0.01 mm is far below a laser kerf, so the cut looks smooth, while a full
 * circle stays under a couple of hundred points instead of tens of thousands.
 */
export const CURVE_TOLERANCE_MM = 0.01;

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
 * the raw text glyphs next to it — guarantees the letters never visually
 * overlap the character artwork. Must stay below GAP_CLOSE_MM so the closing
 * pass still bridges that gap into one contour. The final cut then sits
 * OUTLINE_OFFSET_MM outside the design; it is not what welds the seam.
 */
export const WELD_CLEARANCE_MM = 1.0;

/**
 * Corner registration/fiducial marks shared by both sheet-level exports —
 * the print JPEG (lib/export-print-svg.ts) draws them as a visual alignment
 * aid for the operator, and the laser DXF (lib/export-dxf.ts) cuts them as
 * real holes, so the print and the cut can be physically pinned together.
 * A single shared constant keeps both exports from ever drifting apart.
 */
export const FIDUCIAL_DIAMETER_MM = 5;
export const FIDUCIAL_RADIUS_MM = FIDUCIAL_DIAMETER_MM / 2;

/**
 * Receipt-code label printed beneath each item (lib/staging-transform.ts's
 * getReceiptLabelPosition), sized and positioned to stay entirely inside
 * the ITEM_PADDING_BOTTOM_MM waste band trailing each item's on-sheet
 * bottom edge — never inside either item's own cut-line, never crossing
 * into the next one's. Sized against a worst-case font (tall ascender/
 * descender, since the label font is whatever arbitrary TTF/OTF an admin
 * uploaded for that template, not a fixed system font):
 * RECEIPT_LABEL_BOTTOM_CLEARANCE_MM reserves room below the text baseline
 * for descenders plus a safety margin before the next item's edge.
 */
export const RECEIPT_LABEL_FONT_SIZE_MM = 1.8;
export const RECEIPT_LABEL_BOTTOM_CLEARANCE_MM = 1.5;
