/**
 * Grouped Nesting V3A-3 (EXPERIMENTAL, OPT-IN) — bounded two-group compound
 * moves / slot consolidation.
 *
 * The V3A-2B audit showed the single-move search is exhaustive for its
 * neighborhood: every foreign slot of the real dataset was either too small
 * or provably unable to improve on its own. This stage widens the
 * neighborhood to TWO receipts:
 *
 *   S0 --(primary A -> A')--> S1 --(secondary B -> B')--> S2
 *
 * S1 is a temporary state: it may be worse than S0 (up to
 * `maxIntermediatePenaltyMm` of summed used height, never more sheets) and
 * is never returned on its own. Free space is rebuilt from scratch in S1, so
 * A's move can merge narrow fragments or open a region B then fills. The
 * compound move is accepted only when FINAL S2 is strictly better than S0
 * (same lexicographic objective as V3A-2). Each pass evaluates every bounded
 * (A', B') pair and applies the single best S2.
 *
 * Still one receipt = one group: A and B each move as a whole group, items
 * keep their own size (reflow only re-arranges them), nothing is split,
 * mixed, dropped or duplicated. States are built immutably; S0 is never
 * mutated.
 */
import { replayFreeRects, type FreeRect } from "./outer-maxrects";
import { compareScores, type GlobalLayoutScore } from "./grouped-nesting-global";
import { reflowOrderIntoSlot, slotCanPossiblyHold, V2_ROTATION_RULE, type RotationRule } from "./slot-reflow";
import {
  classifyRelocation,
  improvementLevel,
  minimalFootprint,
  normalizeSheets,
  placeGroup,
  scoreRects,
  sheetHeightOf,
  usableRects,
  validateLayout,
  type RelocationType,
  type SlotReflowStage,
} from "./grouped-nesting-v3";
import type { GroupedNestingConfig } from "./grouped-nesting";
import type { GroupPlacement, OrderLayoutCandidate } from "./grouped-nesting-types";

export interface CompoundLimits {
  /** Max compound passes; each pass applies at most one (A, B) pair. */
  maxPasses: number;
  /** Primary groups tried per pass, in ranking order. */
  topKPrimary: number;
  /** Free slots tried per primary group. */
  maxPrimarySlots: number;
  /** Temporary S1 states kept per primary group (best slot-consolidation first). */
  topKPrimaryVariants: number;
  /** Secondary groups tried per S1. */
  topKSecondary: number;
  /** Target slots tried per secondary group. */
  topKTargetSlots: number;
  /** Max reflow packings per (group, slot). */
  maxReflowVariants: number;
  /** How much summed used height (mm) the temporary S1 may add over S0. */
  maxIntermediatePenaltyMm: number;
  /** Hard cap on reflow packings + state evaluations across the whole stage. */
  maxEvaluations: number;
  /** Same tertiary rule as V3A-2 (summed bounding area). */
  acceptFragmentationGain: boolean;
}

export const DEFAULT_COMPOUND_LIMITS: CompoundLimits = {
  maxPasses: 3,
  topKPrimary: 6,
  maxPrimarySlots: 8,
  topKPrimaryVariants: 8,
  topKSecondary: 4,
  topKTargetSlots: 6,
  maxReflowVariants: 25,
  maxIntermediatePenaltyMm: 20,
  maxEvaluations: 20000,
  acceptFragmentationGain: true,
};

export interface CompoundGroupMove {
  type: RelocationType;
  orderId: number | null;
  source: "NORMAL" | "SLOT_REFLOW";
  strategy: string;
  fromSheetIndex: number;
  fromX: number;
  fromY: number;
  beforeWidth: number;
  beforeHeight: number;
  toSheetIndex: number;
  toX: number;
  toY: number;
  afterWidth: number;
  afterHeight: number;
}

export interface SlotSummary {
  /** Non-degenerate free slots (usable width and height > 0) on the sheets A left and entered. */
  freeSlots: number;
  /** The largest such slot by area (usable size). */
  largest: { width: number; height: number; area: number };
}

export interface CompoundMoveDetail {
  /** Sheet indices of `primary` are S0 numbering; of `secondary`, S1 numbering. */
  primary: CompoundGroupMove;
  secondary: CompoundGroupMove;
  /** Free space of the sheet(s) A left and entered, S0 vs S1. */
  slotEffect: { before: SlotSummary; after: SlotSummary };
  before: { sheetCount: number; sumUsedHeight: number };
  intermediate: { sheetCount: number; sumUsedHeight: number };
  final: { sheetCount: number; sumUsedHeight: number };
  netSavingMm: number;
  netSavingPercent: number;
  sheetRemoved: boolean;
}

export interface CompoundDiagnostics {
  /** The layout this stage started from (the V3A-2 result). */
  baseline: { sheetCount: number; sumUsedHeight: number };
  final: { sheetCount: number; sumUsedHeight: number };
  sheetsAvoided: number;
  heightSavedMm: number;
  heightSavedPercent: number;
  passes: number;
  primaryGroupsConsidered: number;
  primaryMovesTried: number;
  /** A' placements dropped because S1 would add more than maxIntermediatePenaltyMm. */
  primaryRejectedPenalty: number;
  temporaryStatesGenerated: number;
  slotsAfterConsolidation: number;
  secondaryGroupsConsidered: number;
  pairAttempts: number;
  pairStatesEvaluated: number;
  validPairStates: number;
  strictlyBetterPairStates: number;
  acceptedCompoundMoves: number;
  budgetUsed: number;
  budgetLimit: number;
  budgetExhausted: boolean;
  limits: CompoundLimits;
  moves: CompoundMoveDetail[];
  runtimeMs: number | null;
}

type Config = GroupedNestingConfig;
type Rect = { x: number; y: number; width: number; height: number; sheetIndex: number };

const POSITION_EPSILON = 0.01;
const GEOMETRY_EPSILON = 1e-6;
/** A free rect narrower/shorter than this (usable mm) counts as a fragment for the primary ranking. */
const FRAGMENT_MM = 40;

interface Slot {
  sheetIndex: number;
  free: FreeRect;
  width: number;
  height: number;
}

interface Shape<T> {
  candidate: OrderLayoutCandidate<T>;
  source: "NORMAL" | "SLOT_REFLOW";
}

interface TemporaryState<T> {
  groups: GroupPlacement<T>[];
  score: GlobalLayoutScore;
  penalty: number;
  consolidationGain: number;
  slotsBefore: SlotSummary;
  slotsAfter: SlotSummary;
  move: CompoundGroupMove;
  /** Index of A in `groups` (normalization keeps order). */
  primaryIndex: number;
}

/**
 * Bounded best-improvement search over two-group compound moves starting
 * from an already-valid layout. Pure and deterministic.
 */
export function improveWithCompoundMoves<T>(
  baseline: GroupPlacement<T>[],
  config: Config,
  limits: CompoundLimits = DEFAULT_COMPOUND_LIMITS,
  rule: RotationRule = V2_ROTATION_RULE
): { groups: GroupPlacement<T>[]; diagnostics: Omit<CompoundDiagnostics, "runtimeMs"> } {
  const margin = config.sheetMarginMm;
  const gap = config.orderGapMm;
  const packW = config.sheetWidth - 2 * margin;
  const packH = config.sheetHeight - 2 * margin;

  const d = {
    passes: 0,
    primaryGroupsConsidered: 0,
    primaryMovesTried: 0,
    primaryRejectedPenalty: 0,
    temporaryStatesGenerated: 0,
    slotsAfterConsolidation: 0,
    secondaryGroupsConsidered: 0,
    pairAttempts: 0,
    pairStatesEvaluated: 0,
    validPairStates: 0,
    strictlyBetterPairStates: 0,
    acceptedCompoundMoves: 0,
    budgetUsed: 0,
    budgetLimit: limits.maxEvaluations,
    budgetExhausted: false,
    limits,
    moves: [] as CompoundMoveDetail[],
  };
  const remaining = () => limits.maxEvaluations - d.budgetUsed;
  const spend = (n: number) => {
    d.budgetUsed += n;
    if (remaining() <= 0) d.budgetExhausted = true;
  };

  const slotsOf = (rects: Rect[], sheets: number[]): Slot[] =>
    sheets.flatMap((sheetIndex) =>
      replayFreeRects(
        rects.filter((r) => r.sheetIndex === sheetIndex),
        packW,
        packH,
        gap
      ).map((free) => ({ sheetIndex, free, width: free.width - gap, height: free.height - gap }))
    );
  const summarize = (slots: Slot[]): SlotSummary => {
    const usable = slots.filter((s) => s.width > 0 && s.height > 0);
    let largest = { width: 0, height: 0, area: 0 };
    for (const s of usable) if (s.width * s.height > largest.area) largest = { width: s.width, height: s.height, area: s.width * s.height };
    return { freeSlots: usable.length, largest };
  };
  const sheetsOf = (rects: Rect[]) => [...new Set(rects.map((r) => r.sheetIndex))].sort((a, b) => a - b);
  const shapesFor = (group: GroupPlacement<T>, slot: Slot, maxVariants: number): { shapes: Shape<T>[]; attempts: number } => {
    const normal = group.alternatives
      .filter((c) => c.width <= slot.width + GEOMETRY_EPSILON && c.height <= slot.height + GEOMETRY_EPSILON)
      .map((candidate) => ({ candidate, source: "NORMAL" as const }));
    const reflow = reflowOrderIntoSlot(
      group.candidate.placements.map((p) => p.item),
      slot.width,
      slot.height,
      config.partGapMm,
      { orderId: group.orderId, maxVariants, rule }
    );
    return { shapes: [...normal, ...reflow.candidates.map((candidate) => ({ candidate, source: "SLOT_REFLOW" as const }))], attempts: reflow.attempts };
  };
  const isNoOp = (group: GroupPlacement<T>, slot: Slot, c: OrderLayoutCandidate<T>) =>
    slot.sheetIndex === group.sheetIndex &&
    Math.abs(slot.free.x + margin - group.x) < POSITION_EPSILON &&
    Math.abs(slot.free.y + margin - group.y) < POSITION_EPSILON &&
    Math.abs(c.width - group.width) < POSITION_EPSILON &&
    Math.abs(c.height - group.height) < POSITION_EPSILON;
  const moveOf = (group: GroupPlacement<T>, slot: Slot, shape: Shape<T>): CompoundGroupMove => ({
    type: classifyRelocation(group, { sheetIndex: slot.sheetIndex, x: slot.free.x + margin, y: slot.free.y + margin }),
    orderId: group.orderId,
    source: shape.source,
    strategy: shape.candidate.strategy,
    fromSheetIndex: group.sheetIndex,
    fromX: group.x,
    fromY: group.y,
    beforeWidth: group.width,
    beforeHeight: group.height,
    toSheetIndex: slot.sheetIndex,
    toX: slot.free.x + margin,
    toY: slot.free.y + margin,
    afterWidth: shape.candidate.width,
    afterHeight: shape.candidate.height,
  });
  const withMoved = (groups: GroupPlacement<T>[], index: number, slot: Slot, c: OrderLayoutCandidate<T>) => {
    const g = groups[index];
    const moved = placeGroup(c, slot.free.x + margin, slot.free.y + margin, slot.sheetIndex, { alternatives: g.alternatives, localCandidate: g.localCandidate });
    return normalizeSheets(groups.map((other, i) => (i === index ? moved : other)));
  };

  let current = baseline;
  let currentScore = scoreRects(usableRects(current, config), config);

  for (let pass = 0; pass < limits.maxPasses && !d.budgetExhausted; pass++) {
    d.passes++;
    const s0 = current;
    const s0Score = currentScore;
    const s0Height = sheetHeightOf(s0Score, config);
    const rects0 = usableRects(s0, config);
    const sheets0 = sheetsOf(rects0);
    const slots0 = slotsOf(rects0, sheets0);
    const bottom = (rects: Rect[], sheetIndex: number, skip: number) =>
      Math.max(-Infinity, ...rects.filter((r, i) => i !== skip && r.sheetIndex === sheetIndex).map((r) => r.y + r.height));

    // PRIMARY ranking: most fragment slots touching the group's padded box, then closest
    // to its sheet's used height, last sheet, more V2 shapes, larger area, orderId.
    const touches = (r: Rect, free: FreeRect) => {
      const nx = r.x;
      const ny = r.y;
      const nr = r.x + r.width + gap;
      const nb = r.y + r.height + gap;
      const overlapY = free.y < nb && free.y + free.height > ny;
      const overlapX = free.x < nr && free.x + free.width > nx;
      return (
        (overlapY && (Math.abs(free.x - nr) < GEOMETRY_EPSILON || Math.abs(free.x + free.width - nx) < GEOMETRY_EPSILON)) ||
        (overlapX && (Math.abs(free.y - nb) < GEOMETRY_EPSILON || Math.abs(free.y + free.height - ny) < GEOMETRY_EPSILON))
      );
    };
    const primaries = s0
      .map((g, index) => {
        const r = rects0[index];
        const fragments = slots0.filter(
          (s) => s.sheetIndex === r.sheetIndex && Math.min(s.width, s.height) < FRAGMENT_MM && touches(r, s.free)
        ).length;
        const sheetBottom = bottom(rects0, r.sheetIndex, -1);
        return { g, index, fragments, toBottom: sheetBottom - (r.y + r.height) };
      })
      .sort(
        (a, b) =>
          b.fragments - a.fragments ||
          a.toBottom - b.toBottom ||
          b.g.sheetIndex - a.g.sheetIndex ||
          b.g.alternatives.length - a.g.alternatives.length ||
          b.g.width * b.g.height - a.g.width * a.g.height ||
          (a.g.orderId ?? -1) - (b.g.orderId ?? -1) ||
          a.g.candidate.candidateId.localeCompare(b.g.candidate.candidateId)
      )
      .slice(0, limits.topKPrimary);

    let best: { groups: GroupPlacement<T>[]; score: GlobalLayoutScore; detail: CompoundMoveDetail } | null = null;

    for (const { g: a, index: ai } of primaries) {
      if (d.budgetExhausted) break;
      d.primaryGroupsConsidered++;
      const rest = rects0.filter((_, i) => i !== ai);
      const minimalA = minimalFootprint(a, rule);
      const itemsA = a.candidate.placements.map((p) => p.item);

      // A' candidates: any slot (self or foreign) where even A's smallest footprint stays within the penalty.
      const slotsA = slotsOf(rest, sheets0)
        .filter((slot) => {
          if (!slotCanPossiblyHold(itemsA, slot.width, slot.height, config.partGapMm, rule)) return false;
          const bound = scoreRects(
            [...rest, { x: slot.free.x, y: slot.free.y, width: Math.min(minimalA.width, slot.width), height: Math.min(minimalA.height, slot.height), sheetIndex: slot.sheetIndex }],
            config
          );
          return bound.sheetCount <= s0Score.sheetCount && sheetHeightOf(bound, config) - s0Height <= limits.maxIntermediatePenaltyMm + GEOMETRY_EPSILON;
        })
        .sort((x, y) => x.free.y - y.free.y || x.sheetIndex - y.sheetIndex || x.free.x - y.free.x || y.width * y.height - x.width * x.height)
        .slice(0, limits.maxPrimarySlots);

      const variants: TemporaryState<T>[] = [];
      for (const slot of slotsA) {
        if (d.budgetExhausted) break;
        const { shapes, attempts } = shapesFor(a, slot, Math.min(limits.maxReflowVariants, remaining()));
        spend(attempts);
        for (const shape of shapes) {
          if (d.budgetExhausted) break;
          if (isNoOp(a, slot, shape.candidate)) continue;
          spend(1);
          d.primaryMovesTried++;
          const score = scoreRects([...rest, { x: slot.free.x, y: slot.free.y, width: shape.candidate.width, height: shape.candidate.height, sheetIndex: slot.sheetIndex }], config);
          const penalty = sheetHeightOf(score, config) - s0Height;
          if (score.sheetCount > s0Score.sheetCount || penalty > limits.maxIntermediatePenaltyMm + GEOMETRY_EPSILON) {
            d.primaryRejectedPenalty++;
            continue;
          }
          const { groups, mapping } = withMoved(s0, ai, slot, shape.candidate);
          if (validateLayout(groups, config).length > 0) continue;
          // Slot consolidation: largest usable slot on the sheet(s) A left and entered, before vs after.
          const touched0 = [...new Set([a.sheetIndex, slot.sheetIndex])];
          const touched1 = touched0.map((sheet) => mapping.get(sheet)).filter((sheet): sheet is number => sheet !== undefined);
          const slotsBefore = summarize(slots0.filter((s) => touched0.includes(s.sheetIndex)));
          const slotsAfter = summarize(slotsOf(usableRects(groups, config), touched1));
          variants.push({
            groups,
            score,
            penalty,
            consolidationGain: score.sheetCount < s0Score.sheetCount ? Infinity : slotsAfter.largest.area - slotsBefore.largest.area,
            slotsBefore,
            slotsAfter,
            move: moveOf(a, slot, shape),
            primaryIndex: ai,
          });
        }
      }

      // Keep the S1 states that open the most usable space (then least penalty; generation order breaks ties).
      const kept = variants
        .map((v, order) => ({ v, order }))
        .sort((x, y) => y.v.consolidationGain - x.v.consolidationGain || x.v.penalty - y.v.penalty || x.order - y.order)
        .slice(0, limits.topKPrimaryVariants)
        .map((x) => x.v);

      for (const s1 of kept) {
        if (d.budgetExhausted) break;
        d.temporaryStatesGenerated++;
        const rects1 = usableRects(s1.groups, config);
        const sheets1 = sheetsOf(rects1);

        // SECONDARY ranking: sets its sheet's height in S1, last sheet, taller, larger, more V2 shapes, orderId.
        const secondaries = s1.groups
          .map((g, index) => ({ g, index, critical: bottom(rects1, rects1[index].sheetIndex, index) < rects1[index].y + rects1[index].height - POSITION_EPSILON }))
          .filter((x) => x.index !== s1.primaryIndex)
          .sort(
            (x, y) =>
              Number(y.critical) - Number(x.critical) ||
              y.g.sheetIndex - x.g.sheetIndex ||
              y.g.height - x.g.height ||
              y.g.width * y.g.height - x.g.width * x.g.height ||
              y.g.alternatives.length - x.g.alternatives.length ||
              (x.g.orderId ?? -1) - (y.g.orderId ?? -1) ||
              x.g.candidate.candidateId.localeCompare(y.g.candidate.candidateId)
          )
          .slice(0, limits.topKSecondary);

        for (const { g: b, index: bi } of secondaries) {
          if (d.budgetExhausted) break;
          d.secondaryGroupsConsidered++;
          const rest1 = rects1.filter((_, i) => i !== bi);
          const minimalB = minimalFootprint(b, rule);
          const itemsB = b.candidate.placements.map((p) => p.item);
          const all = slotsOf(rest1, sheets1);
          d.slotsAfterConsolidation += all.length;

          // Only slots where B's smallest footprint could make FINAL S2 beat S0 (lossless bound); cross-sheet, earlier sheets first.
          const targets = all
            .filter((slot) => {
              if (!slotCanPossiblyHold(itemsB, slot.width, slot.height, config.partGapMm, rule)) return false;
              const bound = scoreRects(
                [...rest1, { x: slot.free.x, y: slot.free.y, width: Math.min(minimalB.width, slot.width), height: Math.min(minimalB.height, slot.height), sheetIndex: slot.sheetIndex }],
                config
              );
              return improvementLevel(bound, s0Score, limits.acceptFragmentationGain) !== null;
            })
            .sort(
              (x, y) =>
                Number(x.sheetIndex === b.sheetIndex) - Number(y.sheetIndex === b.sheetIndex) ||
                x.sheetIndex - y.sheetIndex ||
                x.free.y - y.free.y ||
                x.free.x - y.free.x ||
                y.width * y.height - x.width * x.height
            )
            .slice(0, limits.topKTargetSlots);

          for (const slot of targets) {
            if (d.budgetExhausted) break;
            d.pairAttempts++;
            const { shapes, attempts } = shapesFor(b, slot, Math.min(limits.maxReflowVariants, remaining()));
            spend(attempts);
            for (const shape of shapes) {
              if (d.budgetExhausted) break;
              if (isNoOp(b, slot, shape.candidate)) continue;
              spend(1);
              d.pairStatesEvaluated++;
              const score = scoreRects([...rest1, { x: slot.free.x, y: slot.free.y, width: shape.candidate.width, height: shape.candidate.height, sheetIndex: slot.sheetIndex }], config);
              const { groups } = withMoved(s1.groups, bi, slot, shape.candidate);
              if (validateLayout(groups, config).length > 0) continue;
              d.validPairStates++;
              if (improvementLevel(score, s0Score, limits.acceptFragmentationGain) === null) continue;
              d.strictlyBetterPairStates++;
              if (best && compareScores(score, best.score) >= 0) continue;
              const finalHeight = sheetHeightOf(score, config);
              best = {
                groups,
                score,
                detail: {
                  primary: s1.move,
                  secondary: moveOf(b, slot, shape),
                  slotEffect: { before: s1.slotsBefore, after: s1.slotsAfter },
                  before: { sheetCount: s0Score.sheetCount, sumUsedHeight: s0Height },
                  intermediate: { sheetCount: s1.score.sheetCount, sumUsedHeight: sheetHeightOf(s1.score, config) },
                  final: { sheetCount: score.sheetCount, sumUsedHeight: finalHeight },
                  netSavingMm: s0Height - finalHeight,
                  netSavingPercent: s0Height > 0 ? ((s0Height - finalHeight) / s0Height) * 100 : 0,
                  sheetRemoved: score.sheetCount < s0Score.sheetCount,
                },
              };
            }
          }
        }
      }
    }

    if (!best) break;
    d.moves.push(best.detail);
    d.acceptedCompoundMoves++;
    current = best.groups;
    currentScore = best.score;
  }

  const startHeight = sheetHeightOf(scoreRects(usableRects(baseline, config), config), config);
  const startSheets = new Set(baseline.map((g) => g.sheetIndex)).size;
  const endHeight = sheetHeightOf(currentScore, config);
  return {
    groups: current,
    diagnostics: {
      ...d,
      baseline: { sheetCount: startSheets, sumUsedHeight: startHeight },
      final: { sheetCount: currentScore.sheetCount, sumUsedHeight: endHeight },
      sheetsAvoided: startSheets - currentScore.sheetCount,
      heightSavedMm: startHeight - endHeight,
      heightSavedPercent: startHeight > 0 ? ((startHeight - endHeight) / startHeight) * 100 : 0,
    },
  };
}

/** The opt-in V3A-3 stage for applySlotReflow / runGroupedNestingV3. */
export function compoundStage<T>(
  config: Config,
  limits: CompoundLimits = DEFAULT_COMPOUND_LIMITS,
  options: { clock?: () => number; rule?: RotationRule } = {}
): SlotReflowStage<T> {
  return {
    run(groups) {
      const startedAt = options.clock?.();
      const { groups: out, diagnostics } = improveWithCompoundMoves(groups, config, limits, options.rule ?? V2_ROTATION_RULE);
      const runtimeMs = startedAt !== undefined && options.clock ? options.clock() - startedAt : null;
      return { groups: out, diagnostics: { ...diagnostics, runtimeMs } };
    },
  };
}

/** Request flag for the dry-run API: `slotReflowCompound: true` (only together with `slotReflow: true`). */
export function isCompoundRequest(body: unknown): boolean {
  const b = body as { slotReflow?: unknown; slotReflowCompound?: unknown } | null;
  return b?.slotReflow === true && b?.slotReflowCompound === true;
}
