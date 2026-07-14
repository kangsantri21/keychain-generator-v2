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
