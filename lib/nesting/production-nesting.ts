/**
 * Production Nesting — the keychain production engine.
 *
 * Runs the proven pipeline unchanged: Grouped V2 → V3A-1/2 slot reflow →
 * V3A-3 compound moves → V3A-4 FAST region repack (no DEEP). Every stage
 * only replaces the layout when it is valid AND strictly better; otherwise
 * the best earlier safe layout is kept (see grouped-nesting-v3.ts). Then
 * every receipt is compacted left/up as a rigid block to the minimum gaps
 * (group-compaction.ts), and only then validated. Receipt labels are not
 * part of nesting at all (lib/receipt-labels.ts runs on the final layout).
 *
 * Production rules are fixed here, not taken from callers: sheet 310 x 470,
 * PART_GAP 2 inside a receipt; between receipts PRODUCTION_GROUP_GAP_X/Y
 * 2 mm on both axes; receipts start SHEET_MARGIN 5 from the left edge and
 * 13 mm from the top (grouped-nesting-config.ts PRODUCTION_SPACING). A
 * result is only usable when `ok` — every item placed exactly once, no
 * unfit, and the independent geometry check (lib/production-gate.ts) clean.
 * One receipt = one group; groups never split across sheets.
 */
import { resolveConfig, type GroupedNestingItem, type GroupedNestingResult } from "./grouped-nesting";
import {
  PART_GAP_MM,
  PRODUCTION_GROUP_GAP_X_MM,
  PRODUCTION_GROUP_GAP_Y_MM,
  PRODUCTION_SPACING,
  SHEET_HEIGHT_MM,
  SHEET_MARGIN_MM,
  SHEET_WIDTH_MM,
} from "./grouped-nesting-config";
import { placeGroup, resultFromGroups, runGroupedNestingV3, validateLayout } from "./grouped-nesting-v3";
import { compactRigidRects, compactionBoundsOf, type CompactionMove } from "./group-compaction";
import { compoundStage } from "./grouped-nesting-v3-compound";
import { regionStage } from "./grouped-nesting-v3-region";
import { validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";

export const PRODUCTION_NESTING_RULES = {
  sheetWidthMm: SHEET_WIDTH_MM,
  sheetHeightMm: SHEET_HEIGHT_MM,
  sheetMarginMm: SHEET_MARGIN_MM,
  partGapMm: PART_GAP_MM,
  groupGapXMm: PRODUCTION_GROUP_GAP_X_MM,
  groupGapYMm: PRODUCTION_GROUP_GAP_Y_MM,
} as const;

/** Production spacing as engine overrides (grouped-nesting-config.ts PRODUCTION_SPACING). */
export const PRODUCTION_SPACING_OVERRIDES = PRODUCTION_SPACING;

export interface ProductionPlacement<T> {
  data: T;
  orderId: number | null;
  sheetIndex: number;
  /** Sheet coordinates (mm); width/height are the ON-SHEET footprint (swapped when rotated), like the legacy packer. */
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
}

export interface ProductionNestingResult<T> {
  ok: boolean;
  /** Human-readable reasons when !ok (Indonesian, shown to the operator). */
  errors: string[];
  placements: ProductionPlacement<T>[];
  sheetCount: number;
  sumUsedHeight: number;
  /** "V3" when a V3 stage (slot reflow / compound / region repack FAST) improved on V2; else the V2 layout was kept. Diagnostic only. */
  engine: "V3" | "V2";
  /** Post-pack group compaction, one entry per receipt (orderId; null = orphan item group). */
  compaction: (Omit<CompactionMove, "key"> & { orderId: number | null })[];
  result: GroupedNestingResult<T>;
}

/**
 * Nests `items` for production. Deterministic for the same input order and
 * config. Never returns a partial layout as ok.
 */
export function runProductionNesting<T>(items: GroupedNestingItem<T>[]): ProductionNestingResult<T> {
  const config = resolveConfig(PRODUCTION_SPACING_OVERRIDES);
  const run = runGroupedNestingV3(items, PRODUCTION_SPACING_OVERRIDES, undefined, {
    trace: false,
    compound: compoundStage<T>(config),
    region: regionStage<T>(config),
  });
  // Post-pack compaction: every receipt slides left/up as a rigid block to the minimum gaps.
  const packed = run.result;
  const compacted = compactRigidRects(
    packed.groups.map((g, key) => ({ key, sheet: g.sheetIndex, x: g.x, y: g.y, w: g.width, h: g.height })),
    compactionBoundsOf(config)
  );
  const compactedGroups = packed.groups.map((g, i) => {
    const r = compacted.rects[i];
    return r.x === g.x && r.y === g.y ? g : placeGroup(g.candidate, r.x, r.y, g.sheetIndex, { alternatives: g.alternatives, localCandidate: g.localCandidate });
  });
  const result = compacted.moves.some((m) => m.status[0] !== "BLOCKED") ? resultFromGroups(packed, compactedGroups, config) : packed;
  // Report blockers by receipt (orderId) instead of the internal group index.
  const blocker = (by: number | "edge" | "fiducial") => (typeof by === "number" ? (packed.groups[by].orderId ?? by) : by);
  const compaction = compacted.moves.map(({ key, ...move }) => ({
    ...move,
    orderId: packed.groups[key].orderId,
    blockedLeftBy: blocker(move.blockedLeftBy),
    blockedUpBy: blocker(move.blockedUpBy),
  }));
  const errors: string[] = [];

  if (result.unfit.length > 0) {
    errors.push(`${result.unfit.length} item tidak muat di media ${SHEET_WIDTH_MM}x${SHEET_HEIGHT_MM} mm (resi terlalu besar untuk satu lembar).`);
  }
  const engineViolations = validateLayout(result.groups, config, items.map((item) => item.id));
  if (engineViolations.length > 0) errors.push(...engineViolations.map((v) => `Layout tidak valid: ${v}`));

  const placements: ProductionPlacement<T>[] = result.items.map((item) => ({
    data: item.data,
    orderId: item.orderId,
    sheetIndex: item.sheetIndex,
    posX: item.x,
    posY: item.y,
    width: item.width,
    height: item.height,
    rotated: item.rotated,
  }));

  // Independent production gate on the final placements (the same check the batch lock runs).
  const byData = new Map(items.map((item) => [item.data, item]));
  const placed: PlacedItem[] = placements.map((p, index) => {
    const source = byData.get(p.data);
    return {
      key: String(source?.id ?? `missing-${index}`),
      orderId: p.orderId ?? -1,
      sheet: p.sheetIndex,
      posX: p.posX,
      posY: p.posY,
      width: p.width,
      height: p.height,
      rotated: p.rotated,
      expectedWidth: source?.originalWidth ?? NaN,
      expectedHeight: source?.originalHeight ?? NaN,
    };
  });
  const gate = validatePlacedSheets(placed, items.map((item) => String(item.id)), "production");
  if (!gate.ok) errors.push(...gate.errors);

  return {
    ok: errors.length === 0,
    errors,
    placements,
    sheetCount: result.summary.sheetCount,
    sumUsedHeight: result.summary.sumUsedHeight,
    engine: run.diagnostics.applied ? "V3" : "V2",
    compaction,
    result,
  };
}
