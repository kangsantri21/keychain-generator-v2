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
