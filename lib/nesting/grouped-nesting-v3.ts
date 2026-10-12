/**
 * Grouped Nesting V3A (EXPERIMENTAL, OPT-IN) — local slot-aware reflow and
 * relocation of whole receipt groups.
 *
 * Runs AFTER the full V2 pipeline and only ever starts from its finished,
 * valid layout. Mimics how an operator tidies a CorelDRAW sheet: take one
 * resi off the sheet, look at the free areas that are actually left (the
 * packer's own free rectangles, on every sheet), re-arrange that resi's
 * items to fit one of those areas, and keep the move only if the whole
 * batch gets strictly better.
 *
 * V3A-1 proved the reflow primitive (in practice: in place). V3A-2 makes
 * the search look elsewhere first: every move is classified as
 * SELF_REFLOW (same sheet, same origin, new footprint) or
 * FOREIGN_RELOCATION (another origin or another sheet — see
 * `classifyRelocation`), foreign slots are tried before the order's own
 * one (other sheets first), and all orders are ranked and tried, not only
 * the ones that set a sheet's height.
 *
 * Each pass evaluates every (order, slot, shape) within budget and applies
 * the single best strictly-improving move (best-improvement local search),
 * then recomputes every free rectangle from scratch before the next pass.
 * Nothing else moves: other groups keep their exact positions.
 *
 * Out of scope (later experiments): feeding slot shapes into the V2 beam
 * search, moving two groups at once, cross-receipt spillover, guest
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
  /** Max orders tried per pass, in ranking order. */
  maxOrdersPerPass: number;
  /** Max FOREIGN slots tried per order (tried first). */
  maxForeignSlotsPerOrder: number;
  /** Max SELF slots (free rects starting at the order's own origin) tried per order, after the foreign ones. */
  maxSelfSlotsPerOrder: number;
  /** Max reflow packings per (order, slot). */
  maxReflowVariants: number;
  /** Hard cap on reflow packings + layout evaluations across the whole V3A run. */
  maxTotalEvaluations: number;
  /**
   * Also accept a move that keeps the sheet count and used height but
   * shrinks the summed per-sheet bounding area by more than
   * MIN_AREA_GAIN_MM2 — the existing objective's third key (compareScores).
   */
  acceptFragmentationGain: boolean;
}

/** Conservative defaults (see the V3A-2 report for the benchmark behind them). */
export const DEFAULT_SLOT_REFLOW_LIMITS: SlotReflowLimits = {
  maxPasses: 8,
  maxOrdersPerPass: 24,
  maxForeignSlotsPerOrder: 16,
  maxSelfSlotsPerOrder: 2,
  maxReflowVariants: 25,
  maxTotalEvaluations: 8000,
  acceptFragmentationGain: true,
};

/** A move must save more than this (mm of summed used height) to count as a height improvement. */
export const MIN_HEIGHT_GAIN_MM = 0.01;
/** A fragmentation-only move must shrink the summed bounding area by more than this (mm², = 1 cm²). */
export const MIN_AREA_GAIN_MM2 = 100;
/** Origins closer than this (mm, both axes, same sheet) count as the same place. */
export const ORIGIN_TOLERANCE_MM = 1;
const POSITION_EPSILON = 0.01;
const GEOMETRY_EPSILON = 1e-6;

export type RelocationType = "SELF_REFLOW" | "FOREIGN_RELOCATION";
/** Which objective key a move improved: fewer sheets, less summed used height, or (same both) less bounding area. */
export type ImprovementLevel = "SHEETS" | "HEIGHT" | "FRAGMENTATION";

export interface SlotReflowTotals {
  sheetCount: number;
  /** Sum of per-sheet used heights, sheet coordinates (margin included), mm. */
  sumUsedHeight: number;
  totalRemainingFullWidthHeight: number;
}

export interface SlotReflowMove {
  type: RelocationType;
  improvement: ImprovementLevel;
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
  /** before.sumUsedHeight - after.sumUsedHeight for this move (sheet coordinates). */
  heightSavedMm: number;
  heightSavedPercent: number;
  sheetRemoved: boolean;
  /** Sheet index of `slot` / of the old position in the FINAL layout (later moves can renumber sheets); null if that sheet is gone. */
  finalSheetIndex: number | null;
  finalFromSheetIndex: number | null;
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
  /** Ranked orders summed over passes (before the per-pass cap). */
  ordersConsidered: number;
  ordersTried: number;
  slotsDetected: number;
  foreignSlotsDetected: number;
  selfSlotsDetected: number;
  /** Slots dropped before packing: cannot hold the order, or cannot improve even with the order's smallest possible footprint. */
  slotsPruned: number;
  slotsTried: number;
  foreignSlotsTried: number;
  selfSlotsTried: number;
  reflowAttempts: number;
  successfulReflows: number;
  layoutEvaluations: number;
  acceptedRelocations: number;
  acceptedSelfReflow: number;
  acceptedForeignRelocation: number;
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

/**
 * Lexicographic objective (same key order as compareScores): PRIMARY fewer
 * sheets; SECONDARY less summed used height (by more than
 * MIN_HEIGHT_GAIN_MM); TERTIARY — only with `acceptFragmentationGain` and
 * no height increase — less summed bounding area (by more than
 * MIN_AREA_GAIN_MM2). Returns the key that improved, or null (equal or
 * worse = not better).
 */
export function improvementLevel(candidate: GlobalLayoutScore, current: GlobalLayoutScore, acceptFragmentationGain = false): ImprovementLevel | null {
  if (candidate.unfitGroups > current.unfitGroups) return null;
  if (candidate.sheetCount !== current.sheetCount) return candidate.sheetCount < current.sheetCount ? "SHEETS" : null;
  if (candidate.usedHeight < current.usedHeight - MIN_HEIGHT_GAIN_MM) return "HEIGHT";
  if (candidate.usedHeight > current.usedHeight + GEOMETRY_EPSILON) return null;
  if (acceptFragmentationGain && candidate.boundingArea < current.boundingArea - MIN_AREA_GAIN_MM2) return "FRAGMENTATION";
  return null;
}

export function isStrictlyBetter(candidate: GlobalLayoutScore, current: GlobalLayoutScore, acceptFragmentationGain = false): boolean {
  return improvementLevel(candidate, current, acceptFragmentationGain) !== null;
}

/**
 * SELF_REFLOW: same sheet and the origin moved less than ORIGIN_TOLERANCE_MM
 * on both axes (the order is re-arranged where it already starts).
 * FOREIGN_RELOCATION: another sheet, or an origin that moved by at least
 * the tolerance — a different free region than its own starting point.
 * Compares coordinates, never object identity.
 */
export function classifyRelocation(
  oldPlacement: { sheetIndex: number; x: number; y: number },
  newPlacement: { sheetIndex: number; x: number; y: number }
): RelocationType {
  const sameOrigin =
    oldPlacement.sheetIndex === newPlacement.sheetIndex &&
    Math.abs(oldPlacement.x - newPlacement.x) < ORIGIN_TOLERANCE_MM &&
    Math.abs(oldPlacement.y - newPlacement.y) < ORIGIN_TOLERANCE_MM;
  return sameOrigin ? "SELF_REFLOW" : "FOREIGN_RELOCATION";
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
  region: RelocationType;
}

interface CandidateMove<T> {
  groups: GroupPlacement<T>[];
  mapping: Map<number, number>;
  score: GlobalLayoutScore;
  level: ImprovementLevel;
  move: Omit<SlotReflowMove, "after" | "sheetRemoved" | "finalSheetIndex" | "finalFromSheetIndex" | "heightSavedMm" | "heightSavedPercent" | "improvement">;
}

/** Smallest footprint the order could possibly have (for the slot bound): widest item's min side x tallest item's min side. */
function minimalFootprint<T>(group: GroupPlacement<T>, rule: RotationRule): { width: number; height: number } {
  const items = group.candidate.placements.map((p) => p.item);
  const canRotate = rule(items);
  const sides = items.map((item) => (canRotate(item) ? Math.min(item.width, item.height) : null));
  return {
    width: Math.max(...items.map((item, i) => sides[i] ?? item.width)),
    height: Math.max(...items.map((item, i) => sides[i] ?? item.height)),
  };
}

/**
 * The V3A local search on an already-valid layout. Pure and deterministic
 * (no clock, no randomness): same groups + config + limits -> same result.
 *
 * Per pass: rank the orders, and for each tried order take it off a copy of
 * the layout, rebuild the free rectangles of EVERY sheet, try its FOREIGN
 * slots first (other sheets before its own), then its SELF slot(s), with
 * its normal V2 shapes and every slot reflow. Every strictly improving,
 * validated placement is a candidate move; the pass applies only the BEST
 * one (lowest global score), then the next pass starts from scratch.
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

    // Deterministic order ranking. Groups that set their sheet's used height
    // come first (only their move can lower sheets/height on its own), then
    // the rest; within each tier: last sheet first, then taller, larger
    // (= bigger freed slot), more flexible (more V2 shapes), orderId.
    const ranked = current
      .map((g, index) => ({ g, index, critical: bottomOf(g.sheetIndex, index) < rects[index].y + rects[index].height - MIN_HEIGHT_GAIN_MM }))
      .sort(
        (a, b) =>
          Number(b.critical) - Number(a.critical) ||
          b.g.sheetIndex - a.g.sheetIndex ||
          b.g.height - a.g.height ||
          b.g.width * b.g.height - a.g.width * a.g.height ||
          b.g.alternatives.length - a.g.alternatives.length ||
          (a.g.orderId ?? -1) - (b.g.orderId ?? -1) ||
          a.g.candidate.candidateId.localeCompare(b.g.candidate.candidateId)
      );
    stats.ordersConsidered += ranked.length;

    let best: CandidateMove<T> | null = null;

    for (const { g: group, index } of ranked.slice(0, limits.maxOrdersPerPass)) {
      if (stats.budgetExhausted) break;
      stats.ordersTried++;

      const restRects = rects.filter((_, i) => i !== index);
      const items = group.candidate.placements.map((p) => p.item);
      const minimal = minimalFootprint(group, rule);

      // Free space of EVERY sheet with this order removed (its own old area included).
      const slots: Slot[] = [];
      for (const sheetIndex of sheetIndices) {
        const occupied = restRects.filter((r) => r.sheetIndex === sheetIndex);
        for (const free of replayFreeRects(occupied, packSheetWidth, packSheetHeight, gap)) {
          const region = classifyRelocation(group, { sheetIndex, x: free.x + margin, y: free.y + margin });
          slots.push({ sheetIndex, free, width: free.width - gap, height: free.height - gap, region });
        }
      }
      const foreignAll = slots.filter((s) => s.region === "FOREIGN_RELOCATION");
      stats.foreignSlotsDetected += foreignAll.length;
      stats.selfSlotsDetected += slots.length - foreignAll.length;
      stats.slotsDetected += slots.length;

      const promising = slots.filter((slot) => {
        if (!slotCanPossiblyHold(items, slot.width, slot.height, config.partGapMm, rule)) return false;
        // Optimistic bound: even the order's smallest possible footprint at this slot must beat the current score.
        const bound = scoreRects(
          [...restRects, { x: slot.free.x, y: slot.free.y, width: Math.min(minimal.width, slot.width), height: Math.min(minimal.height, slot.height), sheetIndex: slot.sheetIndex }],
          config
        );
        return improvementLevel(bound, currentScore, limits.acceptFragmentationGain) !== null;
      });
      stats.slotsPruned += slots.length - promising.length;

      // FOREIGN first (other sheets before the order's own sheet), then SELF.
      const foreign = promising
        .filter((s) => s.region === "FOREIGN_RELOCATION")
        .sort(
          (a, b) =>
            Number(a.sheetIndex === group.sheetIndex) - Number(b.sheetIndex === group.sheetIndex) ||
            a.sheetIndex - b.sheetIndex ||
            a.free.y - b.free.y ||
            a.free.x - b.free.x ||
            b.width * b.height - a.width * a.height
        )
        .slice(0, limits.maxForeignSlotsPerOrder);
      const self = promising
        .filter((s) => s.region === "SELF_REFLOW")
        .sort((a, b) => a.free.y - b.free.y || a.free.x - b.free.x || b.width * b.height - a.width * a.height)
        .slice(0, limits.maxSelfSlotsPerOrder);

      for (const slot of [...foreign, ...self]) {
        if (remaining() <= 0) {
          stats.budgetExhausted = true;
          break;
        }
        stats.slotsTried++;
        if (slot.region === "FOREIGN_RELOCATION") stats.foreignSlotsTried++;
        else stats.selfSlotsTried++;

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
            slot.region === "SELF_REFLOW" &&
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
          const level = improvementLevel(score, currentScore, limits.acceptFragmentationGain);
          if (level === null) {
            stats.rejectedNotBetter++;
            continue;
          }
          // Best move of the pass: keep only a strictly better global score (ties keep the earlier, foreign-first one).
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
            level,
            move: {
              type: classifyRelocation(group, { sheetIndex: slot.sheetIndex, x, y }),
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
    const remap = (sheetIndex: number | null) => (sheetIndex === null ? null : (best!.mapping.get(sheetIndex) ?? null));
    for (const move of stats.moves) {
      move.finalSheetIndex = remap(move.finalSheetIndex);
      move.finalFromSheetIndex = remap(move.finalFromSheetIndex);
    }
    const before = best.move.before.sumUsedHeight;
    const after = sheetHeightOf(best.score, config);
    stats.moves.push({
      ...best.move,
      improvement: best.level,
      after: { sheetCount: best.score.sheetCount, sumUsedHeight: after },
      heightSavedMm: before - after,
      heightSavedPercent: before > 0 ? ((before - after) / before) * 100 : 0,
      sheetRemoved: best.score.sheetCount < currentScore.sheetCount,
      finalSheetIndex: best.mapping.get(best.move.toSheetIndex) ?? null,
      finalFromSheetIndex: best.mapping.get(best.move.fromSheetIndex) ?? null,
    });
    stats.acceptedRelocations++;
    if (best.move.type === "FOREIGN_RELOCATION") stats.acceptedForeignRelocation++;
    else stats.acceptedSelfReflow++;
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
      } else if (!isStrictlyBetter(after, before, limits.acceptFragmentationGain)) {
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
    ordersConsidered: 0,
    ordersTried: 0,
    slotsDetected: 0,
    foreignSlotsDetected: 0,
    selfSlotsDetected: 0,
    slotsPruned: 0,
    slotsTried: 0,
    foreignSlotsTried: 0,
    selfSlotsTried: 0,
    reflowAttempts: 0,
    successfulReflows: 0,
    layoutEvaluations: 0,
    acceptedRelocations: 0,
    acceptedSelfReflow: 0,
    acceptedForeignRelocation: 0,
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
