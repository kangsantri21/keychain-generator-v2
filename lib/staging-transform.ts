import { ITEM_PADDING_MM, RECEIPT_LABEL_BOTTOM_CLEARANCE_MM } from "@/lib/keychain-geometry";
import type { StagingItemPayload } from "@/lib/staging-types";

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
  item: Pick<StagingItemPayload, "posX" | "posY" | "width" | "rotated">
): string {
  if (!item.rotated) {
    return `translate(${item.posX}, ${item.posY})`;
  }
  return `translate(${item.posX + item.width}, ${item.posY}) rotate(90)`;
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
  item: Pick<StagingItemPayload, "width" | "height" | "rotated">
): { width: number; height: number } {
  return item.rotated
    ? { width: item.height, height: item.width }
    : { width: item.width, height: item.height };
}

/**
 * Y coordinate (baseline, in the item's own local space) for the
 * receipt-code label drawn beneath each item on the print sheet — placed
 * inside the ITEM_PADDING_MM waste/gap band below the item's own bottom
 * edge, never inside the item itself. The item's stored width/height IS the
 * outline's own tight bounding box (lib/keychain-render.ts normalizes every
 * outline so it touches all four edges of that box), so a label positioned
 * *inside* near the bottom-left corner (the old behavior) could collide with
 * the red cut-line for any item whose silhouette runs close to that corner.
 *
 * Pulling the baseline up from the bottom of that band by
 * RECEIPT_LABEL_BOTTOM_CLEARANCE_MM (rather than sitting it right on the
 * band's own lower edge) reserves room for the label font's descenders —
 * without it, the *previous* 2mm-padding version of this function put the
 * baseline exactly on the boundary, so a 2.5mm font's glyphs unavoidably
 * bled past that boundary into the next item's cut-line (font height alone
 * exceeded the entire gap). See ITEM_PADDING_MM/RECEIPT_LABEL_FONT_SIZE_MM's
 * own doc comments (lib/keychain-geometry.ts) for the full reasoning.
 */
export function getReceiptLabelY(item: Pick<StagingItemPayload, "width" | "height" | "rotated">): number {
  return getContentSize(item).height + ITEM_PADDING_MM - RECEIPT_LABEL_BOTTOM_CLEARANCE_MM;
}
