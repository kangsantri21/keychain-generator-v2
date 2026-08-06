/**
 * Top-left "shelf" (row-based) bin packer for arranging cut items onto a
 * fixed-size print sheet.
 *
 * This replaces an earlier MaxRects/Best-Short-Side-Fit packer
 * (`maxrects-packer`). BSSF is a genuinely strong *density* heuristic — for
 * each item it scans every current free rectangle and places the item in
 * whichever one is the *tightest* fit (`Math.min(freeRect.width - item.width,
 * freeRect.height - item.height)`), not necessarily the one closest to the
 * sheet's top-left corner. That is correct and effective once a sheet is
 * fairly full, but for a *sparse* sheet (a handful of items on a large
 * sheet — the normal case for a small batch of orders) it can legitimately
 * choose a free rectangle far from the already-used area simply because its
 * dimensions happen to match the new item more tightly, scattering items
 * toward the sheet's edges/corners and leaving a large contiguous gap in the
 * *middle* — exactly the "bolong tengah" (hole in the middle) behavior
 * reported from a physical print test. Verified by reading
 * node_modules/maxrects-packer/lib/maxrects-bin.js's `findNode()` directly
 * before writing this replacement, not just assumed from the symptom.
 *
 * Shelf packing sacrifices a little of BSSF's raw density in exchange for a
 * placement order that is simple, predictable, and always leaves waste in
 * one place: items fill left-to-right along a "shelf" (row) at the current
 * cursor height; once a row can't fit the next item, a new row starts right
 * below the tallest item placed in the row above; once a sheet runs out of
 * vertical room, a new sheet starts. Every item before the last is packed
 * edge-to-edge against its neighbors, so the only unused space is the
 * horizontal sliver at the end of a row (bounded by that row's own height)
 * and the sheet's final, incomplete row — both structurally pinned to the
 * *end* of the layout, never the middle.
 */

export interface NestableRect<T> {
  width: number;
  height: number;
  data: T;
}

export interface PackedRect<T> {
  x: number;
  y: number;
  /** On-sheet footprint width — already swapped with height if `rotated`. */
  width: number;
  /** On-sheet footprint height — already swapped with width if `rotated`. */
  height: number;
  rotated: boolean;
  /** 0-based index of the sheet this rect was placed on. */
  sheetIndex: number;
  data: T;
}

interface Candidate {
  w: number;
  h: number;
  rotated: boolean;
}

/**
 * Packs `items` onto as many `sheetWidth` x `sheetHeight` sheets as needed,
 * keeping `padding` clearance between every item and around the sheet's own
 * edges (matching the physical gap a laser needs between neighboring cuts).
 *
 * Items are sorted largest-dimension-first before placing — the same
 * ordering `maxrects-packer`'s own `PACKING_LOGIC.MAX_EDGE` sort used
 * (`Math.max(width, height)` descending) — so big items claim space while
 * the most contiguous room is still available and small items fill in
 * around them, rather than the reverse.
 *
 * An item that cannot fit `sheetWidth` x `sheetHeight` in any allowed
 * orientation (larger than the sheet itself) is silently dropped — it could
 * never have been placed by any packer at this sheet size either.
 */
export function packShelves<T>(
  items: NestableRect<T>[],
  sheetWidth: number,
  sheetHeight: number,
  padding: number,
  allowRotation: boolean
): PackedRect<T>[] {
  const usableWidth = sheetWidth - 2 * padding;
  const usableHeight = sheetHeight - 2 * padding;

  const sorted = items.slice().sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));

  const results: PackedRect<T>[] = [];

  let sheetIndex = 0;
  let cursorX = padding;
  let cursorY = padding;
  let rowHeight = 0;

  function startNewRow(): void {
    cursorX = padding;
    cursorY += rowHeight + padding;
    rowHeight = 0;
  }

  function startNewSheet(): void {
    sheetIndex += 1;
    cursorX = padding;
    cursorY = padding;
    rowHeight = 0;
  }

  function tryPlaceInCurrentRow(candidates: Candidate[], data: T): boolean {
    let best: Candidate | null = null;
    for (const candidate of candidates) {
      const fitsHorizontally = cursorX + candidate.w <= sheetWidth - padding;
      const fitsVertically = cursorY + candidate.h <= sheetHeight - padding;
      if (!fitsHorizontally || !fitsVertically) continue;
      // Prefer whichever fitting orientation keeps this row shortest — a
      // tighter row leaves more usable height for the rows still to come.
      if (!best || candidate.h < best.h) best = candidate;
    }
    if (!best) return false;

    results.push({ x: cursorX, y: cursorY, width: best.w, height: best.h, rotated: best.rotated, sheetIndex, data });
    cursorX += best.w + padding;
    rowHeight = Math.max(rowHeight, best.h);
    return true;
  }

  for (const item of sorted) {
    const candidates: Candidate[] = [];
    if (item.width <= usableWidth && item.height <= usableHeight) {
      candidates.push({ w: item.width, h: item.height, rotated: false });
    }
    if (allowRotation && item.width !== item.height && item.height <= usableWidth && item.width <= usableHeight) {
      candidates.push({ w: item.height, h: item.width, rotated: true });
    }
    // Too big for this sheet size in every allowed orientation — no packer
    // could ever place it; drop rather than loop forever.
    if (candidates.length === 0) continue;

    if (tryPlaceInCurrentRow(candidates, item.data)) continue;

    startNewRow();
    if (tryPlaceInCurrentRow(candidates, item.data)) continue;

    startNewSheet();
    // Guaranteed to succeed: candidates were pre-filtered to fit the sheet's
    // full usable area, and a fresh sheet's cursor starts at that area's own
    // top-left corner with nothing yet placed.
    tryPlaceInCurrentRow(candidates, item.data);
  }

  return results;
}
