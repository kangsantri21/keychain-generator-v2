import { ITEM_PADDING_MM } from "@/lib/keychain-geometry";
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
 * Y coordinate (in the item's own local space) for the receipt-code label
 * drawn beneath each item on the print sheet — placed just past the
 * content's own bottom edge, never inside it. The item's stored width/height
 * IS the outline's own tight bounding box (lib/keychain-render.ts normalizes
 * every outline so it touches all four edges of that box), so a label
 * positioned *inside* near the bottom-left corner (the old behavior) could
 * collide with the red cut-line for any item whose silhouette runs close to
 * that corner. ITEM_PADDING_MM is the same real gap the packer already
 * keeps between neighboring items (lib/nesting.ts), so the label sits in
 * that existing clearance instead of claiming any new space.
 */
export function getReceiptLabelY(item: Pick<StagingItemPayload, "width" | "height" | "rotated">): number {
  return getContentSize(item).height + ITEM_PADDING_MM;
}
