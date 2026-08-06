/**
 * MaxRects free-rectangle bin packer, scored by Best-Short-Side-Fit (with a
 * Bottom-Left tie-break), for arranging cut items onto a fixed-size print
 * sheet.
 *
 * History of this module, each step driven by a real observed failure (a
 * physical print test, then three nesting screenshots), not assumed from
 * theory:
 *
 * 1. Originally BSSF via the `maxrects-packer` npm package, WITHOUT
 *    disciplined largest-area-first pre-sorting. BSSF scores every free
 *    rectangle by how tightly it matches the new item's *dimensions*
 *    (`Math.min(freeRect.width - item.width, freeRect.height -
 *    item.height)`), not by how close that free rectangle is to the sheet's
 *    top-left corner. On a *sparse* sheet (a handful of items on a large
 *    sheet, processed in whatever order they happened to be enqueued) that
 *    picked free rectangles far from the already-used area simply because
 *    their size happened to match more tightly, scattering items toward the
 *    edges and leaving a large gap in the *middle* of the sheet.
 * 2. Replaced with a shelf/row packer: items filled left-to-right along a
 *    row at a fixed cursor height, wrapping to a new row below the tallest
 *    item placed so far. That fixed the center-hole problem but introduced
 *    a different one: with `allowRotation` on, a single item rotated 90°
 *    into a tall, narrow orientation forced the ENTIRE row's height up to
 *    match it — every shorter neighbor left dead space below itself that a
 *    fixed-height row has no way to reclaim.
 * 3. Replaced with true MaxRects (real free *rectangles*, not fixed-height
 *    rows) scored by the Bottom-Left rule (smallest resulting bottom edge,
 *    then smallest x), plus largest-area-first pre-sorting introduced at
 *    the same time. That fixed the dead-row-space problem, and Bottom-Left
 *    never reintroduced problem 1 — but its pure y/x-position scoring
 *    doesn't account for fit tightness at all, so it would sometimes leave
 *    a small, snugly-matching gap in a corner unfilled in favor of a
 *    position with a marginally smaller y.
 * 4. Tried the Contact Point Rule (prefer whichever candidate's edges touch
 *    the most total length of already-placed items + the sheet's own
 *    border). Backfired badly: touching the sheet border scored its full
 *    raw edge length same as touching a neighbor, so stacking straight down
 *    the left column (border contact + neighbor-above contact, compounding
 *    every time) kept out-scoring branching into a new row (neighbor
 *    contact only) — collapsed the whole layout into a single tall column.
 *    Reverted to Bottom-Left.
 * 5. Switched to Best-Short-Side-Fit. Unlike attempt 1, this now runs
 *    *after* largest-area-first pre-sorting was already in place (added in
 *    step 3) — the biggest items claim contiguous space up front, so by the
 *    time a small item's turn comes, the free-rectangle list is mostly
 *    small leftover gaps near the already-built structure rather than one
 *    giant untouched remainder far away, which is what let BSSF scatter
 *    items in attempt 1. BSSF's whole purpose — snugness, picking whichever
 *    free rectangle wastes the least leftover space — is exactly what fills
 *    those small corner/edge gaps Bottom-Left could walk past. Bottom-Left
 *    remains as a tie-break only, for the rare case two candidates score
 *    identically (most commonly the very first item on an empty sheet).
 *
 * (The installed `maxrects-packer` npm package was checked directly
 * (node_modules/maxrects-packer/lib/maxrects-packer.js's `PACKING_LOGIC`
 * enum) and exposes neither Bottom-Left nor Contact Point — only
 * MAX_AREA/MAX_EDGE (MAX_EDGE *is* BSSF) — so this is a from-scratch
 * implementation of the same well-established MaxRects algorithm
 * (free-rectangle list + guillotine splitting) that library also uses, just
 * with pre-sorting and a tie-break rule it doesn't have.)
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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacementCandidate extends Rect {
  rotated: boolean;
}

/** Bottom-Left rule: smallest bottom edge (y + height) first, then smallest x — true top-left gravity in a Y-down space. */
function isBetterByBottomLeft(a: Rect, b: Rect): boolean {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  if (aBottom !== bBottom) return aBottom < bBottom;
  return a.x < b.x;
}

/**
 * Best-Short-Side-Fit score for placing a (width x height) item into free
 * rectangle `r`: the smaller of the two leftover dimensions once the item
 * is carved out. Smaller is snugger (less wasted margin on the tighter
 * side); ties are broken by Bottom-Left position, not by this score.
 */
function bssfScore(r: Rect, width: number, height: number): number {
  return Math.min(r.width - width, r.height - height);
}

/** Best free rectangle (and orientation) for an item of size (width, height) — smallest BSSF score, ties broken by Bottom-Left — or null if none fits. */
function findBestNode(freeRects: Rect[], width: number, height: number, allowRotation: boolean): PlacementCandidate | null {
  let best: PlacementCandidate | null = null;
  let bestScore = Infinity;

  for (const r of freeRects) {
    if (r.width >= width && r.height >= height) {
      const score = bssfScore(r, width, height);
      const candidate: PlacementCandidate = { x: r.x, y: r.y, width, height, rotated: false };
      if (!best || score < bestScore || (score === bestScore && isBetterByBottomLeft(candidate, best))) {
        best = candidate;
        bestScore = score;
      }
    }
    if (allowRotation && r.width >= height && r.height >= width) {
      const score = bssfScore(r, height, width);
      const candidate: PlacementCandidate = { x: r.x, y: r.y, width: height, height: width, rotated: true };
      if (!best || score < bestScore || (score === bestScore && isBetterByBottomLeft(candidate, best))) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  return best;
}

/**
 * Guillotine split: if `used` overlaps `free`, replace `free` with up to 4
 * new free rectangles covering whatever part of it `used` didn't consume
 * (above, below, left, right). Returns the replacement list (empty if no
 * overlap, in which case the caller should keep `free` as-is).
 */
function splitFreeRect(free: Rect, used: Rect): Rect[] {
  const overlaps =
    used.x < free.x + free.width && used.x + used.width > free.x && used.y < free.y + free.height && used.y + used.height > free.y;
  if (!overlaps) return [];

  const pieces: Rect[] = [];

  if (used.x < free.x + free.width && used.x + used.width > free.x) {
    if (used.y > free.y && used.y < free.y + free.height) {
      pieces.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    if (used.y + used.height < free.y + free.height) {
      pieces.push({
        x: free.x,
        y: used.y + used.height,
        width: free.width,
        height: free.y + free.height - (used.y + used.height),
      });
    }
  }

  if (used.y < free.y + free.height && used.y + used.height > free.y) {
    if (used.x > free.x && used.x < free.x + free.width) {
      pieces.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
    }
    if (used.x + used.width < free.x + free.width) {
      pieces.push({
        x: used.x + used.width,
        y: free.y,
        width: free.x + free.width - (used.x + used.width),
        height: free.height,
      });
    }
  }

  return pieces;
}

/** Drops any free rectangle fully contained within another (redundant free space). */
function pruneFreeRects(freeRects: Rect[]): Rect[] {
  const contains = (a: Rect, b: Rect) =>
    b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;

  return freeRects.filter((rect, i) => !freeRects.some((other, j) => i !== j && contains(other, rect)));
}

class Sheet {
  freeRects: Rect[];

  constructor(usableWidth: number, usableHeight: number, border: number) {
    this.freeRects = [{ x: border, y: border, width: usableWidth, height: usableHeight }];
  }

  /** Places width x height (plus padding reserved around it) if it fits anywhere; returns the placed (unpadded) rect, or null. */
  place(width: number, height: number, padding: number, allowRotation: boolean): PlacementCandidate | null {
    const node = findBestNode(this.freeRects, width + padding, height + padding, allowRotation);
    if (!node) return null;

    // The free-rect search above reserved `padding` extra room so
    // neighboring items always end up with that real physical gap between
    // them; the rect actually handed back to the caller (and used to split
    // the free list) is the item's own true, unpadded footprint.
    const placed: PlacementCandidate = {
      x: node.x,
      y: node.y,
      width: node.width - padding,
      height: node.height - padding,
      rotated: node.rotated,
    };
    const usedForSplit: Rect = { x: node.x, y: node.y, width: node.width, height: node.height };

    const next: Rect[] = [];
    for (const free of this.freeRects) {
      const pieces = splitFreeRect(free, usedForSplit);
      if (pieces.length === 0) next.push(free);
      else next.push(...pieces);
    }
    this.freeRects = pruneFreeRects(next);

    return placed;
  }
}

/**
 * Packs `items` onto as many `sheetWidth` x `sheetHeight` sheets as needed,
 * keeping `padding` clearance between every item and around the sheet's own
 * edges (matching the physical gap a laser needs between neighboring cuts).
 *
 * Items are sorted largest-area-first before placing — big items claim
 * space while the most contiguous room is still available, small items fill
 * in around and underneath them afterward.
 *
 * An item that cannot fit `sheetWidth` x `sheetHeight` in any allowed
 * orientation (larger than the sheet itself) is silently dropped — no
 * packer could ever place it at this sheet size either.
 */
export function packMaxRects<T>(
  items: NestableRect<T>[],
  sheetWidth: number,
  sheetHeight: number,
  padding: number,
  allowRotation: boolean
): PackedRect<T>[] {
  const usableWidth = sheetWidth - 2 * padding;
  const usableHeight = sheetHeight - 2 * padding;

  const sorted = items.slice().sort((a, b) => b.width * b.height - a.width * a.height);

  const results: PackedRect<T>[] = [];
  const sheets: Sheet[] = [new Sheet(usableWidth, usableHeight, padding)];

  for (const item of sorted) {
    const fitsAtAll =
      (item.width <= usableWidth && item.height <= usableHeight) ||
      (allowRotation && item.height <= usableWidth && item.width <= usableHeight);
    if (!fitsAtAll) continue;

    let sheetIndex = sheets.length - 1;
    let placement = sheets[sheetIndex].place(item.width, item.height, padding, allowRotation);

    if (!placement) {
      sheets.push(new Sheet(usableWidth, usableHeight, padding));
      sheetIndex = sheets.length - 1;
      placement = sheets[sheetIndex].place(item.width, item.height, padding, allowRotation);
    }

    // Guaranteed non-null: `fitsAtAll` already confirmed this item fits the
    // sheet's full usable area in some orientation, and a fresh sheet's
    // free-rect list starts as exactly that full usable area.
    if (placement) {
      results.push({ ...placement, sheetIndex, data: item.data });
    }
  }

  return results;
}
