/**
 * Body sent by the Staging Area button "Mulai Susun Lembar Kerja".
 *
 * The old button called `POST /api/staging/nest` with no JSON body. The route
 * requires `selections` (`"<orderItemId>:<nameIndex>"`, see
 * lib/staging-selection.ts) and answers 400 when that list is missing — even
 * when pending receipts are already in the database. Nothing was staged.
 *
 * This request asks the server to load every pending receipt itself and nest
 * those names with Production Nesting. It is not a legacy re-run and it does
 * not invent a layout in the browser.
 */
export const STAGING_START_REQUEST = {
  allPending: true,
  mode: "production-v3",
} as const;

export interface PendingNameSource {
  itemId: number;
  names: readonly string[];
}

/**
 * Name list for receipts that are still pending. Blank names are skipped
 * but keep their original index, so later names on the same item stay aligned
 * with `customerNames`.
 */
export function selectionsForPendingItems(items: readonly PendingNameSource[]): string[] {
  const selections: string[] = [];
  for (const item of items) {
    item.names.forEach((name, index) => {
      if (typeof name !== "string" || name.trim().length === 0) return;
      selections.push(`${item.itemId}:${index}`);
    });
  }
  return selections;
}

/** True when the Staging button asked the server to nest every pending receipt. */
export function isStagingStartRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as { allPending?: unknown }).allPending === true;
}
