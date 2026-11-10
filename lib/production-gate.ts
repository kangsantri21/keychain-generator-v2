/**
 * Production validation gate for keychain sheets — pure functions, safe on
 * server and client. Used by Production Nesting (before anything is
 * staged), by GET /api/staging (status shown to the operator) and by the
 * batch lock (POST /api/print-batches), so all three judge a sheet with the
 * same rules.
 *
 * Two layout profiles exist and are told apart by geometry alone (no DB
 * marker): the legacy flat packer always starts each sheet at its 2 mm
 * border, while Production Nesting keeps every item at least SHEET_MARGIN
 * (5 mm) from the media edge.
 *   - legacy:     universal checks only (the legacy engine is unchanged).
 *   - production: universal checks + margin 5, PART_GAP 2 inside a receipt,
 *                 receipts >= 2 mm apart side by side or stacked (Production
 *                 receipt-group gaps), artwork clear of the 4 camera fiducials, one
 *                 receipt on one sheet.
 * Universal checks: expected == placed, no duplicate, no missing, artwork
 * size unchanged (only a 90° swap when rotated), inside 310 x 470, no overlap.
 */
import { FIDUCIAL_RADIUS_MM, ITEM_PADDING_BOTTOM_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { FIDUCIAL_CLEARANCE_MM, PART_GAP_MM, PRODUCTION_GROUP_GAP_X_MM, PRODUCTION_GROUP_GAP_Y_MM, SHEET_MARGIN_MM } from "@/lib/nesting/grouped-nesting-config";

export type LayoutProfile = "production" | "legacy";

export interface PlacedItem {
  /** Stable identity of the placed unit (e.g. staging item id). */
  key: string;
  orderId: number;
  sheet: number;
  posX: number;
  posY: number;
  /** On-sheet footprint (already swapped when rotated). */
  width: number;
  height: number;
  rotated: boolean;
  /** The artwork's own (unrotated) size it must still have. */
  expectedWidth: number;
  expectedHeight: number;
}

export interface GateResult {
  ok: boolean;
  errors: string[];
  profiles: Record<string, LayoutProfile>;
}

const EPS = 1e-6;
/** Size tolerance: render sizes are rounded to 0.001 mm when stored. */
const SIZE_EPS = 0.01;

const rectOf = (p: Pick<PlacedItem, "posX" | "posY" | "width" | "height">) => ({ x: p.posX, y: p.posY, w: p.width, h: p.height });
type R = ReturnType<typeof rectOf>;
const separation = (a: R, b: R) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
/** Clear distance between two rects along x / along y (negative = their projections overlap). */
const axisSeparation = (a: R, b: R) => ({
  dx: Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)),
  dy: Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)),
});
const overlaps = (a: R, b: R) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;

/** Centers of the 4 camera fiducials — the same positions lib/export-print-svg.ts and lib/export-dxf.ts draw/cut. */
export const FIDUCIAL_CENTERS = [FIDUCIAL_RADIUS_MM, SHEET_WIDTH_MM - FIDUCIAL_RADIUS_MM].flatMap((x) =>
  [FIDUCIAL_RADIUS_MM, SHEET_HEIGHT_MM - FIDUCIAL_RADIUS_MM].map((y) => ({ x, y }))
);

/** Clear distance from an item's footprint to the nearest fiducial circle's edge (mm). */
export function fiducialDistance(item: Pick<PlacedItem, "posX" | "posY" | "width" | "height">): number {
  return Math.min(
    ...FIDUCIAL_CENTERS.map((c) => {
      const dx = Math.max(item.posX - c.x, 0, c.x - (item.posX + item.width));
      const dy = Math.max(item.posY - c.y, 0, c.y - (item.posY + item.height));
      return Math.hypot(dx, dy) - FIDUCIAL_RADIUS_MM;
    })
  );
}

/**
 * Production spacing between two receipt boxes: side by side they need
 * PRODUCTION_GROUP_GAP_X_MM, stacked PRODUCTION_GROUP_GAP_Y_MM (same rule the outer pack
 * reserves per axis). Overlapping projections on both axes always fail.
 */
export function receiptsSeparated(a: R, b: R): boolean {
  const { dx, dy } = axisSeparation(a, b);
  return dx >= PRODUCTION_GROUP_GAP_X_MM - EPS || dy >= PRODUCTION_GROUP_GAP_Y_MM - EPS;
}

/** Production layouts keep every item >= SHEET_MARGIN from the media edge; the legacy packer starts at 2 mm. */
export function classifySheetProfile(items: Pick<PlacedItem, "posX" | "posY">[]): LayoutProfile {
  if (items.length === 0) return "legacy";
  const minX = Math.min(...items.map((i) => i.posX));
  const minY = Math.min(...items.map((i) => i.posY));
  return minX >= SHEET_MARGIN_MM - EPS && minY >= SHEET_MARGIN_MM - EPS ? "production" : "legacy";
}

function summarizeList(prefix: string, list: string[], limit = 5): string {
  return `${prefix}: ${list.slice(0, limit).join(", ")}${list.length > limit ? ` (+${list.length - limit} lagi)` : ""}`;
}

/**
 * Validates placed items across sheets. `expectedKeys` is the full set of
 * units that must be present exactly once. `profile` forces a profile for
 * every sheet ("production" for a fresh Production Nesting run); "auto"
 * classifies each sheet by geometry.
 */
export function validatePlacedSheets(items: PlacedItem[], expectedKeys: string[], profile: LayoutProfile | "auto" = "auto"): GateResult {
  const errors: string[] = [];
  const profiles: Record<string, LayoutProfile> = {};

  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((k) => !counts.has(k));
  const unexpected = [...counts.keys()].filter((k) => !expected.has(k));
  if (items.length !== expectedKeys.length) errors.push(`Jumlah item tidak cocok: diharapkan ${expectedKeys.length}, tersusun ${items.length}`);
  if (duplicates.length) errors.push(summarizeList(`${duplicates.length} item duplikat`, duplicates));
  if (missing.length) errors.push(summarizeList(`${missing.length} item hilang`, missing));
  if (unexpected.length) errors.push(summarizeList(`${unexpected.length} item tidak dikenal`, unexpected));

  const resized = items.filter((i) => {
    const [w, h] = i.rotated ? [i.expectedHeight, i.expectedWidth] : [i.expectedWidth, i.expectedHeight];
    return !(Math.abs(i.width - w) <= SIZE_EPS && Math.abs(i.height - h) <= SIZE_EPS);
  });
  if (resized.length) errors.push(summarizeList(`${resized.length} item berubah ukuran / artwork tidak cocok`, resized.map((i) => i.key)));

  const outside = items.filter((i) => i.posX < -EPS || i.posY < -EPS || i.posX + i.width > SHEET_WIDTH_MM + EPS || i.posY + i.height > SHEET_HEIGHT_MM + EPS);
  if (outside.length) errors.push(summarizeList(`${outside.length} item keluar media ${SHEET_WIDTH_MM}x${SHEET_HEIGHT_MM}`, outside.map((i) => i.key)));

  const sheets = [...new Set(items.map((i) => i.sheet))].sort((a, b) => a - b);
  const sheetsByOrder = new Map<number, Set<number>>();
  for (const item of items) sheetsByOrder.set(item.orderId, (sheetsByOrder.get(item.orderId) ?? new Set()).add(item.sheet));

  for (const sheet of sheets) {
    const list = items.filter((i) => i.sheet === sheet);
    const sheetProfile = profile === "auto" ? classifySheetProfile(list) : profile;
    profiles[String(sheet)] = sheetProfile;
    const label = sheets.length > 1 ? `Lembar ${sheet}: ` : "";

    let overlapPairs = 0;
    let partGap = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = rectOf(list[i]);
        const b = rectOf(list[j]);
        if (overlaps(a, b)) overlapPairs++;
        else if (sheetProfile === "production" && list[i].orderId === list[j].orderId && separation(a, b) < PART_GAP_MM - EPS) partGap++;
      }
    }
    if (overlapPairs) errors.push(`${label}${overlapPairs} pasang item saling tumpang tindih`);
    if (sheetProfile !== "production") continue;

    if (partGap) errors.push(`${label}${partGap} pasang item dalam satu resi berjarak < PART_GAP ${PART_GAP_MM} mm`);
    const marginBreaks = list.filter(
      (i) => i.posX < SHEET_MARGIN_MM - EPS || i.posY < SHEET_MARGIN_MM - EPS || i.posX + i.width > SHEET_WIDTH_MM - SHEET_MARGIN_MM + EPS || i.posY + i.height > SHEET_HEIGHT_MM - SHEET_MARGIN_MM + EPS
    );
    if (marginBreaks.length) errors.push(summarizeList(`${label}${marginBreaks.length} item melewati margin ${SHEET_MARGIN_MM} mm`, marginBreaks.map((i) => i.key)));

    const boxes = receiptBoxes(list);
    const tooClose: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!receiptsSeparated(boxes[i].rect, boxes[j].rect)) tooClose.push(`${boxes[i].orderId}/${boxes[j].orderId}`);
      }
    }
    if (tooClose.length) {
      errors.push(
        summarizeList(
          `${label}${tooClose.length} pasang resi terlalu dekat (< ${PRODUCTION_GROUP_GAP_X_MM} mm kiri-kanan / < ${PRODUCTION_GROUP_GAP_Y_MM} mm atas-bawah, resi tercampur)`,
          tooClose
        )
      );
    }

    const nearFiducial = list.filter((i) => fiducialDistance(i) < FIDUCIAL_CLEARANCE_MM - EPS);
    if (nearFiducial.length) {
      errors.push(summarizeList(`${label}${nearFiducial.length} item terlalu dekat marker kamera (< ${FIDUCIAL_CLEARANCE_MM} mm)`, nearFiducial.map((i) => i.key)));
    }

    const split = boxes.filter((b) => (sheetsByOrder.get(b.orderId)?.size ?? 1) > 1).map((b) => String(b.orderId));
    if (split.length) errors.push(summarizeList(`${label}${split.length} resi terpecah ke lebih dari satu lembar`, split));
  }

  return { ok: errors.length === 0, errors, profiles };
}

/** One bounding box per receipt on a sheet (Production Nesting keeps every receipt as one compact group). */
export function receiptBoxes(items: Pick<PlacedItem, "orderId" | "posX" | "posY" | "width" | "height">[]) {
  const byOrder = new Map<number, R>();
  for (const item of items) {
    const r = rectOf(item);
    const b = byOrder.get(item.orderId);
    if (!b) byOrder.set(item.orderId, { ...r });
    else {
      const x1 = Math.max(b.x + b.w, r.x + r.w);
      const y1 = Math.max(b.y + b.h, r.y + r.h);
      b.x = Math.min(b.x, r.x);
      b.y = Math.min(b.y, r.y);
      b.w = x1 - b.x;
      b.h = y1 - b.y;
    }
  }
  return [...byOrder.entries()].sort(([a], [b]) => a - b).map(([orderId, rect]) => ({ orderId, rect }));
}

export interface SheetSummary {
  itemCount: number;
  receiptCount: number;
  usedWidth: number;
  usedHeight: number;
  remainingFullWidth: number;
  sideFragment: number;
}

export function summarizeSheet(items: Pick<PlacedItem, "orderId" | "posX" | "posY" | "width" | "height">[]): SheetSummary {
  const usedWidth = items.length ? Math.max(...items.map((i) => i.posX + i.width)) : 0;
  const usedHeight = items.length ? Math.max(...items.map((i) => i.posY + i.height)) : 0;
  return {
    itemCount: items.length,
    receiptCount: new Set(items.map((i) => i.orderId)).size,
    usedWidth,
    usedHeight,
    remainingFullWidth: SHEET_HEIGHT_MM - usedHeight,
    sideFragment: SHEET_WIDTH_MM - usedWidth,
  };
}

/**
 * Whether the per-item receipt label (drawn in the ITEM_PADDING_BOTTOM_MM
 * band under the item's on-sheet footprint, see getReceiptLabelPosition)
 * has that band free. The legacy packer always reserves that band, so for
 * legacy sheets this is always true and nothing changes; on Production
 * Nesting sheets (PART_GAP 2 mm) a label is only drawn where it cannot
 * print over a neighbouring item — typically the bottom row of a receipt,
 * above the ORDER_GAP.
 */
export function receiptLabelFits(
  item: Pick<PlacedItem, "posX" | "posY" | "width" | "height">,
  sheetItems: Pick<PlacedItem, "posX" | "posY" | "width" | "height">[]
): boolean {
  const band = { x: item.posX, y: item.posY + item.height, w: item.width, h: ITEM_PADDING_BOTTOM_MM };
  if (band.y + band.h > SHEET_HEIGHT_MM + EPS) return false;
  return !sheetItems.some((other) => other !== item && overlaps(band, rectOf(other)));
}

/** Placement fields that must be identical between the staged (DB) unit and what is locked/exported. */
export interface StagedPlacement {
  id: number;
  orderId: number;
  templateId: number;
  customerName: string;
  sheetId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
  /** Staging status (carries the explicit nesting-mode marker, lib/staging-mode.ts). */
  status?: string;
}

/**
 * Batch lock source-of-truth check: the submitted sheet must contain exactly
 * the staged units with exactly the staged placement. Returns the layout to
 * save — the submitted payload (render etc.) with placement taken from the
 * staged rows — or the number of mismatches.
 */
export function matchSubmittedToStaged<S extends StagedPlacement>(
  staged: StagedPlacement[],
  submitted: S[]
): { mismatched: number; layout: S[] } {
  const byId = new Map(submitted.map((item) => [item.id, item]));
  const stagedById = new Map(staged.map((row) => [row.id, row]));
  let mismatched = 0;
  for (const row of staged) {
    const item = byId.get(row.id);
    if (
      !item ||
      item.orderId !== row.orderId ||
      item.templateId !== row.templateId ||
      item.customerName !== row.customerName ||
      Math.abs(item.posX - row.posX) > EPS ||
      Math.abs(item.posY - row.posY) > EPS ||
      Math.abs(item.width - row.width) > EPS ||
      Math.abs(item.height - row.height) > EPS ||
      !!item.rotated !== !!row.rotated
    ) {
      mismatched++;
    }
  }
  mismatched += submitted.filter((item) => !stagedById.has(item.id)).length + Math.max(0, submitted.length - new Set(submitted.map((i) => i.id)).size);
  const layout = submitted
    .filter((item) => stagedById.has(item.id))
    .map((item) => {
      const row = stagedById.get(item.id)!;
      return {
        ...item,
        sheetId: row.sheetId,
        posX: row.posX,
        posY: row.posY,
        width: row.width,
        height: row.height,
        rotated: row.rotated,
        ...(row.status !== undefined ? { status: row.status } : {}),
      };
    });
  return { mismatched, layout };
}

/** A receipt that already has active (not completed) units on a Staging sheet. */
export interface StagedReceiptConflict {
  orderId: number;
  sheetIds: number[];
}

/**
 * One receipt = one group = one sheet. A Production run may only take
 * receipts that have NO active staged units yet: staging any unit of a
 * receipt that is already on a sheet would put that receipt on two sheets
 * (or stage its units twice). Returns the conflicting receipts (empty = ok).
 */
export function stagedReceiptConflicts(
  selectedOrderIds: number[],
  activeStagedRows: { orderId: number; sheetId: number; status: string }[]
): StagedReceiptConflict[] {
  const selected = new Set(selectedOrderIds);
  const sheetsByOrder = new Map<number, Set<number>>();
  for (const row of activeStagedRows) {
    if (row.status === "completed" || !selected.has(row.orderId)) continue;
    sheetsByOrder.set(row.orderId, (sheetsByOrder.get(row.orderId) ?? new Set()).add(row.sheetId));
  }
  return [...sheetsByOrder.entries()]
    .sort(([a], [b]) => a - b)
    .map(([orderId, sheets]) => ({ orderId, sheetIds: [...sheets].sort((a, b) => a - b) }));
}

/** Receipts whose units sit on more than one sheet (the hard invariant: exactly one sheet per receipt). */
export function receiptsOnSeveralSheets(units: { orderId: number | null; sheetIndex: number }[]): number[] {
  const sheetsByOrder = new Map<number, Set<number>>();
  for (const u of units) {
    if (u.orderId === null) continue;
    sheetsByOrder.set(u.orderId, (sheetsByOrder.get(u.orderId) ?? new Set()).add(u.sheetIndex));
  }
  return [...sheetsByOrder.entries()].filter(([, s]) => s.size > 1).map(([orderId]) => orderId).sort((a, b) => a - b);
}
