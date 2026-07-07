/** Shared real-world (mm) layout constants for Modul C nesting & rendering. */

export const SHEET_WIDTH_MM = 310;
export const SHEET_HEIGHT_MM = 470;

/** Gap the packer keeps between neighboring items, for safe laser cutting. */
export const ITEM_PADDING_MM = 3;

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
