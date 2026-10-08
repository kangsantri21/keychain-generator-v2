/**
 * Grouped Nesting V2 — Phase 2E multi-heuristic outer packing.
 *
 * Phase 2D scored every candidate combination with ONE outer packing (the
 * legacy BSSF + area-descending `packMaxRects`). Phase 2E scores each
 * combination with several placement heuristics x group sort orders
 * (outer-maxrects.ts) and keeps the best outer layout, under explicit pack
 * budgets.
 *
 * Final result = best of:
 *   A. Phase 2C local picks, legacy outer pack
 *   B. Phase 2D global picks, legacy outer pack
 *   A'/B'. those same picks re-packed with every outer strategy (B' only
 *          when Phase 2D actually changed the picks)
 *   C. a Phase 2D-style beam search whose states are scored multi-strategy
 * Ties go to the earliest entry in that list, so Phase 2E never scores worse
 * than Phase 2D, and Phase 2D never worse than Phase 2C.
 */
import {
  compareScores,
  scoreOuterPlacements,
  selectGlobalCandidates,
  DEFAULT_GLOBAL_SEARCH_LIMITS,
  LEGACY_STRATEGY_ID,
  type GlobalLayoutScore,
  type GlobalOrderInput,
  type GlobalSearchStats,
  type GlobalSearchLimits,
  type OuterLayoutEvaluator,
  type OuterPackConfig,
} from "./grouped-nesting-global";
import {
  packOuterRects,
  OUTER_PACKING_STRATEGIES,
  PLACEMENT_HEURISTICS,
  SORT_STRATEGIES,
  LEGACY_OUTER_STRATEGY,
  type OuterPackingStrategy,
} from "./outer-maxrects";
import type { OrderLayoutCandidate } from "./grouped-nesting-types";

export interface OuterPackingLimits {
  /** How many placement heuristics (from PLACEMENT_HEURISTICS, in order) may be used. */
  maxOuterStrategies: number;
  /** How many sort orders (from SORT_STRATEGIES, in order) may be used. */
  maxSortVariants: number;
  /** Max heuristic x sort attempts per candidate state. */
  maxOuterAttemptsPerState: number;
  /** Hard cap on outer packings across the whole optimization (Phase 2D + 2E). */
  maxTotalPackEvaluations: number;
}

export const DEFAULT_OUTER_PACKING_LIMITS: OuterPackingLimits = {
  maxOuterStrategies: PLACEMENT_HEURISTICS.length,
  maxSortVariants: SORT_STRATEGIES.length,
  maxOuterAttemptsPerState: PLACEMENT_HEURISTICS.length * SORT_STRATEGIES.length,
  maxTotalPackEvaluations: 12000,
};

export type LayoutSource = "phase2c" | "phase2d" | "phase2e";

export interface OuterOptimizerStats {
  strategy: "beam+multi-outer";
  beamWidth: number;
  /** Candidate states (selections) scored across the Phase 2D and Phase 2E searches. */
  candidateStatesEvaluated: number;
  /** Individual outer packings run, all phases. Never above `maxTotalPackEvaluations`. */
  outerPackAttempts: number;
  /** Distinct heuristic x sort strategies available to this run. */
  strategiesTried: number;
  /** Strategies actually tried per Phase 2E search state (budget-scaled). */
  attemptsPerState: number;
  limitReached: boolean;
  phase2cScore: GlobalLayoutScore;
  phase2dScore: GlobalLayoutScore;
  finalScore: GlobalLayoutScore;
  /** Which phase's CANDIDATE SELECTION won (independent of the outer strategy — see selectedStrategyId). */
  candidateSource: LayoutSource;
  selectedStrategyId: string;
  selectedHeuristic: string;
  selectedSort: string;
  /** usedHeight reduction vs. the baseline, percent (0 if not strictly better). */
  improvementVsPhase2CPercent: number;
  improvementVsPhase2DPercent: number;
  /** The Phase 2D search's own stats, unchanged from that checkpoint. */
  phase2d: GlobalSearchStats;
}

/** usedHeight reduction (the primary objective), percent; 0 when not strictly better. */
function improvement(baseline: GlobalLayoutScore, final: GlobalLayoutScore): number {
  if (compareScores(final, baseline) >= 0 || baseline.usedHeight <= 0) return 0;
  return ((baseline.usedHeight - final.usedHeight) / baseline.usedHeight) * 100;
}

export function allowedOuterStrategies(limits: OuterPackingLimits): OuterPackingStrategy[] {
  const heuristics = PLACEMENT_HEURISTICS.slice(0, Math.max(1, limits.maxOuterStrategies));
  const sorts = SORT_STRATEGIES.slice(0, Math.max(1, limits.maxSortVariants));
  return OUTER_PACKING_STRATEGIES.filter((s) => heuristics.includes(s.heuristic) && sorts.includes(s.sort));
}

/** Outer-packs a selection with one strategy exactly like `packGroupsOntoSheet` (usable area = sheet minus margins). */
export function packSelection<T>(selection: OrderLayoutCandidate<T>[], config: OuterPackConfig, strategy: OuterPackingStrategy) {
  return packOuterRects(
    selection.map((c) => ({ width: c.width, height: c.height, data: c })),
    config.sheetWidth - 2 * config.sheetMarginMm,
    config.sheetHeight - 2 * config.sheetMarginMm,
    config.orderGapMm,
    strategy
  );
}

/** Pack-budgeted evaluator: tries up to `attempts` strategies (legacy first), keeps the best. */
class MultiStrategyEvaluator<T> implements OuterLayoutEvaluator<T> {
  packs = 0;

  constructor(
    private readonly config: OuterPackConfig,
    private readonly strategies: OuterPackingStrategy[],
    private readonly attempts: number,
    private readonly budget: number
  ) {}

  evaluate(selection: OrderLayoutCandidate<T>[]): { score: GlobalLayoutScore; strategyId: string } {
    let best: { score: GlobalLayoutScore; strategyId: string } | null = null;
    const tries = this.strategies.slice(0, this.attempts);
    for (let i = 0; i < tries.length; i++) {
      // The first strategy always runs so every state gets a real score.
      if (i > 0 && this.exhausted()) break;
      const strategy = tries[i];
      const usableWidth = this.config.sheetWidth - 2 * this.config.sheetMarginMm;
      const score = scoreOuterPlacements(packSelection(selection, this.config, strategy), selection.length, usableWidth);
      this.packs++;
      if (!best || compareScores(score, best.score) < 0) best = { score, strategyId: strategy.id };
    }
    return best!;
  }

  exhausted(): boolean {
    return this.packs >= this.budget;
  }
}

/**
 * Chooses one candidate per order AND the outer packing strategy. Returns
 * the selection in the same order as `orders` (what packGroupsOntoSheet
 * expects) plus the winning strategy.
 */
export function optimizeOuterLayout<T>(
  orders: GlobalOrderInput<T>[],
  config: OuterPackConfig,
  searchLimits: GlobalSearchLimits = DEFAULT_GLOBAL_SEARCH_LIMITS,
  outerLimits: OuterPackingLimits = DEFAULT_OUTER_PACKING_LIMITS
): { selected: OrderLayoutCandidate<T>[]; strategy: OuterPackingStrategy; stats: OuterOptimizerStats } {
  const strategies = allowedOuterStrategies(outerLimits);
  const strategyById = new Map(strategies.map((s) => [s.id, s]));
  strategyById.set(LEGACY_STRATEGY_ID, LEGACY_OUTER_STRATEGY);
  const maxAttempts = Math.max(1, Math.min(outerLimits.maxOuterAttemptsPerState, strategies.length));

  // Phase 2D exactly as checkpointed (legacy outer pack, one pack per state).
  // Its state cap is also clamped to the TOTAL pack budget so a small
  // maxTotalPackEvaluations is a true hard limit; with the defaults
  // (3000 <= 12000) Phase 2D runs unchanged.
  const phase2dLimits = {
    ...searchLimits,
    maxStatesEvaluated: Math.max(1, Math.min(searchLimits.maxStatesEvaluated, outerLimits.maxTotalPackEvaluations)),
  };
  const phase2d = selectGlobalCandidates(orders, config, phase2dLimits);
  const phase2cScore = phase2d.stats.baselineScore;
  const phase2dScore = phase2d.stats.usedBaseline ? phase2cScore : phase2d.stats.optimizedScore;
  const localSelection = orders.map((order) => order.local);
  let packsUsed = phase2d.stats.statesEvaluated;
  let statesUsed = phase2d.stats.statesEvaluated;

  type Entry = { selection: OrderLayoutCandidate<T>[]; score: GlobalLayoutScore; strategyId: string; source: LayoutSource };
  const phase2dSource: LayoutSource = phase2d.stats.usedBaseline ? "phase2c" : "phase2d";
  const pool: Entry[] = [
    { selection: localSelection, score: phase2cScore, strategyId: LEGACY_STRATEGY_ID, source: "phase2c" },
    { selection: phase2d.selected, score: phase2dScore, strategyId: LEGACY_STRATEGY_ID, source: phase2dSource },
  ];

  const remaining = () => Math.max(0, outerLimits.maxTotalPackEvaluations - packsUsed);

  // Re-pack the checkpointed selections with every strategy (cheap, bounded).
  const checkpointed: [OrderLayoutCandidate<T>[], LayoutSource][] = [[localSelection, "phase2c"]];
  if (!phase2d.stats.usedBaseline) checkpointed.push([phase2d.selected, "phase2d"]);
  for (const [selection, source] of checkpointed) {
    const evaluator = new MultiStrategyEvaluator<T>(config, strategies, maxAttempts, remaining());
    if (evaluator.exhausted()) break;
    const result = evaluator.evaluate(selection);
    packsUsed += evaluator.packs;
    statesUsed++;
    pool.push({ selection, ...result, source });
  }

  // Phase 2E search: same beam as Phase 2D, but each state scored multi-strategy.
  // Scale attempts per state so the estimated state count fits the remaining budget.
  const optionCount = orders.reduce((sum, o) => sum + Math.min(o.alternatives.length, searchLimits.maxCandidatesPerOrder), 0);
  const estimatedStates = Math.min(searchLimits.maxStatesEvaluated, 1 + searchLimits.beamWidth * Math.max(1, optionCount));
  const attemptsPerState = Math.max(1, Math.min(maxAttempts, Math.floor(remaining() / estimatedStates)));
  let limitReached = phase2d.stats.limitReached;

  if (remaining() > 0) {
    const evaluator = new MultiStrategyEvaluator<T>(config, strategies, attemptsPerState, remaining());
    const phase2e = selectGlobalCandidates(orders, config, searchLimits, evaluator);
    packsUsed += evaluator.packs;
    statesUsed += phase2e.stats.statesEvaluated;
    limitReached = limitReached || phase2e.stats.limitReached || evaluator.exhausted();
    if (!phase2e.stats.usedBaseline) {
      pool.push({ selection: phase2e.selected, score: phase2e.stats.optimizedScore, strategyId: phase2e.stats.outerStrategyId, source: "phase2e" });
    }
  } else {
    limitReached = true;
  }

  let best = pool[0];
  for (const entry of pool) if (compareScores(entry.score, best.score) < 0) best = entry;

  const strategy = strategyById.get(best.strategyId) ?? LEGACY_OUTER_STRATEGY;
  return {
    selected: best.selection,
    strategy,
    stats: {
      strategy: "beam+multi-outer",
      beamWidth: searchLimits.beamWidth,
      candidateStatesEvaluated: statesUsed,
      outerPackAttempts: packsUsed,
      strategiesTried: strategies.length,
      attemptsPerState,
      limitReached,
      phase2cScore,
      phase2dScore,
      finalScore: best.score,
      candidateSource: best.source,
      selectedStrategyId: strategy.id,
      selectedHeuristic: strategy.heuristic,
      selectedSort: strategy.sort,
      improvementVsPhase2CPercent: improvement(phase2cScore, best.score),
      improvementVsPhase2DPercent: improvement(phase2dScore, best.score),
      phase2d: phase2d.stats,
    },
  };
}
