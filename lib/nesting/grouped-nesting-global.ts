/**
 * Grouped Nesting V2 — Phase 2D global candidate selection.
 *
 * Phase 2C picked each order's inner layout independently (minimum local
 * bounding area), then packed those rectangles onto the sheet. A layout that
 * is locally smallest can still be the wrong SHAPE next to the other orders
 * (e.g. an 80 x 195 mm strip leaving a tall empty column beside it). This
 * module instead chooses exactly ONE candidate per order from each order's
 * Phase 2C Pareto set (`alternatives`) by scoring the resulting OUTER layout.
 *
 * Search: deterministic bounded beam search. Orders are decided largest-
 * first; each depth expands every kept state with each of that order's
 * candidates. Every state is scored as a COMPLETE layout — orders not yet
 * decided keep their Phase 2C local choice — because scoring only the
 * decided groups was measured to discard combinations whose larger partial
 * box leaves exactly the hole a later order fits into. Only the best
 * `beamWidth` states survive each depth (after dropping dominated ones). A hard
 * `maxStatesEvaluated` budget caps total outer-pack evaluations; the beam
 * width shrinks automatically for large batches so the budget spans every
 * order instead of running out half-way.
 *
 * The Phase 2C selection is always evaluated as a baseline, and kept if the
 * search result does not score strictly better — Phase 2D can never be
 * measurably worse than Phase 2C.
 *
 * The unit being packed is still the whole order-group rectangle, never
 * individual artwork, and groups are never rotated (no transform support in
 * the preview/export pipeline for that) — the candidate set already offers
 * landscape/portrait shapes.
 */
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import type { OrderLayoutCandidate } from "./grouped-nesting-types";

export interface OuterPackConfig {
  sheetWidth: number;
  sheetHeight: number;
  orderGapMm: number;
  sheetMarginMm: number;
}

export interface GlobalSearchLimits {
  /** Max states kept per depth. */
  beamWidth: number;
  /** Max candidates considered per order (the Phase 2C selection is always one of them). */
  maxCandidatesPerOrder: number;
  /** Hard cap on outer-pack evaluations across the whole search. */
  maxStatesEvaluated: number;
}

export const DEFAULT_GLOBAL_SEARCH_LIMITS: GlobalSearchLimits = {
  beamWidth: 32,
  maxCandidatesPerOrder: 12,
  maxStatesEvaluated: 3000,
};

/**
 * Lexicographic score for a FIXED-SHEET media (the keychain module packs onto
 * discrete 310 x 470 mm sheets and spills onto new ones): fewer unplaceable
 * groups, then fewer sheets, then less bounding waste (sum of each sheet's
 * used bounding-box area — total item area is the same for every
 * combination, so this IS waste), then a shorter, then a narrower layout.
 */
export interface GlobalLayoutScore {
  unfitGroups: number;
  sheetCount: number;
  boundingArea: number;
  usedHeight: number;
  usedWidth: number;
}

export interface OuterLayoutEvaluation {
  score: GlobalLayoutScore;
}

const EPSILON = 1e-6;

export function compareScores(a: GlobalLayoutScore, b: GlobalLayoutScore): number {
  const keys: (keyof GlobalLayoutScore)[] = ["unfitGroups", "sheetCount", "boundingArea", "usedHeight", "usedWidth"];
  for (const key of keys) {
    const diff = a[key] - b[key];
    if (Math.abs(diff) > EPSILON) return diff;
  }
  return 0;
}

/**
 * Outer-packs `candidates` exactly like `packGroupsOntoSheet` does (same
 * usable area, same gaps, same input order, no rotation) and scores the
 * result. Coordinates are relative to the usable area; the sheet margin is a
 * constant shift and does not change the score's comparisons.
 */
export function evaluateOuterLayout<T>(candidates: OrderLayoutCandidate<T>[], config: OuterPackConfig): OuterLayoutEvaluation {
  const usableWidth = config.sheetWidth - 2 * config.sheetMarginMm;
  const usableHeight = config.sheetHeight - 2 * config.sheetMarginMm;
  const rects: NestableRect<null>[] = candidates.map((c) => ({ width: c.width, height: c.height, data: null }));
  const packed = packMaxRects(rects, usableWidth, usableHeight, config.orderGapMm, config.orderGapMm, false);

  const boundsBySheet = new Map<number, { maxX: number; maxY: number }>();
  for (const p of packed) {
    const bounds = boundsBySheet.get(p.sheetIndex) ?? { maxX: 0, maxY: 0 };
    bounds.maxX = Math.max(bounds.maxX, p.x + p.width);
    bounds.maxY = Math.max(bounds.maxY, p.y + p.height);
    boundsBySheet.set(p.sheetIndex, bounds);
  }

  const sheets = [...boundsBySheet.values()];
  return {
    score: {
      unfitGroups: candidates.length - packed.length,
      sheetCount: sheets.length,
      boundingArea: sheets.reduce((sum, b) => sum + b.maxX * b.maxY, 0),
      usedHeight: Math.max(0, ...sheets.map((b) => b.maxY)),
      usedWidth: Math.max(0, ...sheets.map((b) => b.maxX)),
    },
  };
}

export interface GlobalOrderInput<T> {
  /** Phase 2C's local choice — the baseline. */
  local: OrderLayoutCandidate<T>;
  /** Phase 2C Pareto set (should include `local`). */
  alternatives: OrderLayoutCandidate<T>[];
}

export interface GlobalSearchStats {
  strategy: "beam";
  beamWidth: number;
  /** Beam width actually used after scaling to the evaluation budget. */
  effectiveBeamWidth: number;
  statesEvaluated: number;
  limitReached: boolean;
  baselineScore: GlobalLayoutScore;
  /** Best score the search itself found (may be worse than baseline — then the baseline is used). */
  optimizedScore: GlobalLayoutScore;
  /** True when the search result was not strictly better and the Phase 2C selection was kept. */
  usedBaseline: boolean;
  /** Bounding-area reduction vs. the Phase 2C baseline, percent (0 when the baseline was kept). */
  improvementPercent: number;
}

interface BeamState {
  /** choice[orderIndex] = index into that order's option list; 0 = its Phase 2C local choice. */
  choice: number[];
  score: GlobalLayoutScore;
}

/** Local choice first, then smallest area, then candidateId — bounded by maxCandidatesPerOrder. */
function candidateOptions<T>(order: GlobalOrderInput<T>, limit: number): OrderLayoutCandidate<T>[] {
  const rest = order.alternatives
    .filter((c) => c.candidateId !== order.local.candidateId)
    .sort((a, b) => a.metrics.area - b.metrics.area || a.candidateId.localeCompare(b.candidateId));
  return [order.local, ...rest].slice(0, Math.max(1, limit));
}

/**
 * Every state is a COMPLETE layout (undecided orders keep their local
 * choice), so B with no larger used width/height on the same single sheet
 * and the same unfit count also has no larger bounding area — B already
 * outranks A on every score key, and dropping A only frees a beam slot.
 * Never applied to partial layouts: a bigger partial bounding box can still
 * leave exactly the hole a later order fits into.
 */
function dominates(b: GlobalLayoutScore, a: GlobalLayoutScore): boolean {
  if (b.unfitGroups !== a.unfitGroups || b.sheetCount !== 1 || a.sheetCount !== 1) return false;
  const noWorse = b.usedWidth <= a.usedWidth + EPSILON && b.usedHeight <= a.usedHeight + EPSILON;
  const better = b.usedWidth < a.usedWidth - EPSILON || b.usedHeight < a.usedHeight - EPSILON;
  return noWorse && better;
}

function compareStates(a: BeamState, b: BeamState): number {
  const byScore = compareScores(a.score, b.score);
  if (byScore !== 0) return byScore;
  // Deterministic tie-break: prefer the lexicographically smaller choice vector (index 0 = local choice).
  for (let i = 0; i < a.choice.length; i++) {
    if (a.choice[i] !== b.choice[i]) return a.choice[i] - b.choice[i];
  }
  return 0;
}

/**
 * Picks one candidate per order (returned in the SAME order as `orders`) to
 * minimize the global outer-layout score, never worse than the Phase 2C
 * local selection.
 */
export function selectGlobalCandidates<T>(
  orders: GlobalOrderInput<T>[],
  config: OuterPackConfig,
  limits: GlobalSearchLimits = DEFAULT_GLOBAL_SEARCH_LIMITS
): { selected: OrderLayoutCandidate<T>[]; stats: GlobalSearchStats } {
  const options = orders.map((order) => candidateOptions(order, limits.maxCandidatesPerOrder));
  const baselineSelection = orders.map((order) => order.local);
  const baselineScore = evaluateOuterLayout(baselineSelection, config).score;
  let statesEvaluated = 1;

  // Decide big orders first (they constrain the layout most); ties by orderId then candidateId.
  const decisionOrder = orders
    .map((order, index) => ({ index, area: order.local.metrics.area, orderId: order.local.orderId ?? -1, id: order.local.candidateId }))
    .sort((a, b) => b.area - a.area || a.orderId - b.orderId || a.id.localeCompare(b.id))
    .map((entry) => entry.index);

  // Spread the evaluation budget across every depth instead of exhausting it
  // early (-1: the baseline evaluation).
  const totalOptions = options.reduce((sum, list) => sum + list.length, 0);
  const effectiveBeamWidth = Math.max(
    1,
    Math.min(limits.beamWidth, Math.floor((limits.maxStatesEvaluated - 1) / Math.max(1, totalOptions)))
  );

  const selectionOf = (choice: number[]) => choice.map((optionIndex, orderIndex) => options[orderIndex][optionIndex]);

  // Start from the baseline itself (every order on its local choice). Each
  // depth re-decides one order, keeping option 0 ("stay local") among the
  // expansions, so the best score never gets worse from one depth to the next.
  let beam: BeamState[] = [{ choice: orders.map(() => 0), score: baselineScore }];
  let limitReached = false;

  for (const orderIndex of decisionOrder) {
    const expanded: BeamState[] = [];
    for (const state of beam) {
      expanded.push(state);
      for (let optionIndex = 1; optionIndex < options[orderIndex].length; optionIndex++) {
        if (statesEvaluated >= limits.maxStatesEvaluated) {
          limitReached = true;
          break;
        }
        const choice = state.choice.slice();
        choice[orderIndex] = optionIndex;
        expanded.push({ choice, score: evaluateOuterLayout(selectionOf(choice), config).score });
        statesEvaluated++;
      }
      if (limitReached) break;
    }

    const survivors = expanded.filter((a) => !expanded.some((b) => b !== a && dominates(b.score, a.score)));
    beam = survivors.sort(compareStates).slice(0, effectiveBeamWidth);
    if (limitReached) break;
  }

  // Budget exhausted: every state is already complete, so the best one found so far is used as-is.
  const optimizedSelection = selectionOf(beam[0].choice);
  const optimizedScore = beam[0].score;

  const useOptimized = compareScores(optimizedScore, baselineScore) < 0;
  const improvementPercent =
    useOptimized && baselineScore.boundingArea > 0
      ? ((baselineScore.boundingArea - optimizedScore.boundingArea) / baselineScore.boundingArea) * 100
      : 0;

  return {
    selected: useOptimized ? optimizedSelection : baselineSelection,
    stats: {
      strategy: "beam",
      beamWidth: limits.beamWidth,
      effectiveBeamWidth,
      statesEvaluated,
      limitReached,
      baselineScore,
      optimizedScore,
      usedBaseline: !useOptimized,
      improvementPercent,
    },
  };
}
