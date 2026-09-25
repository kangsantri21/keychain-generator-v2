import type { MaharLayoutItem } from "@/lib/mahar-types";

/** SVG transform placing an item at its packed position — mirrors lib/staging-transform.ts's getItemTransform (keychain module). */
export function getMaharItemTransform(item: Pick<MaharLayoutItem, "posX" | "posY" | "width" | "rotated">): string {
  if (!item.rotated) {
    return `translate(${item.posX}, ${item.posY})`;
  }
  return `translate(${item.posX + item.width}, ${item.posY}) rotate(90)`;
}

/** Recovers the item's true (pre-rotation) content width/height — mirrors lib/staging-transform.ts's getContentSize. */
export function getMaharContentSize(item: Pick<MaharLayoutItem, "width" | "height" | "rotated">): { width: number; height: number } {
  return item.rotated ? { width: item.height, height: item.width } : { width: item.width, height: item.height };
}
