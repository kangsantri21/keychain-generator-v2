import { ITEM_PADDING_BOTTOM_MM, RECEIPT_LABEL_BOTTOM_CLEARANCE_MM } from "@/lib/keychain-geometry";
import type { StagingItemPayload } from "@/lib/staging-types";

export type ItemRotation = 0 | 90 | 180 | 270;

/**
 * 0° and 180° keep the artwork's width and height. 90° and 270° swap them.
 * Older rows only stored the boolean: true means 90°, false means 0°.
 */
export function itemRotationDeg(item: { rotated?: boolean; rotationDeg?: number | null }): ItemRotation {
  const deg = item.rotationDeg;
  if (deg === 0 || deg === 90 || deg === 180 || deg === 270) return deg;
  return item.rotated ? 90 : 0;
}

/** Artwork-space point → sheet point. Matches `getItemTransform`. */
export function localToSheet(
  item: { posX: number; posY: number; width: number; height?: number; rotated?: boolean; rotationDeg?: number | null },
  point: { x: number; y: number }
): { x: number; y: number } {
  const deg = itemRotationDeg(item);
  const height = item.height ?? 0;
  if (deg === 0) return { x: point.x + item.posX, y: point.y + item.posY };
  if (deg === 90) return { x: item.posX + item.width - point.y, y: item.posY + point.x };
  if (deg === 180) return { x: item.posX + item.width - point.x, y: item.posY + height - point.y };
  return { x: item.posX + point.y, y: item.posY + height - point.x };
}

/**
 * SVG transform placing an item at its packed position.
 *
 * maxrects-packer's `Rectangle.rot` setter swaps `_width`/`_height` as a
 * side effect (verified empirically by forcing a real rotation and
 * inspecting the output), so `width`/`height` as stored ALREADY reflect the
 * on-sheet footprint, not the item's pre-rotation size — when `rotated`,
 * `width` is the original content height and `height` is the original
 * content width. The drawn content itself (computed in its own natural,
 * unrotated orientation) must be rotated to align with that footprint.
 */
export function getItemTransform(
  item: { posX: number; posY: number; width: number; height?: number; rotated?: boolean; rotationDeg?: number | null }
): string {
  const deg = itemRotationDeg(item);
  const height = item.height ?? 0;
  if (deg === 0) return `translate(${item.posX}, ${item.posY})`;
  if (deg === 90) return `translate(${item.posX + item.width}, ${item.posY}) rotate(90)`;
  if (deg === 180) return `translate(${item.posX + item.width}, ${item.posY + height}) rotate(180)`;
  return `translate(${item.posX}, ${item.posY + height}) rotate(270)`;
}

/**
 * Recovers the item's true (pre-rotation) content width/height from its
 * stored, possibly-swapped width/height — needed anywhere we size or
 * position something in the content's own local coordinate space (e.g. a
 * fallback placeholder box, or a label positioned relative to content
 * height), as opposed to the on-sheet footprint (which uses width/height
 * directly, unswapped).
 */
export function getContentSize(
  item: Pick<StagingItemPayload, "width" | "height" | "rotated"> & { rotationDeg?: number | null }
): { width: number; height: number } {
  const deg = itemRotationDeg(item);
  return deg === 90 || deg === 270
    ? { width: item.height, height: item.width }
    : { width: item.width, height: item.height };
}

/**
 * Local-space (x, y) for the receipt-code label drawn beneath each item on
 * the print sheet — placed inside the ITEM_PADDING_BOTTOM_MM waste/gap band
 * trailing the item's own ON-SHEET bottom edge, never inside the item
 * itself. The item's stored width/height IS the outline's own tight
 * bounding box (lib/keychain-render.ts normalizes every outline so it
 * touches all four edges of that box), so a label positioned *inside* near
 * a corner (the old behavior) could collide with the red cut-line for any
 * item whose silhouette runs close to that corner.
 *
 * Deliberately conditional on `item.rotated`, unlike a plain "Y below
 * content.height" formula: this item's own local coordinate space gets
 * rotated 90deg by `getItemTransform` before it lands on the sheet, and
 * local "bottom" (the un-rotated content's own y-axis max) maps to the
 * on-sheet LEFT edge once rotated, not the on-sheet bottom — verified with
 * a direct point-transform simulation, see ITEM_PADDING_RIGHT_MM/BOTTOM_MM's
 * own doc comment (lib/keychain-geometry.ts) for the full reasoning. Since
 * ITEM_PADDING_BOTTOM_MM's generous clearance is reserved trailing the
 * on-sheet bottom specifically (regardless of rotation — see lib/
 * nesting.ts's `findBestNode`), the label's own LOCAL axis that maps to
 * on-sheet Y must swap too: local y (unrotated) vs. local x (rotated), so
 * the label always physically ends up in that same reserved band.
 *
 * Pulling the coordinate back from the band's own far edge by
 * RECEIPT_LABEL_BOTTOM_CLEARANCE_MM (rather than sitting right on it)
 * reserves room for the label font's descenders — without it, a 2.5mm
 * font's glyphs would unavoidably bleed past the boundary into the next
 * item's cut-line (font height alone would exceed the remaining gap). See
 * RECEIPT_LABEL_FONT_SIZE_MM's own doc comment for the font-size side of
 * that math.
 */
export function getReceiptLabelPosition(
  item: Pick<StagingItemPayload, "width" | "height" | "rotated">
): { x: number; y: number } {
  const content = getContentSize(item);
  const trailing = ITEM_PADDING_BOTTOM_MM - RECEIPT_LABEL_BOTTOM_CLEARANCE_MM;
  return item.rotated ? { x: content.width + trailing, y: 0.5 } : { x: 0.5, y: content.height + trailing };
}
