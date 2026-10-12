/**
 * Grouped Nesting V3A-1 (EXPERIMENTAL, OPT-IN) — local slot-aware reflow /
 * direct relocation.
 *
 * Runs AFTER the full V2 pipeline and only ever starts from its finished,
 * valid layout. Mimics how an operator tidies a CorelDRAW sheet: take one
 * resi off the sheet, look at the free areas that are actually left (the
 * packer's own free rectangles, on every sheet), re-arrange that resi's
 * items to fit one of those areas, and keep the move only if the whole
 * batch gets strictly better (fewer sheets, else less total used height).
 *
 * Each pass evaluates every (order, slot, shape) within budget and applies
 * the single best strictly-improving move (best-improvement local search),
 * then recomputes every free rectangle from scratch before the next pass.
 * Nothing else moves: other groups keep their exact positions, so every
 * accepted move only ever lowers the objective.
 *
 * Out of scope here (later experiments): feeding slot shapes into the V2
 * beam search, moving two groups at once, cross-receipt spillover, guest
 * pockets, true-shape nesting. One resi is still one group on one sheet.
 *
 * If nothing improves, the budget runs out before an improvement, or the
 * final layout fails validation, the V2 result is returned unchanged (the
 * same object).
 */
import {
  runGroupedNesting,
  resolveConfig,
  buildSheets,
  summarizeSheets,
  assertGroupOrderIntegrity,
  type GroupedNestingConfig,
  type GroupedNestingConfigOverrides,
} from "./grouped-nesting";
import { scoreOuterPlacements, DEFAULT_GLOBAL_SEARCH_LIMITS, compareScores, type GlobalLayoutScore, type GlobalSearchLimits } from "./grouped-nesting-global";
import { DEFAULT_OUTER_PACKING_LIMITS, type OuterPackingLimits } from "./grouped-nesting-outer";
import { replayFreeRects, type FreeRect } from "./outer-maxrects";
import { reflowOrderIntoSlot, slotCanPossiblyHold, V2_ROTATION_RULE, type RotationRule } from "./slot-reflow";
import type {
  GroupedNestingItem,
  GroupedNestingResult,
  GroupedPackedRect,
  GroupPlacement,
  GroupedNestingMetrics,
  OrderLayoutCandidate,
} from "./grouped-nesting-types";

export interface SlotReflowLimits {
  /** Max improvement passes; each pass applies at most one relocation. */
  maxPasses: number;
  /** Max orders tried per pass (after the critical-order filter). */
  maxOrdersPerPass: number;
  /** Max free slots tried per order. */
  maxSlotsPerOrder: number;
  /** Max reflow packings per (order, slot). */
  maxReflowVariants: number;
  /** Hard cap on reflow packings + layout evaluations across the whole V3A run. */
  maxTotalEvaluations: number;
}

/** Conservative defaults (see the V3A-1 report for the benchmark behind them). */
export const DEFAULT_SLOT_REFLOW_LIMITS: SlotReflowLimits = {
  maxPasses: 8,
  maxOrdersPerPass: 24,
  maxSlotsPerOrder: 16,
  maxReflowVariants: 25,
  maxTotalEvaluations: 5000,
};

/** A move must save more than this (mm of summed used height) to count as an improvement on the same sheet count. */
export const MIN_HEIGHT_GAIN_MM = 0.01;
const POSITION_EPSILON = 0.01;
const GEOMETRY_EPSILON = 1e-6;

export interface SlotReflowTotals {
  sheetCount: number;
  /** Sum of per-sheet used heights, sheet coordinates (margin included), mm. */
  sumUsedHeight: number;
  totalRemainingFullWidthHeight: number;
}

export interface SlotReflowMove {
  orderId: number | null;
  source: "NORMAL" | "SLOT_REFLOW";
  strategy: string;
  fromSheetIndex: number;
  fromX: number;
  fromY: number;
  fromWidth: number;
  fromHeight: number;
  toSheetIndex: number;
  toX: number;
  toY: number;
  /** The free slot used (sheet coordinates, usable size = what a group may occupy). */
  slot: { x: number; y: number; width: number; height: number };
  newWidth: number;
  newHeight: number;
  before: { sheetCount: number; sumUsedHeight: number };
  after: { sheetCount: number; sumUsedHeight: number };
  sheetRemoved: boolean;
  /** Sheet index of `slot` in the FINAL layout (later moves can renumber sheets); null if that sheet is gone. */
  finalSheetIndex: number | null;
}

export interface SlotReflowDiagnostics {
  /** True when the returned result is the V3A layout (strictly better than V2). */
  applied: boolean;
  fallbackReason: string | null;
  baseline: SlotReflowTotals;
  final: SlotReflowTotals;
  sheetsAvoided: number;
  heightSavedMm: number;
  heightSavedPercent: number;
  passes: number;
  ordersTried: number;
  /** Orders skipped because removing them does not lower any sheet's used height (no single move of them can help). */
  ordersSkippedNonCritical: number;
  slotsDetected: number;
  /** Slots dropped before packing: cannot hold the order, or cannot improve even with the order's smallest possible footprint. */
  slotsPruned: number;
  slotsTried: number;
  reflowAttempts: number;
  successfulReflows: number;
  layoutEvaluations: number;
  acceptedRelocations: number;
  rejectedNoOps: number;
  rejectedNotBetter: number;
  rejectedInvalid: number;
  budgetUsed: number;
  budgetLimit: number;
  budgetExhausted: boolean;
  limits: SlotReflowLimits;
  moves: SlotReflowMove[];
  /** Validation of the V2 baseline and of the returned layout (empty = valid). */
  baselineViolations: string[];
  finalViolations: string[];
  /** Filled by the caller's clock (dev diagnostic, outside the deterministic result). */
  runtimeMs: number | null;
}

type Config = GroupedNestingConfig;

/** Search counters of one improveWithSlotReflow run. */
export type SlotReflowSearchStats = Omit<
  SlotReflowDiagnostics,
  "applied" | "fallbackReason" | "baseline" | "final" | "sheetsAvoided" | "heightSavedMm" | "heightSavedPercent" | "baselineViolations" | "finalViolations" | "runtimeMs"
>;

/** One group positioned on a sheet (sheet coordinates), rebuilt exactly like packGroupsOntoSheet does. */
export function placeGroup<T>(
  candidate: OrderLayoutCandidate<T>,
  x: number,
  y: number,
  sheetIndex: number,
  context: { alternatives: OrderLayoutCandidate<T>[]; localCandidate: OrderLayoutCandidate<T> }
): GroupPlacement<T> {
  const items: GroupedPackedRect<T>[] = candidate.placements.map((placement) => ({
    x: x + placement.x,
    y: y + placement.y,
    width: placement.width,
    height: placement.height,
    rotated: placement.rotated,
    sheetIndex,
    data: placement.item.data,
    orderId: candidate.orderId,
    groupX: x,
    groupY: y,
    groupWidth: candidate.width,
    groupHeight: candidate.height,
  }));
  return {
    orderId: candidate.orderId,
    x,
    y,
    width: candidate.width,
    height: candidate.height,
    rotated: false,
    sheetIndex,
    candidate,
    alternatives: context.alternatives,
    localCandidate: context.localCandidate,
    items,
  };
}

function usableRects<T>(groups: GroupPlacement<T>[], config: Config) {
  return groups.map((g) => ({
    x: g.x - config.sheetMarginMm,
    y: g.y - config.sheetMarginMm,
    width: g.width,
    height: g.height,
    sheetIndex: g.sheetIndex,
  }));
}

function scoreRects(rects: { x: number; y: number; width: number; height: number; sheetIndex: number }[], config: Config): GlobalLayoutScore {
  return scoreOuterPlacements(rects, rects.length, config.sheetWidth - 2 * config.sheetMarginMm);
}

const sheetHeightOf = (score: GlobalLayoutScore, config: Config) => score.usedHeight + score.sheetCount * config.sheetMarginMm;

/** PRIMARY fewer sheets; SECONDARY less summed used height (by more than MIN_HEIGHT_GAIN_MM). Equal = not better. */
export function isStrictlyBetter(candidate: GlobalLayoutScore, current: GlobalLayoutScore): boolean {
  if (candidate.unfitGroups !== current.unfitGroups) return candidate.unfitGroups < current.unfitGroups;
  if (candidate.sheetCount !== current.sheetCount) return candidate.sheetCount < current.sheetCount;
  return candidate.usedHeight < current.usedHeight - MIN_HEIGHT_GAIN_MM;
}

/** Drops empty sheets and renumbers the rest 0..n-1 in order. */
function normalizeSheets<T>(groups: GroupPlacement<T>[]): { groups: GroupPlacement<T>[]; mapping: Map<number, number> } {
  const used = [...new Set(groups.map((g) => g.sheetIndex))].sort((a, b) => a - b);
  const mapping = new Map(used.map((sheetIndex, index) => [sheetIndex, index]));
  if (used.every((sheetIndex, index) => sheetIndex === index)) return { groups, mapping };
  return {
    groups: groups.map((g) =>
      g.sheetIndex === mapping.get(g.sheetIndex)
        ? g
        : placeGroup(g.candidate, g.x, g.y, mapping.get(g.sheetIndex)!, { alternatives: g.alternatives, localCandidate: g.localCandidate })
    ),
    mapping,
  };
}

const separated = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number
) =>
  a.x + a.width + gap <= b.x + GEOMETRY_EPSILON ||
  b.x + b.width + gap <= a.x + GEOMETRY_EPSILON ||
  a.y + a.height + gap <= b.y + GEOMETRY_EPSILON ||
  b.y + b.height + gap <= a.y + GEOMETRY_EPSILON;

/**
 * Independent geometric + integrity check of a finished layout (does not
 * trust any packer): group bounds as the outer packer reserves them (margin
 * + ORDER_GAP border), ORDER_GAP between groups on the same sheet, items
 * inside their group with PART_GAP between them, artwork size unchanged
 * (only a 90° swap when rotated), every item of an order in that order's
 * single group, and (when `expectedItemIds` is given) every input item
 * exactly once. Returns violations; empty = valid.
 */
export function validateLayout<T>(
  groups: GroupPlacement<T>[],
  config: Config,
  expectedItemIds?: (string | number)[]
): string[] {
  const violations: string[] = [];
  const { sheetWidth, sheetHeight, sheetMarginMm: margin, orderGapMm: gap, partGapMm: partGap } = config;
  const minEdge = margin + gap - GEOMETRY_EPSILON;

  groups.forEach((g, gi) => {
    const name = `group ${gi} (order ${g.orderId ?? "-"})`;
    if (g.x < minEdge || g.y < minEdge) violations.push(`${name}: closer than margin+gap to the top/left edge`);
    if (g.x + g.width + gap > sheetWidth - margin - gap + GEOMETRY_EPSILON) violations.push(`${name}: exceeds the right usable edge`);
    if (g.y + g.height + gap > sheetHeight - margin - gap + GEOMETRY_EPSILON) violations.push(`${name}: exceeds the bottom usable edge`);
    if (g.width !== g.candidate.width || g.height !== g.candidate.height) violations.push(`${name}: box differs from its candidate`);

    g.items.forEach((item, ii) => {
      if (item.orderId !== g.orderId) violations.push(`${name}: item ${ii} belongs to order ${item.orderId}`);
      if (item.sheetIndex !== g.sheetIndex) violations.push(`${name}: item ${ii} on another sheet`);
      if (
        item.x < g.x - GEOMETRY_EPSILON ||
        item.y < g.y - GEOMETRY_EPSILON ||
        item.x + item.width > g.x + g.width + GEOMETRY_EPSILON ||
        item.y + item.height > g.y + g.height + GEOMETRY_EPSILON
      ) {
        violations.push(`${name}: item ${ii} outside its group box`);
      }
      const source = g.candidate.placements[ii]?.item;
      if (source) {
        const [w, h] = item.rotated ? [source.originalHeight, source.originalWidth] : [source.originalWidth, source.originalHeight];
        if (Math.abs(item.width - w) > GEOMETRY_EPSILON || Math.abs(item.height - h) > GEOMETRY_EPSILON) {
          violations.push(`${name}: item ${ii} size changed`);
        }
        if (item.rotated && !source.allowRotation) violations.push(`${name}: item ${ii} rotated without permission`);
      }
      for (let jj = ii + 1; jj < g.items.length; jj++) {
        if (!separated(item, g.items[jj], partGap)) violations.push(`${name}: items ${ii}/${jj} closer than PART_GAP`);
      }
    });

    for (let gj = gi + 1; gj < groups.length; gj++) {
      const other = groups[gj];
      if (other.sheetIndex === g.sheetIndex && !separated(g, other, gap)) {
        violations.push(`${name} and group ${gj} (order ${other.orderId ?? "-"}): closer than ORDER_GAP on sheet ${g.sheetIndex}`);
      }
    }
  });

  const groupsByOrder = new Map<number, number>();
  for (const g of groups) if (g.orderId !== null) groupsByOrder.set(g.orderId, (groupsByOrder.get(g.orderId) ?? 0) + 1);
  for (const [orderId, count] of groupsByOrder) if (count > 1) violations.push(`order ${orderId} split into ${count} groups`);

  if (expectedItemIds) {
    const seen = groups.flatMap((g) => g.candidate.placements.map((p) => p.item.id));
    const counts = new Map<string | number, number>();
    for (const id of seen) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) if (count > 1) violations.push(`item ${id} duplicated`);
    for (const id of expectedItemIds) if (!counts.has(id)) violations.push(`item ${id} missing`);
    if (seen.length !== expectedItemIds.length) violations.push(`item count ${seen.length} != ${expectedItemIds.length}`);
  }

  return violations;
}

interface Slot {
  sheetIndex: number;
  /** Free rect in usable coordinates (padded, as the packer stores it). */
  free: FreeRect;
  width: number;
  height: number;
}

interface CandidateMove<T> {
  groups: GroupPlacement<T>[];
  mapping: Map<number, number>;
  score: GlobalLayoutScore;
  move: Omit<SlotReflowMove, "after" | "sheetRemoved" | "finalSheetIndex">;
}

/** Smallest footprint the order could possibly have (for the slot bound): widest item's min side x tallest item's min side. */
function minimalFootprint<T>(group: GroupPlacement<T>, rule: RotationRule): { width: number; height: number } {
  const items = group.candidate.placements.map((p) => p.item);
  const canRotate = rule(items);
  const sides = items.map((item) =>
    canRotate(item) ? Math.min(item.width, item.height) : null
  );
  return {
    width: Math.max(...items.map((item, i) => sides[i] ?? item.width)),
    height: Math.max(...items.map((item, i) => sides[i] ?? item.height)),
  };
}

/**
 * The V3A-1 local search on an already-valid layout. Pure and deterministic
 * (no clock, no randomness): same groups + config + limits -> same result.
 */
export function improveWithSlotReflow<T>(
  baseline: GroupPlacement<T>[],
  config: Config,
  limits: SlotReflowLimits = DEFAULT_SLOT_REFLOW_LIMITS,
  rule: RotationRule = V2_ROTATION_RULE
): { groups: GroupPlacement<T>[]; stats: SlotReflowSearchStats } {
  const margin = config.sheetMarginMm;
  const gap = config.orderGapMm;
  const packSheetWidth = config.sheetWidth - 2 * margin;
  const packSheetHeight = config.sheetHeight - 2 * margin;

  const stats = emptySearchStats(limits);
  const remaining = () => limits.maxTotalEvaluations - stats.budgetUsed;

  let current = baseline;
  let currentScore = scoreRects(usableRects(current, config), config);

  for (let pass = 0; pass < limits.maxPasses && !stats.budgetExhausted; pass++) {
    stats.passes++;
    const rects = usableRects(current, config);
    const bottomOf = (sheetIndex: number, skip: number) =>
      Math.max(-Infinity, ...rects.filter((r, i) => i !== skip && r.sheetIndex === sheetIndex).map((r) => r.y + r.height));
    const sheetIndices = [...new Set(rects.map((r) => r.sheetIndex))].sort((a, b) => a - b);

    // Deterministic order priority: last sheet first, then lowest bottom edge, then largest box, then orderId/candidateId.
    const order = current
      .map((g, index) => ({ g, index }))
      .sort(
        (a, b) =>
          b.g.sheetIndex - a.g.sheetIndex ||
          b.g.y + b.g.height - (a.g.y + a.g.height) ||
          b.g.width * b.g.height - a.g.width * a.g.height ||
          (a.g.orderId ?? -1) - (b.g.orderId ?? -1) ||
          a.g.candidate.candidateId.localeCompare(b.g.candidate.candidateId)
      );

    let best: CandidateMove<T> | null = null;
    let ordersThisPass = 0;

    for (const { g: group, index } of order) {
      if (ordersThisPass >= limits.maxOrdersPerPass || stats.budgetExhausted) break;

      // Only a group that sets its sheet's used height (or is alone on it) can improve the
      // objective by moving: any other group's removal leaves every sheet's height unchanged.
      const own = rects[index];
      const bottomWithout = bottomOf(own.sheetIndex, index);
      if (!(bottomWithout < own.y + own.height - MIN_HEIGHT_GAIN_MM)) {
        stats.ordersSkippedNonCritical++;
        continue;
      }
      ordersThisPass++;
      stats.ordersTried++;

      const restRects = rects.filter((_, i) => i !== index);
      const items = group.candidate.placements.map((p) => p.item);
      const minimal = minimalFootprint(group, rule);

      // Free space of EVERY sheet with this order removed (its own old area included).
      const slots: Slot[] = [];
      for (const sheetIndex of sheetIndices) {
        const occupied = restRects.filter((r) => r.sheetIndex === sheetIndex);
        for (const free of replayFreeRects(occupied, packSheetWidth, packSheetHeight, gap)) {
          slots.push({ sheetIndex, free, width: free.width - gap, height: free.height - gap });
        }
      }
      stats.slotsDetected += slots.length;

      const promising = slots.filter((slot) => {
        if (!slotCanPossiblyHold(items, slot.width, slot.height, config.partGapMm, rule)) return false;
        // Optimistic bound: even the order's smallest possible footprint at this slot must beat the current score.
        const bound = scoreRects(
          [...restRects, { x: slot.free.x, y: slot.free.y, width: Math.min(minimal.width, slot.width), height: Math.min(minimal.height, slot.height), sheetIndex: slot.sheetIndex }],
          config
        );
        return isStrictlyBetter(bound, currentScore);
      });
      stats.slotsPruned += slots.length - promising.length;
      promising.sort(
        (a, b) =>
          a.free.y - b.free.y ||
          a.sheetIndex - b.sheetIndex ||
          a.free.x - b.free.x ||
          b.width * b.height - a.width * a.height
      );

      for (const slot of promising.slice(0, limits.maxSlotsPerOrder)) {
        if (remaining() <= 0) {
          stats.budgetExhausted = true;
          break;
        }
        stats.slotsTried++;

        const normal = group.alternatives
          .filter((c) => c.width <= slot.width + GEOMETRY_EPSILON && c.height <= slot.height + GEOMETRY_EPSILON)
          .map((c) => ({ candidate: c, source: "NORMAL" as const }));
        const reflow = reflowOrderIntoSlot(items, slot.width, slot.height, config.partGapMm, {
          orderId: group.orderId,
          maxVariants: Math.min(limits.maxReflowVariants, remaining()),
          rule,
        });
        stats.reflowAttempts += reflow.attempts;
        stats.budgetUsed += reflow.attempts;
        stats.successfulReflows += reflow.candidates.length;
        const shapes = [...normal, ...reflow.candidates.map((candidate) => ({ candidate, source: "SLOT_REFLOW" as const }))];

        for (const { candidate, source } of shapes) {
          if (remaining() <= 0) {
            stats.budgetExhausted = true;
            break;
          }
          const x = slot.free.x + margin;
          const y = slot.free.y + margin;
          if (
            slot.sheetIndex === group.sheetIndex &&
            Math.abs(x - group.x) < POSITION_EPSILON &&
            Math.abs(y - group.y) < POSITION_EPSILON &&
            Math.abs(candidate.width - group.width) < POSITION_EPSILON &&
            Math.abs(candidate.height - group.height) < POSITION_EPSILON
          ) {
            stats.rejectedNoOps++;
            continue;
          }

          stats.budgetUsed++;
          stats.layoutEvaluations++;
          const score = scoreRects(
            [...restRects, { x: slot.free.x, y: slot.free.y, width: candidate.width, height: candidate.height, sheetIndex: slot.sheetIndex }],
            config
          );
          if (!isStrictlyBetter(score, currentScore)) {
            stats.rejectedNotBetter++;
            continue;
          }
          if (best && compareScores(score, best.score) >= 0) continue;

          const moved = placeGroup(candidate, x, y, slot.sheetIndex, { alternatives: group.alternatives, localCandidate: group.localCandidate });
          const { groups: next, mapping } = normalizeSheets(current.map((g, i) => (i === index ? moved : g)));
          if (validateLayout(next, config).length > 0) {
            stats.rejectedInvalid++;
            continue;
          }
          best = {
            groups: next,
            mapping,
            score,
            move: {
              orderId: group.orderId,
              source,
              strategy: candidate.strategy,
              fromSheetIndex: group.sheetIndex,
              fromX: group.x,
              fromY: group.y,
              fromWidth: group.width,
              fromHeight: group.height,
              toSheetIndex: slot.sheetIndex,
              toX: x,
              toY: y,
              slot: { x, y, width: slot.width, height: slot.height },
              newWidth: candidate.width,
              newHeight: candidate.height,
              before: { sheetCount: currentScore.sheetCount, sumUsedHeight: sheetHeightOf(currentScore, config) },
            },
          };
        }
        if (stats.budgetExhausted) break;
      }
    }

    // A validated, strictly better move found before the budget ran out is still applied.
    if (!best) break;
    for (const move of stats.moves) {
      move.finalSheetIndex = move.finalSheetIndex === null ? null : (best.mapping.get(move.finalSheetIndex) ?? null);
    }
    stats.moves.push({
      ...best.move,
      after: { sheetCount: best.score.sheetCount, sumUsedHeight: sheetHeightOf(best.score, config) },
      sheetRemoved: best.score.sheetCount < currentScore.sheetCount,
      finalSheetIndex: best.mapping.get(best.move.toSheetIndex) ?? null,
    });
    stats.acceptedRelocations++;
    current = best.groups;
    currentScore = best.score;
  }

  return { groups: current, stats };
}

function totalsOf<T>(result: GroupedNestingResult<T>): SlotReflowTotals {
  return {
    sheetCount: result.summary.sheetCount,
    sumUsedHeight: result.summary.sumUsedHeight,
    totalRemainingFullWidthHeight: result.summary.totalRemainingFullWidthHeight,
  };
}

/** Rebuilds sheets/summary/metrics for a relocated layout, keeping everything else of the V2 result. */
export function resultFromGroups<T>(base: GroupedNestingResult<T>, groups: GroupPlacement<T>[], config: Config): GroupedNestingResult<T> {
  const sheets = buildSheets(groups, config);
  const summary = summarizeSheets(sheets, config, base.metrics.totalItems, base.metrics.totalOrders, base.unfit.length);
  const usedWidth = sheets.length > 0 ? Math.max(...sheets.map((sheet) => sheet.usedWidth)) : 0;
  const usedArea = sheets.reduce((sum, sheet) => sum + sheet.usedWidth * sheet.usedHeight, 0);
  const metrics: GroupedNestingMetrics = {
    totalItems: base.metrics.totalItems,
    totalOrders: base.metrics.totalOrders,
    usedWidth,
    usedHeight: summary.sumUsedHeight,
    usedArea,
    totalItemArea: summary.totalItemArea,
    packingUtilizationPercent: usedArea > 0 ? (summary.totalItemArea / usedArea) * 100 : 0,
    wastePercent: usedArea > 0 ? 100 - (summary.totalItemArea / usedArea) * 100 : 0,
  };
  assertGroupOrderIntegrity(groups);
  return { ...base, sheets, summary, groups, items: groups.flatMap((g) => g.items), metrics };
}

/** Request flag for the dry-run API: `slotReflow: true` (anything else = off). */
export function isSlotReflowRequest(body: unknown): boolean {
  return (body as { slotReflow?: unknown } | null)?.slotReflow === true;
}

/**
 * V2 first (runGroupedNesting, untouched), then the optional V3A-1 pass.
 * Returns the V3A layout only when it is valid AND strictly better;
 * otherwise `result` is the V2 result object itself.
 */
export function runGroupedNestingV3<T>(
  items: GroupedNestingItem<T>[],
  overrides: GroupedNestingConfigOverrides = {},
  limits: SlotReflowLimits = DEFAULT_SLOT_REFLOW_LIMITS,
  options: { clock?: () => number; searchLimits?: GlobalSearchLimits; outerLimits?: OuterPackingLimits; rule?: RotationRule } = {}
): { result: GroupedNestingResult<T>; v2: GroupedNestingResult<T>; diagnostics: SlotReflowDiagnostics } {
  const v2 = runGroupedNesting(items, overrides, options.searchLimits ?? DEFAULT_GLOBAL_SEARCH_LIMITS, options.outerLimits ?? DEFAULT_OUTER_PACKING_LIMITS);
  return { ...applySlotReflow(v2, resolveConfig(overrides), limits, options), v2 };
}

/**
 * The V3A-1 decision on top of a finished V2 result: validate it, run the
 * local search, and return the relocated layout only if it is valid AND
 * strictly better — otherwise `result` is `v2` itself.
 */
export function applySlotReflow<T>(
  v2: GroupedNestingResult<T>,
  config: Config,
  limits: SlotReflowLimits = DEFAULT_SLOT_REFLOW_LIMITS,
  options: { clock?: () => number; rule?: RotationRule } = {}
): { result: GroupedNestingResult<T>; diagnostics: SlotReflowDiagnostics } {
  const startedAt = options.clock?.();

  const itemIds = v2.groups.flatMap((g) => g.candidate.placements.map((p) => p.item.id));
  const baselineViolations = validateLayout(v2.groups, config, itemIds);
  const baseline = totalsOf(v2);

  let result = v2;
  let fallbackReason: string | null = null;
  let finalViolations = baselineViolations;
  let stats: SlotReflowSearchStats = emptySearchStats(limits);

  if (baselineViolations.length > 0) {
    fallbackReason = "V2 baseline failed validation — V3A not run";
  } else if (v2.groups.length === 0) {
    fallbackReason = "no groups";
  } else {
    const improved = improveWithSlotReflow(v2.groups, config, limits, options.rule ?? V2_ROTATION_RULE);
    stats = improved.stats;
    if (improved.stats.acceptedRelocations === 0) {
      fallbackReason = improved.stats.budgetExhausted ? "budget exhausted without an improvement" : "no strictly better relocation";
    } else {
      const candidate = resultFromGroups(v2, improved.groups, config);
      const violations = validateLayout(candidate.groups, config, itemIds);
      const before = scoreRects(usableRects(v2.groups, config), config);
      const after = scoreRects(usableRects(candidate.groups, config), config);
      if (violations.length > 0) {
        fallbackReason = "V3A layout failed validation";
        finalViolations = violations;
      } else if (!isStrictlyBetter(after, before)) {
        fallbackReason = "V3A layout not strictly better";
      } else {
        result = candidate;
        finalViolations = violations;
      }
    }
  }

  const final = totalsOf(result);
  const runtimeMs = startedAt !== undefined && options.clock ? options.clock() - startedAt : null;
  const diagnostics: SlotReflowDiagnostics = {
    ...stats,
    applied: result !== v2,
    fallbackReason,
    baseline,
    final,
    sheetsAvoided: baseline.sheetCount - final.sheetCount,
    heightSavedMm: baseline.sumUsedHeight - final.sumUsedHeight,
    heightSavedPercent: baseline.sumUsedHeight > 0 ? ((baseline.sumUsedHeight - final.sumUsedHeight) / baseline.sumUsedHeight) * 100 : 0,
    baselineViolations,
    finalViolations,
    runtimeMs,
  };
  return { result, diagnostics };
}

function emptySearchStats(limits: SlotReflowLimits): SlotReflowSearchStats {
  return {
    passes: 0,
    ordersTried: 0,
    ordersSkippedNonCritical: 0,
    slotsDetected: 0,
    slotsPruned: 0,
    slotsTried: 0,
    reflowAttempts: 0,
    successfulReflows: 0,
    layoutEvaluations: 0,
    acceptedRelocations: 0,
    rejectedNoOps: 0,
    rejectedNotBetter: 0,
    rejectedInvalid: 0,
    budgetUsed: 0,
    budgetLimit: limits.maxTotalEvaluations,
    budgetExhausted: false,
    limits,
    moves: [],
  };
}
