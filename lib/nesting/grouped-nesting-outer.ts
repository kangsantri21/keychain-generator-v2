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
  MAX_EXISTING_SHEET_TRIALS,
  emptyMultiSheetPackStats,
  withBestExisting,
  type MultiSheetPackStats,
  type OuterPackingStrategy,
} from "./outer-maxrects";
import type { OrderLayoutCandidate } from "./grouped-nesting-types";
import { outerSpacing } from "./grouped-nesting-config";

export interface OuterPackingLimits {
  /** How many placement heuristics (from PLACEMENT_HEURISTICS, in order) may be used. */
  maxOuterStrategies: number;
  /** How many sort orders (from SORT_STRATEGIES, in order) may be used. */
  maxSortVariants: number;
  /** Max heuristic x sort attempts per candidate state. */
  maxOuterAttemptsPerState: number;
  /** Hard cap on outer packings across the whole optimization (Phase 2D + 2E). */
  maxTotalPackEvaluations: number;
  /** PHASE 2H — separate hard cap on the BEST_EXISTING stage's packings (only spent when the 2G result needs >1 sheet). */
  maxBestExistingPackEvaluations: number;
  /** PHASE 2H — cap on open-sheet trials inside one BEST_EXISTING pack (then: last sheet only). */
  maxExistingSheetTrials: number;
}

export const DEFAULT_OUTER_PACKING_LIMITS: OuterPackingLimits = {
  maxOuterStrategies: PLACEMENT_HEURISTICS.length,
  maxSortVariants: SORT_STRATEGIES.length,
  maxOuterAttemptsPerState: PLACEMENT_HEURISTICS.length * SORT_STRATEGIES.length,
  maxTotalPackEvaluations: 12000,
  maxBestExistingPackEvaluations: 6000,
  maxExistingSheetTrials: MAX_EXISTING_SHEET_TRIALS,
};

export type LayoutSource = "phase2c" | "phase2d" | "phase2e" | "phase2h";

/** PHASE 2H — multi-sheet placement diagnostics ("before" = the Phase 2G LAST_ONLY result). */
export interface MultiSheetPackingStats {
  /** Sheet-placement mode of the final layout. */
  mode: "BEST_EXISTING" | "LAST_ONLY";
  /** Whether the BEST_EXISTING stage ran at all (only when the 2G result needs >1 sheet). */
  bestExistingEvaluated: boolean;
  sheetsBefore: number;
  sheetsAfter: number;
  /** Sum of per-sheet used heights in sheet coordinates (margin included), mm. */
  sumUsedHeightBefore: number;
  sumUsedHeightAfter: number;
  heightSavedMm: number;
  heightSavedPercent: number;
  /** Of the FINAL layout's pack: open sheets tried / groups placed on an earlier sheet / sheets LAST_ONLY would have opened. */
  existingSheetAttempts: number;
  successfulBackfills: number;
  newSheetsAvoided: number;
  /** No post-placement relocation pass exists (see grouped-nesting-outer.ts). */
  relocationPass: "OFF";
  /** Packings spent by the BEST_EXISTING stage (<= maxBestExistingPackEvaluations). */
  packEvaluations: number;
  /** Candidate states scored by the BEST_EXISTING stage. */
  statesEvaluated: number;
}

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
  multiSheet: MultiSheetPackingStats;
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
export function packSelection<T>(
  selection: OrderLayoutCandidate<T>[],
  config: OuterPackConfig,
  strategy: OuterPackingStrategy,
  options: { stats?: MultiSheetPackStats; maxExistingSheetTrials?: number } = {}
) {
  const spacing = outerSpacing(config);
  return packOuterRects(
    selection.map((c) => ({ width: c.width, height: c.height, data: c })),
    config.sheetWidth - 2 * spacing.marginX,
    config.sheetHeight - 2 * spacing.marginY,
    { x: spacing.gapX, y: spacing.gapY },
    strategy,
    { ...options, exactFitSafe: config.outerExactFitSafe ?? false }
  );
}

/** Pack-budgeted evaluator: tries up to `attempts` strategies (legacy first), keeps the best. */
class MultiStrategyEvaluator<T> implements OuterLayoutEvaluator<T> {
  packs = 0;

  constructor(
    private readonly config: OuterPackConfig,
    private readonly strategies: OuterPackingStrategy[],
    private readonly attempts: number,
    private readonly budget: number,
    /** PHASE 2H: also try each strategy in BEST_EXISTING mode when its LAST_ONLY pack needs >1 sheet. */
    private readonly bestExisting: { maxExistingSheetTrials: number } | null = null
  ) {}

  evaluate(selection: OrderLayoutCandidate<T>[]): { score: GlobalLayoutScore; strategyId: string } {
    let best: { score: GlobalLayoutScore; strategyId: string } | null = null;
    const tries = this.strategies.slice(0, this.attempts);
    for (let i = 0; i < tries.length; i++) {
      // The first strategy always runs so every state gets a real score.
      if (i > 0 && this.exhausted()) break;
      const strategy = tries[i];
      const usableWidth = this.config.sheetWidth - 2 * outerSpacing(this.config).marginX;
      const score = scoreOuterPlacements(packSelection(selection, this.config, strategy), selection.length, usableWidth);
      this.packs++;
      if (!best || compareScores(score, best.score) < 0) best = { score, strategyId: strategy.id };

      // On one sheet both modes are identical, so BEST_EXISTING only costs a pack when it can matter.
      if (this.bestExisting && score.sheetCount > 1 && !this.exhausted()) {
        const variant = withBestExisting(strategy);
        const packed = packSelection(selection, this.config, variant, { maxExistingSheetTrials: this.bestExisting.maxExistingSheetTrials });
        const variantScore = scoreOuterPlacements(packed, selection.length, usableWidth);
        this.packs++;
        if (compareScores(variantScore, best.score) < 0) best = { score: variantScore, strategyId: variant.id };
      }
    }
    return best!;
  }

  exhausted(): boolean {
    return this.packs >= this.budget;
  }
}

/**
 * Chooses one candidate per order AND the outer packing strategy (including,
 * PHASE 2H, the sheet-placement mode). Returns the selection in the same
 * order as `orders` (what packGroupsOntoSheet expects) plus the winning
 * strategy.
 *
 * Stage 1 is Phase 2G exactly (`optimizeLastOnly`, every pack LAST_ONLY).
 * Stage 2 runs ONLY when that result needs more than one sheet — on a single
 * sheet both modes place identically, so single-sheet batches come back
 * byte-for-byte unchanged:
 *   a. re-pack the 2G selection and the Phase 2C local selection with every
 *      allowed strategy in BEST_EXISTING mode;
 *   b. re-run the candidate beam search with an evaluator that also tries
 *      BEST_EXISTING per strategy.
 * Final = best of the 2G result and every stage-2 layout under the same
 * multi-sheet score (sheets, then sum of used heights, ...); ties keep 2G.
 * So Phase 2H can never use more sheets, or more total height on the same
 * sheet count, than Phase 2G.
 *
 * No post-placement relocation pass: with BEST_EXISTING the group that
 * opened the last sheet fit no earlier sheet at that moment, and earlier
 * sheets only fill up afterwards, so it can never move back — emptying the
 * last sheet that way is impossible by construction.
 */
export function optimizeOuterLayout<T>(
  orders: GlobalOrderInput<T>[],
  config: OuterPackConfig,
  searchLimits: GlobalSearchLimits = DEFAULT_GLOBAL_SEARCH_LIMITS,
  outerLimits: OuterPackingLimits = DEFAULT_OUTER_PACKING_LIMITS
): { selected: OrderLayoutCandidate<T>[]; strategy: OuterPackingStrategy; stats: OuterOptimizerStats } {
  const phase2g = optimizeLastOnly(orders, config, searchLimits, outerLimits);
  const before = phase2g.stats.finalScore;
  const toSheetHeight = (score: GlobalLayoutScore) => score.usedHeight + score.sheetCount * config.sheetMarginMm;

  type Entry = { selection: OrderLayoutCandidate<T>[]; score: GlobalLayoutScore; strategy: OuterPackingStrategy; source: LayoutSource };
  const pool: Entry[] = [{ selection: phase2g.selected, score: before, strategy: phase2g.strategy, source: phase2g.stats.candidateSource }];

  const budget = outerLimits.maxBestExistingPackEvaluations;
  const trialsOption = { maxExistingSheetTrials: outerLimits.maxExistingSheetTrials };
  const strategies = allowedOuterStrategies(outerLimits);
  const usableWidth = config.sheetWidth - 2 * outerSpacing(config).marginX;
  const runStage2 = before.sheetCount > 1 && budget > 0;
  let packs = 0;
  let extraStates = 0;
  let limitReached = false;

  if (runStage2) {
    // a. Same selections, BEST_EXISTING placement.
    const localSelection = orders.map((order) => order.local);
    for (const [selection, source] of [
      [phase2g.selected, phase2g.stats.candidateSource],
      [localSelection, "phase2c"],
    ] as [OrderLayoutCandidate<T>[], LayoutSource][]) {
      for (const strategy of strategies) {
        if (packs >= budget) {
          limitReached = true;
          break;
        }
        const variant = withBestExisting(strategy);
        const score = scoreOuterPlacements(packSelection(selection, config, variant, trialsOption), selection.length, usableWidth);
        packs++;
        pool.push({ selection, score, strategy: variant, source });
      }
      extraStates++;
    }

    // b. Candidate search scored with BEST_EXISTING as well (2 packs per strategy when multi-sheet).
    if (packs < budget) {
      const remaining = budget - packs;
      const optionCount = orders.reduce((sum, o) => sum + Math.min(o.alternatives.length, searchLimits.maxCandidatesPerOrder), 0);
      const estimatedStates = Math.min(searchLimits.maxStatesEvaluated, 1 + searchLimits.beamWidth * Math.max(1, optionCount));
      const maxAttempts = Math.max(1, Math.min(outerLimits.maxOuterAttemptsPerState, strategies.length));
      const attempts = Math.max(1, Math.min(maxAttempts, Math.floor(remaining / (2 * estimatedStates))));
      const evaluator = new MultiStrategyEvaluator<T>(config, strategies, attempts, remaining, trialsOption);
      const search = selectGlobalCandidates(orders, config, searchLimits, evaluator);
      packs += evaluator.packs;
      extraStates += search.stats.statesEvaluated;
      limitReached = limitReached || search.stats.limitReached || evaluator.exhausted();
      const strategyById = new Map(strategies.flatMap((s) => [s, withBestExisting(s)]).map((s) => [s.id, s]));
      strategyById.set(LEGACY_STRATEGY_ID, LEGACY_OUTER_STRATEGY);
      pool.push({
        selection: search.selected,
        score: search.stats.usedBaseline ? search.stats.baselineScore : search.stats.optimizedScore,
        strategy: strategyById.get(search.stats.outerStrategyId) ?? LEGACY_OUTER_STRATEGY,
        source: "phase2h",
      });
    }
  }

  let best = pool[0];
  for (const entry of pool) if (compareScores(entry.score, best.score) < 0) best = entry;
  const improved = best !== pool[0];

  // Diagnostics of the final layout's own placement (one extra, deterministic pack).
  const packStats = emptyMultiSheetPackStats();
  if (best.strategy.sheetMode === "BEST_EXISTING") packSelection(best.selection, config, best.strategy, { ...trialsOption, stats: packStats });

  const sumBefore = toSheetHeight(before);
  const sumAfter = toSheetHeight(best.score);
  const stats: OuterOptimizerStats = {
    ...phase2g.stats,
    // candidateStatesEvaluated/outerPackAttempts keep their Phase 2E meaning
    // (the 2D/2E stage, <= maxTotalPackEvaluations); the BEST_EXISTING stage
    // has its own budget and is reported under multiSheet.
    limitReached: phase2g.stats.limitReached || limitReached,
    finalScore: best.score,
    candidateSource: improved ? best.source : phase2g.stats.candidateSource,
    selectedStrategyId: best.strategy.id,
    selectedHeuristic: best.strategy.heuristic,
    selectedSort: best.strategy.sort,
    improvementVsPhase2CPercent: improvement(phase2g.stats.phase2cScore, best.score),
    improvementVsPhase2DPercent: improvement(phase2g.stats.phase2dScore, best.score),
    multiSheet: {
      mode: best.strategy.sheetMode === "BEST_EXISTING" ? "BEST_EXISTING" : "LAST_ONLY",
      bestExistingEvaluated: runStage2,
      sheetsBefore: before.sheetCount,
      sheetsAfter: best.score.sheetCount,
      sumUsedHeightBefore: sumBefore,
      sumUsedHeightAfter: sumAfter,
      heightSavedMm: sumBefore - sumAfter,
      heightSavedPercent: sumBefore > 0 ? ((sumBefore - sumAfter) / sumBefore) * 100 : 0,
      existingSheetAttempts: packStats.existingSheetAttempts,
      successfulBackfills: packStats.backfills,
      newSheetsAvoided: packStats.newSheetsAvoided,
      relocationPass: "OFF",
      packEvaluations: packs,
      statesEvaluated: extraStates,
    },
  };

  return { selected: best.selection, strategy: best.strategy, stats };
}

/** Phase 2G exactly: Phase 2C/2D/2E optimization with every pack LAST_ONLY. */
function optimizeLastOnly<T>(
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
      // Overwritten by optimizeOuterLayout; LAST_ONLY by definition here.
      multiSheet: {
        mode: "LAST_ONLY",
        bestExistingEvaluated: false,
        sheetsBefore: best.score.sheetCount,
        sheetsAfter: best.score.sheetCount,
        sumUsedHeightBefore: 0,
        sumUsedHeightAfter: 0,
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
