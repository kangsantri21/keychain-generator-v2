/**
 * A "selection" identifies one customer name within one order item, as
 * `"<orderItemId>:<nameIndex>"` — the same rowId the Order Queue dashboard
 * (app/order-queue/page.tsx) uses for its per-name checkboxes, so the client
 * can send it straight through with no extra mapping. Shared by both nesting
 * entry points: creating new sheets (app/api/staging/nest/route.ts) and
 * appending into an existing one
 * (app/api/staging/sheets/[sheetId]/append/route.ts).
 */
export function parseSelections(raw: unknown): Map<number, Set<number>> {
  const byItem = new Map<number, Set<number>>();
  if (!Array.isArray(raw)) return byItem;

  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const [itemIdRaw, indexRaw] = entry.split(":");
    const itemId = Number(itemIdRaw);
    const nameIndex = Number(indexRaw);
    if (!Number.isInteger(itemId) || !Number.isInteger(nameIndex) || nameIndex < 0) continue;

    const indexes = byItem.get(itemId) ?? new Set<number>();
    indexes.add(nameIndex);
    byItem.set(itemId, indexes);
  }

  return byItem;
}
