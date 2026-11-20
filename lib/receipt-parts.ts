/**
 * Authorized splits of a receipt that does not fit on one 310×470 sheet.
 *
 * The shape-block packer sets `splitPart` / `splitCount` only after a whole
 * receipt fails every rotation. A receipt that fits is never marked. The
 * production gate treats a multi-sheet receipt as legal only when every
 * piece carries that mark and each sheet is exactly one part.
 *
 * Locking one part without the others is feature D. `receiptIsComplete`
 * is the rule D must use: the order becomes completed only when every
 * part is done. The lock and "tandai selesai" routes do not call it yet.
 */

export interface SplitUnit {
  orderId: number;
  sheet: number;
  splitPart?: number | null;
  splitCount?: number | null;
}

/** One part of a receipt (or the whole receipt when it was not split). */
export interface ReceiptPartState {
  splitPart: number | null;
  splitCount: number | null;
  /**
   * True only when every piece of this part is finished. Several rows may
   * describe the same part; one unfinished row keeps the part open.
   */
  done: boolean;
}

/** Printed beside the frame: "RESI 1/2". A whole receipt keeps its code. */
export function receiptPartLabel(code: string, part: number | null | undefined, count: number | null | undefined): string {
  if (part == null || count == null || count < 2 || part < 1 || part > count) return code;
  return `${code} ${part}/${count}`;
}

/**
 * Pieces of one receipt already known to sit on more than one sheet.
 * Legal when they are marked as parts of one oversized receipt: same
 * count >= 2, each sheet is a single part number, and no part number
 * is repeated on another sheet.
 */
export function isAuthorizedOversizedSplit(items: SplitUnit[]): boolean {
  if (items.length === 0) return false;
  const count = items[0].splitCount ?? null;
  if (count == null || count < 2) return false;
  const partBySheet = new Map<number, number>();
  for (const item of items) {
    const part = item.splitPart ?? null;
    if (item.splitCount !== count || part == null || part < 1 || part > count) return false;
    const previous = partBySheet.get(item.sheet);
    if (previous == null) partBySheet.set(item.sheet, part);
    else if (previous !== part) return false;
  }
  const parts = [...partBySheet.values()];
  return new Set(parts).size === parts.length && parts.length >= 2;
}

/** Order ids that occupy several sheets without an authorized oversized split. */
export function unauthorizedSplitOrderIds(items: SplitUnit[]): number[] {
  const byOrder = new Map<number, SplitUnit[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId);
    if (list) list.push(item);
    else byOrder.set(item.orderId, [item]);
  }
  const bad: number[] = [];
  for (const [orderId, list] of byOrder) {
    const sheets = new Set(list.map((item) => item.sheet));
    if (sheets.size <= 1) continue;
    if (!isAuthorizedOversizedSplit(list)) bad.push(orderId);
  }
  return bad.sort((a, b) => a - b);
}

/**
 * A new receipt is complete when every part is done. An unmarked receipt
 * is complete when every row passed in is done. A split is complete only
 * when parts 1..count are all present and done. Feature D calls this
 * before writing `orders.status = completed`.
 */
export function receiptIsComplete(parts: ReceiptPartState[]): boolean {
  if (parts.length === 0) return false;
  const count = parts[0].splitCount ?? null;
  const split = count != null && count >= 2;
  if (!split) return parts.every((part) => part.splitPart == null && part.splitCount == null && part.done);
  if (!parts.every((part) => part.splitCount === count)) return false;
  const doneByPart = new Map<number, boolean>();
  for (const part of parts) {
    if (part.splitPart == null || part.splitPart < 1 || part.splitPart > (count ?? 0)) return false;
    doneByPart.set(part.splitPart, (doneByPart.get(part.splitPart) ?? true) && part.done);
  }
  for (let index = 1; index <= (count ?? 0); index++) {
    if (doneByPart.get(index) !== true) return false;
  }
  return true;
}
