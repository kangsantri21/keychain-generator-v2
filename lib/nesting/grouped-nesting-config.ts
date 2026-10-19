/**
 * Grouped Nesting V2 (Phase 2A) config — deliberately its own file, separate
 * from the legacy `lib/keychain-geometry.ts`, so V2 spacing can be tuned
 * without touching any legacy constant (`ITEM_PADDING_RIGHT_MM`/
 * `ITEM_PADDING_BOTTOM_MM` stay exactly as they are, untouched by this
 * phase). `SHEET_WIDTH_MM`/`SHEET_HEIGHT_MM` (the actual production media)
 * ARE reused directly from `lib/keychain-geometry.ts` below, per the
 * audit's own finding that the keychain module's sheet size already has an
 * explicit, correct value (310x470mm) — no reason to duplicate or guess a
 * new one for V2.
 */
export { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";

/**
 * Gap between two items WITHIN the same order group's inner packing.
 * Deliberately NOT reusing legacy's `ITEM_PADDING_BOTTOM_MM` (5mm) — that
 * value exists specifically to reserve room for the per-item receipt-code
 * label (lib/keychain-geometry.ts's own doc comment), and Phase 2A
 * explicitly excludes per-item receipt labels from its compact packing (see
 * `packOrderGroup`'s own doc comment) — reusing it here would silently
 * import a concern that doesn't apply yet. A plain, symmetric production
 * safety gap instead.
 */
export const PART_GAP_MM = 2;

/**
 * Gap between two different order groups' bounding boxes on the outer
 * (sheet-level) packing pass — deliberately larger than PART_GAP_MM so a
 * production operator can visually tell where one resi's items end and the
 * next begins, even before Phase 2A/2B add an explicit visual boundary or
 * per-group label (both out of this phase's scope).
 */
export const ORDER_GAP_MM = 8;

/** Clearance kept between the sheet's own physical edge and the nearest group's bounding box — independent of ORDER_GAP_MM so the two can be tuned separately (e.g. a tighter sheet border than inter-group gap, or vice versa). */
export const SHEET_MARGIN_MM = 5;

/**
 * Per-axis outer spacing. The outer pack gives every group box a border +
 * trailing clearance of the inter-group gap, inside a frame inset by the
 * sheet margin, so per axis:
 *   gap between two groups          = gap
 *   first group from the left/top   = margin + gap
 *   last group from the right/bottom >= margin + 2 * gap
 * `orderGapMm`/`sheetMarginMm` are the vertical (y) values and the default
 * for x; `orderGapXMm`/`sheetMarginXMm` override x only. Without overrides
 * both axes are identical — the original single-gap behavior.
 */
export interface OuterSpacingConfig {
  orderGapMm: number;
  sheetMarginMm: number;
  orderGapXMm?: number;
  sheetMarginXMm?: number;
}

export interface OuterSpacing {
  marginX: number;
  marginY: number;
  gapX: number;
  gapY: number;
}

export function outerSpacing(config: OuterSpacingConfig): OuterSpacing {
  return {
    marginX: config.sheetMarginXMm ?? config.sheetMarginMm,
    marginY: config.sheetMarginMm,
    gapX: config.orderGapXMm ?? config.orderGapMm,
    gapY: config.orderGapMm,
  };
}

/**
 * Production receipt-group spacing (Production Nesting only — ORDER_GAP_MM
 * above stays the V2/legacy/experimental default). Receipts keep only
 * PART_GAP between their boxes on BOTH axes — the same physical cut
 * clearance as two parts of one receipt, so artwork of different receipts
 * never touches. The receipt outlines drawn PRODUCTION_GROUP_GAP_X_MM / 2
 * outside each box then touch.
 */
export const PRODUCTION_GROUP_GAP_X_MM = PART_GAP_MM;
export const PRODUCTION_GROUP_GAP_Y_MM = PART_GAP_MM;

/**
 * Production frame insets (outer pack: first group at margin + gap, last
 * ends >= margin + 2 * gap from the far edge):
 *   x: left edge SHEET_MARGIN_MM (3 + 2 = 5), right >= 7
 *   y: top edge stays 13 mm as before (11 + 2), bottom >= 15
 */
export const PRODUCTION_SHEET_MARGIN_X_MM = SHEET_MARGIN_MM - PRODUCTION_GROUP_GAP_X_MM;
export const PRODUCTION_TOP_EDGE_MM = SHEET_MARGIN_MM + ORDER_GAP_MM;
export const PRODUCTION_SHEET_MARGIN_Y_MM = PRODUCTION_TOP_EDGE_MM - PRODUCTION_GROUP_GAP_Y_MM;

/** Production spacing as engine config overrides — the single source for nesting, compaction, gate and debug. */
export const PRODUCTION_SPACING = {
  orderGapMm: PRODUCTION_GROUP_GAP_Y_MM,
  sheetMarginMm: PRODUCTION_SHEET_MARGIN_Y_MM,
  orderGapXMm: PRODUCTION_GROUP_GAP_X_MM,
  sheetMarginXMm: PRODUCTION_SHEET_MARGIN_X_MM,
} as const;

/**
 * Camera fiducials (lib/keychain-geometry.ts FIDUCIAL_*, centered
 * FIDUCIAL_RADIUS_MM in from each corner) are keep-out areas: no artwork
 * within FIDUCIAL_CLEARANCE_MM of a fiducial circle. Checked by the
 * production gate (lib/production-gate.ts).
 */
export const FIDUCIAL_CLEARANCE_MM = PART_GAP_MM;
