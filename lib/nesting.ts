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

/**
 * Best free rectangle (and orientation) for an item whose TRUE (pre-
 * rotation) size is (trueWidth, trueHeight) — smallest BSSF score, ties
 * broken by Bottom-Left — or null if none fits.
 *
 * `padRight`/`padBottom` are trailing clearances applied in ON-SHEET space,
 * always: whichever true dimension ends up as the on-sheet width for a
 * given candidate gets `padRight` added, and whichever ends up as the
 * on-sheet height gets `padBottom` added — for the unrotated candidate
 * that's (trueWidth+padRight, trueHeight+padBottom); for the rotated one,
 * true width/height swap roles, so it's (trueHeight+padRight,
 * trueWidth+padBottom). This is what makes asymmetric padding (e.g. a
 * generous trailing bottom margin for a receipt-code label, tight
 * everywhere else) behave identically regardless of which way the packer
 * happens to rotate an item — see keychain-geometry.ts's ITEM_PADDING_
 * RIGHT_MM/BOTTOM_MM doc comment for why a naive "inflate height before
 * packing" approach gets this wrong (the padding ends up on physically the
 * wrong side of a rotated item once lib/staging-transform.ts's rotate(90)
 * transform is applied).
 */
function findBestNode(
  freeRects: Rect[],
  trueWidth: number,
  trueHeight: number,
  padRight: number,
  padBottom: number,
  allowRotation: boolean
): PlacementCandidate | null {
  let best: PlacementCandidate | null = null;
  let bestScore = Infinity;

  const width = trueWidth + padRight;
  const height = trueHeight + padBottom;
  const rotatedWidth = trueHeight + padRight;
  const rotatedHeight = trueWidth + padBottom;

  for (const r of freeRects) {
    if (r.width >= width && r.height >= height) {
      const score = bssfScore(r, width, height);
      const candidate: PlacementCandidate = { x: r.x, y: r.y, width, height, rotated: false };
      if (!best || score < bestScore || (score === bestScore && isBetterByBottomLeft(candidate, best))) {
        best = candidate;
        bestScore = score;
      }
    }
    if (allowRotation && r.width >= rotatedWidth && r.height >= rotatedHeight) {
      const score = bssfScore(r, rotatedWidth, rotatedHeight);
      const candidate: PlacementCandidate = { x: r.x, y: r.y, width: rotatedWidth, height: rotatedHeight, rotated: true };
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

  /** Removes `used` (already expanded to include any trailing padding) from every free rect, splitting/pruning as needed. */
  private carve(used: Rect): void {
    const next: Rect[] = [];
    for (const free of this.freeRects) {
      const pieces = splitFreeRect(free, used);
      if (pieces.length === 0) next.push(free);
      else next.push(...pieces);
    }
    this.freeRects = pruneFreeRects(next);
  }

  /**
   * Places a TRUE (pre-rotation) `width x height` item, reserving
   * `padRight`/`padBottom` trailing clearance in ON-SHEET space (see
   * `findBestNode`'s own doc comment for why those apply post-rotation,
   * not pre-rotation) if it fits anywhere; returns the placed (unpadded,
   * on-sheet) rect, or null.
   */
  place(width: number, height: number, padRight: number, padBottom: number, allowRotation: boolean): PlacementCandidate | null {
    const node = findBestNode(this.freeRects, width, height, padRight, padBottom, allowRotation);
    if (!node) return null;

    // findBestNode already computed node.width/height as the on-sheet
    // footprint (post-rotation-swap, if any) plus padRight/padBottom — so
    // subtracting those back out here is unconditional, no rotated branch
    // needed, unlike the old single-scalar-padding version.
    const placed: PlacementCandidate = {
      x: node.x,
      y: node.y,
      width: node.width - padRight,
      height: node.height - padBottom,
      rotated: node.rotated,
    };
    this.carve({ x: node.x, y: node.y, width: node.width, height: node.height });

    return placed;
  }

  /**
   * Removes the space occupied by an already-placed item — plus the same
   * trailing padRight/padBottom buffer `place()` would have reserved for
   * it — from this (otherwise fresh) sheet's free-rect list, without
   * emitting a new placement. `rect` is already the ON-SHEET footprint (see
   * `ExistingPlacement`), so no rotation swap is needed here — unlike
   * `place()`, that decision was already made when it was first placed.
   * Used to "replay" a sheet's existing occupied footprint before appending
   * more items into whatever room is left (see `packIntoExistingSheet`
   * below), so an appended item can never land on top of, or closer than
   * padRight/padBottom to, something already there.
   */
  reserve(rect: Rect, padRight: number, padBottom: number): void {
    this.carve({ x: rect.x, y: rect.y, width: rect.width + padRight, height: rect.height + padBottom });
  }
}

/**
 * Packs `items` onto as many `sheetWidth` x `sheetHeight` sheets as needed,
 * keeping `paddingRight`/`paddingBottom` clearance — in ON-SHEET space,
 * always, regardless of whether a given item ends up rotated — trailing
 * each item and around the sheet's own edges (matching the physical gap a
 * laser needs between neighboring cuts). Passing the same value for both
 * reproduces the old uniform-padding behavior exactly (e.g. the mahar
 * module's own nesting, which has no asymmetric-clearance need); the
 * keychain module passes a tight `paddingRight` and a larger `paddingBottom`
 * to leave room for its receipt-code label without widening every
 * horizontal gap on the sheet to match — see keychain-geometry.ts's
 * ITEM_PADDING_RIGHT_MM/BOTTOM_MM.
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
  paddingRight: number,
  paddingBottom: number,
  allowRotation: boolean
): PackedRect<T>[] {
  // The sheet's own outer border uses paddingRight on every side (not a
  // mix of paddingRight/paddingBottom) — it's the tight, "don't waste
  // sheet-edge margin" value; the generous paddingBottom clearance instead
  // comes from each individual item's own trailing reservation below it
  // (including the last row, whose trailing reservation is bounded by this
  // same tight border, not doubled up with it).
  const border = paddingRight;
  const usableWidth = sheetWidth - 2 * border;
  const usableHeight = sheetHeight - 2 * border;

  const sorted = items.slice().sort((a, b) => b.width * b.height - a.width * a.height);

  const results: PackedRect<T>[] = [];
  const sheets: Sheet[] = [new Sheet(usableWidth, usableHeight, border)];

  for (const item of sorted) {
    const fitsAtAll =
      (item.width <= usableWidth && item.height <= usableHeight) ||
      (allowRotation && item.height <= usableWidth && item.width <= usableHeight);
    if (!fitsAtAll) continue;

    let sheetIndex = sheets.length - 1;
    let placement = sheets[sheetIndex].place(item.width, item.height, paddingRight, paddingBottom, allowRotation);

    if (!placement) {
      sheets.push(new Sheet(usableWidth, usableHeight, border));
      sheetIndex = sheets.length - 1;
      placement = sheets[sheetIndex].place(item.width, item.height, paddingRight, paddingBottom, allowRotation);
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

/** An already-placed rect on the sheet being appended to — its on-sheet footprint (post-rotation, matching PackedRect.width/height's convention). */
export interface ExistingPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fits `items` into whatever room is left on a single sheet that already
 * holds `existing` placed rects, WITHOUT moving or re-packing any of them —
 * the "Tambahkan ke Batch Aktif" (append-to-active-batch) feature's core:
 * a staging sheet already sent to the operator must never have its existing
 * layout reshuffled underneath it.
 *
 * Reconstructs the sheet's free-rectangle state by replaying `existing` as
 * carved-out space (each expanded by paddingRight/paddingBottom, exactly
 * like a real `place()` call would have left it — see `Sheet.reserve`),
 * then packs `items`
 * (largest-area-first, same as `packMaxRects`) into what's left of a single
 * sheet only — never spills onto a second one, since there's no second sheet
 * to append into here.
 *
 * Returns every item that fit (`fit`) and every item that didn't
 * (`unfit`) — deliberately not a single "some items got placed" call: the
 * caller (app/api/staging/sheets/[sheetId]/append/route.ts) treats *any*
 * `unfit` entry as a reason to reject the whole append rather than silently
 * committing a partial batch, so an operator never gets a batch silently
 * missing names they explicitly selected.
 */
export function packIntoExistingSheet<T>(
  existing: ExistingPlacement[],
  items: NestableRect<T>[],
  sheetWidth: number,
  sheetHeight: number,
  paddingRight: number,
  paddingBottom: number,
  allowRotation: boolean
): { fit: PackedRect<T>[]; unfit: NestableRect<T>[] } {
  const border = paddingRight;
  const usableWidth = sheetWidth - 2 * border;
  const usableHeight = sheetHeight - 2 * border;

  const sheet = new Sheet(usableWidth, usableHeight, border);
  for (const rect of existing) {
    sheet.reserve(rect, paddingRight, paddingBottom);
  }

  const sorted = items.slice().sort((a, b) => b.width * b.height - a.width * a.height);

  const fit: PackedRect<T>[] = [];
  const unfit: NestableRect<T>[] = [];

  for (const item of sorted) {
    const fitsAtAll =
      (item.width <= usableWidth && item.height <= usableHeight) ||
      (allowRotation && item.height <= usableWidth && item.width <= usableHeight);
    if (!fitsAtAll) {
      unfit.push(item);
      continue;
    }

    const placement = sheet.place(item.width, item.height, paddingRight, paddingBottom, allowRotation);
    if (!placement) {
      unfit.push(item);
      continue;
    }

    fit.push({ ...placement, sheetIndex: 0, data: item.data });
  }

  return { fit, unfit };
}
