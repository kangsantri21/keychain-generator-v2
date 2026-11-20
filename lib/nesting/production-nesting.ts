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
import { receiptsOnSeveralSheets, validatePlacedSheets, type PlacedItem } from "@/lib/production-gate";
import { runShapeBlockNesting, type ShapeBlockResult } from "@/lib/nesting/shape-block-nesting";

export const PRODUCTION_NESTING_RULES = {
  sheetWidthMm: SHEET_WIDTH_MM,
  sheetHeightMm: SHEET_HEIGHT_MM,
  sheetMarginMm: SHEET_MARGIN_MM,
  partGapMm: PART_GAP_MM,
  groupGapXMm: PRODUCTION_GROUP_GAP_X_MM,
  groupGapYMm: PRODUCTION_GROUP_GAP_Y_MM,
} as const;

/**
 * Production engine overrides: the Production spacing (grouped-nesting-config.ts
 * PRODUCTION_SPACING) + exact-fit-safe outer packing, so identical receipts
 * can never be stacked onto the same spot by the legacy phantom-slot carve.
 */
export const PRODUCTION_SPACING_OVERRIDES = { ...PRODUCTION_SPACING, outerExactFitSafe: true } as const;

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
  /** 0, 90, 180 or 270. The box packer only ever emits 0 or 90. */
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface ProductionNestingResult<T> {
  ok: boolean;
  /** Human-readable reasons when !ok (Indonesian, shown to the operator). */
  errors: string[];
  placements: ProductionPlacement<T>[];
  sheetCount: number;
  sumUsedHeight: number;
  /** "SHAPE" is the cut-line block packer. "V3"/"V2" are the older box packer. */
  engine: "V3" | "V2" | "SHAPE";
  /** Post-pack group compaction, one entry per receipt (orderId; null = orphan item group). */
  compaction: (Omit<CompactionMove, "key"> & { orderId: number | null })[];
  result: GroupedNestingResult<T>;
}

/**
 * Nests `items` for production. Deterministic for the same input order and
 * config. Never returns a partial layout as ok.
 */
export function runProductionNesting<T>(items: GroupedNestingItem<T>[]): ProductionNestingResult<T> {
  if (items.some((item) => (item.outline?.length ?? 0) > 0)) return shapeProductionResult(items);
  return runBoxProductionNesting(items);
}

function shapeProductionResult<T>(items: GroupedNestingItem<T>[]): ProductionNestingResult<T> {
  const shape = runShapeBlockNesting(
    items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      width: item.originalWidth,
      height: item.originalHeight,
      allowRotation: item.allowRotation,
      outline: item.outline,
      receiptCode: item.receiptCode,
      data: item.data,
    }))
  );
  const placements: ProductionPlacement<T>[] = shape.placements.map((p) => ({
    data: p.item.data,
    orderId: p.orderId,
    sheetIndex: p.sheetIndex,
    posX: p.posX,
    posY: p.posY,
    width: p.width,
    height: p.height,
    rotated: p.rotated,
    rotationDeg: p.rotationDeg,
  }));
  const errors = [...shape.errors];
  if (shape.ok) {
    const placedData = new Set(shape.placements.map((p) => p.item.data));
    const kept = items.filter((item) => placedData.has(item.data));
    const byData = new Map(kept.map((item) => [item.data, item]));
    const placed: PlacedItem[] = shape.placements.map((p, index) => {
      const source = byData.get(p.item.data);
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
        outline: p.outline,
        cutClearanceMm: shape.config.cutClearanceMm,
        blockGapMm: shape.config.blockGapMm,
      };
    });
    const gate = validatePlacedSheets(placed, kept.map((item) => String(item.id)), "production");
    if (!gate.ok) errors.push(...gate.errors);
    else if (shape.placements.length > 0) {
      return {
        ok: true,
        errors,
        placements,
        sheetCount: shape.sheetCount,
        sumUsedHeight: shape.sumUsedHeight,
        engine: "SHAPE",
        compaction: [],
        result: emptyGroupedResult(items, shape),
      };
    }
  }
  return {
    ok: false,
    errors,
    placements,
    sheetCount: shape.sheetCount,
    sumUsedHeight: shape.sumUsedHeight,
    engine: "SHAPE",
    compaction: [],
    result: emptyGroupedResult(items, shape),
  };
}

function emptyGroupedResult<T>(items: GroupedNestingItem<T>[], shape: ShapeBlockResult<T>): GroupedNestingResult<T> {
  const usedHeight = shape.sumUsedHeight;
  const zero = { unfitGroups: 0, sheetCount: shape.sheetCount, usedHeight, boundingArea: 0, unusedSideWidth: 0, usedWidth: 0 };
  return {
    sheets: [],
    summary: {
      sheetCount: shape.sheetCount,
      totalOrders: new Set(items.map((item) => item.orderId)).size,
      totalItems: shape.placements.length,
      totalUnfitItems: shape.ok ? 0 : items.length,
      sumUsedHeight: usedHeight,
      totalRemainingFullWidthHeight: 0,
      totalSideFragmentWidth: 0,
      totalSheetArea: 0,
      totalItemArea: 0,
      overallMaterialUtilizationPercent: 0,
      averageUsedHeight: shape.sheetCount ? usedHeight / shape.sheetCount : 0,
      maxUsedHeight: usedHeight,
      minUsedHeight: usedHeight,
    },
    unfitGroups: [],
    groups: [],
    items: [],
    metrics: {
      totalItems: items.length,
      totalOrders: new Set(items.map((item) => item.orderId)).size,
      usedWidth: 0,
      usedHeight,
      usedArea: 0,
      totalItemArea: 0,
      packingUtilizationPercent: 0,
      wastePercent: 0,
    },
    warnings: [],
    unfit: [],
    optimizer: {
      strategy: "beam+multi-outer",
      beamWidth: 0,
      candidateStatesEvaluated: 0,
      outerPackAttempts: 0,
      strategiesTried: 0,
      attemptsPerState: 0,
      limitReached: false,
      phase2cScore: zero,
      phase2dScore: zero,
      finalScore: zero,
      candidateSource: "phase2c",
      selectedStrategyId: "shape-block",
      selectedHeuristic: "shape-block",
      selectedSort: "area",
      improvementVsPhase2CPercent: 0,
      improvementVsPhase2DPercent: 0,
      phase2d: {
        strategy: "beam",
        beamWidth: 0,
        effectiveBeamWidth: 0,
        statesEvaluated: 0,
        limitReached: false,
        baselineScore: zero,
        optimizedScore: zero,
        usedBaseline: true,
        improvementPercent: 0,
        outerStrategyId: "shape-block",
      },
      multiSheet: {
        mode: "LAST_ONLY",
        bestExistingEvaluated: false,
        sheetsBefore: shape.sheetCount,
        sheetsAfter: shape.sheetCount,
        sumUsedHeightBefore: usedHeight,
        sumUsedHeightAfter: usedHeight,
        heightSavedMm: 0,
        heightSavedPercent: 0,
        existingSheetAttempts: 0,
        successfulBackfills: 0,
        newSheetsAvoided: 0,
        relocationPass: "OFF",
        packEvaluations: 0,
        statesEvaluated: 0,
      },
    },
  };
}

function runBoxProductionNesting<T>(items: GroupedNestingItem<T>[]): ProductionNestingResult<T> {
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

  // Hard invariant after every major stage: every receipt on exactly ONE sheet.
  const stageUnits = {
    "V2 packing": run.v2.groups.flatMap((g) => g.items.map((i) => ({ orderId: i.orderId, sheetIndex: i.sheetIndex })).concat({ orderId: g.orderId, sheetIndex: g.sheetIndex })),
    "V3 (reflow / compound / region)": packed.groups.flatMap((g) => g.items.map((i) => ({ orderId: i.orderId, sheetIndex: i.sheetIndex })).concat({ orderId: g.orderId, sheetIndex: g.sheetIndex })),
    "group compaction": result.groups.flatMap((g) => g.items.map((i) => ({ orderId: i.orderId, sheetIndex: i.sheetIndex })).concat({ orderId: g.orderId, sheetIndex: g.sheetIndex })),
    "final placements": result.items.map((i) => ({ orderId: i.orderId, sheetIndex: i.sheetIndex })),
  };
  for (const [stage, units] of Object.entries(stageUnits)) {
    const split = receiptsOnSeveralSheets(units);
    if (split.length > 0) errors.push(`Invarian resi dilanggar setelah ${stage}: resi ${split.join(", ")} berada di lebih dari satu lembar`);
  }

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
    rotationDeg: item.rotated ? 90 : 0,
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
