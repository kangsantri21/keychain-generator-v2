/**
 * Grouped Nesting V3A-4 FAST (EXPERIMENTAL, OPT-IN) — local region repack
 * with a bounded beam search.
 *
 * The V3A-4A audit showed the remaining real gain needs 3+ receipts to
 * change at once (e.g. a cross-sheet swap plus a small shift): every single
 * or two-step move is worse on its own. This stage works like an operator
 * tidying an inefficient corner of the sheet:
 *
 *   1. build candidate REGIONS (2-3 receipts) from the layout itself —
 *      height-setting receipts, the last sheet, fragment neighbours, frontier
 *      receipts, cross-sheet look-alikes — via an adjacency graph (no
 *      brute force over all subsets);
 *   2. take every receipt of a region off a copy of the layout and rebuild
 *      the free space from scratch (exact-fit-safe replay);
 *   3. put them back one by one with a small beam: each receipt is
 *      re-arranged (slot reflow) for every target free rect, keeping at most
 *      `maxVariantsPerTarget` shapes, under three placement orders;
 *   4. accept the best region of a pass only if the global objective is
 *      strictly better, then start the next pass from scratch.
 *
 * One receipt = one group throughout: items only move with their own
 * receipt, keep their own size, and are never split, mixed or dropped.
 * States are immutable; the input layout is never mutated. If nothing is
 * strictly better the input is returned unchanged (same array).
 */
import { replayFreeRects, type FreeRect } from "./outer-maxrects";
import { reflowOrderIntoSlot, slotCanPossiblyHold, V2_ROTATION_RULE, type RotationRule } from "./slot-reflow";
import {
  minimalFootprint,
  normalizeSheets,
  placeGroup,
  usableRects,
  validateLayout,
  type RegionReflowStage,
} from "./grouped-nesting-v3";
import type { GroupedNestingConfig } from "./grouped-nesting";
import { outerSpacing } from "./grouped-nesting-config";
import type { GroupPlacement, OrderLayoutCandidate } from "./grouped-nesting-types";

export interface RegionLimits {
  maxPasses: number;
  /** Receipts per region (FAST: 3). */
  maxRegionSize: number;
  /** Regions evaluated per pass, best-ranked first. */
  maxRegionsPerPass: number;
  beamWidth: number;
  /** Shapes kept per (receipt, target free rect). */
  maxVariantsPerTarget: number;
  /** Reflow packings per (receipt, target free rect). */
  maxReflowVariants: number;
  /** Hard cap on state evaluations + reflow packings over the whole stage. */
  maxEvaluations: number;
}

export const FAST_REGION_LIMITS: RegionLimits = {
  maxPasses: 3,
  maxRegionSize: 3,
  maxRegionsPerPass: 12,
  beamWidth: 4,
  maxVariantsPerTarget: 6,
  maxReflowVariants: 25,
  maxEvaluations: 60000,
};

/** Lexicographic objective (all in sheet coordinates). */
export interface RegionObjective {
  sheets: number;
  /** Sum of per-sheet used heights. */
  sumHeight: number;
  /** Largest single full-width remainder (sheet height - used height) — the most reusable leftover. */
  maxRemainder: number;
  /** Sum of (sheet width - used width). */
  sideFragments: number;
  /** Sum of per-sheet used bounding areas. */
  boundingArea: number;
}

export type PlacementOrder = "HEIGHT_DESC" | "AREA_DESC" | "MOST_CONSTRAINED_FIRST";
export const PLACEMENT_ORDERS: PlacementOrder[] = ["HEIGHT_DESC", "AREA_DESC", "MOST_CONSTRAINED_FIRST"];

export interface RegionReceiptChange {
  orderId: number | null;
  strategy: string;
  fromSheetIndex: number;
  fromX: number;
  fromY: number;
  fromWidth: number;
  fromHeight: number;
  toSheetIndex: number;
  toX: number;
  toY: number;
  toWidth: number;
  toHeight: number;
  /** Position, size or sheet changed (a region member may also be put back exactly where it was). */
  moved: boolean;
  reshaped: boolean;
  changedSheet: boolean;
}

export interface AcceptedRegion {
  pass: number;
  /** Why the region was built (seed kind). */
  origin: string;
  order: PlacementOrder;
  receipts: RegionReceiptChange[];
  before: RegionObjective;
  after: RegionObjective;
  heightSavedMm: number;
}

export interface RegionDiagnostics {
  baseline: RegionObjective;
  final: RegionObjective;
  sheetsAvoided: number;
  heightSavedMm: number;
  heightSavedPercent: number;
  passes: number;
  candidateRegionsDetected: number;
  regionsEvaluated: number;
  /** Evaluated regions by size, e.g. { "2": 7, "3": 17 }. */
  regionSizes: Record<string, number>;
  beamStatesGenerated: number;
  beamStatesKept: number;
  statesPrunedBound: number;
  statesPrunedDuplicate: number;
  completeStatesInvalid: number;
  packAttempts: number;
  phantomSlotsDetected: number;
  acceptedRegions: number;
  accepted: AcceptedRegion[];
  budgetUsed: number;
  budgetLimit: number;
  budgetExhausted: boolean;
  limits: RegionLimits;
  runtimeMs: number | null;
}

type Config = GroupedNestingConfig;
type Rect = { x: number; y: number; width: number; height: number; sheetIndex: number };

const HEIGHT_GAIN_MM = 0.01;
const REMAINDER_GAIN_MM = 0.01;
const SIDE_GAIN_MM = 0.01;
const AREA_GAIN_MM2 = 1;
const EPS = 1e-6;
/** Free rects narrower/shorter than this (usable mm) are fragments. */
const FRAGMENT_MM = 40;
/** A receipt within this distance of its sheet's bottom/right extent sits on the frontier. */
const FRONTIER_MM = 20;

/** Objective of a set of placed rects (usable coordinates). */
export function regionObjective(rects: Rect[], config: Config): RegionObjective {
  const m = config.sheetMarginMm;
  const mX = outerSpacing(config).marginX;
  const bySheet = new Map<number, { maxX: number; maxY: number }>();
  for (const r of rects) {
    const b = bySheet.get(r.sheetIndex) ?? { maxX: 0, maxY: 0 };
    b.maxX = Math.max(b.maxX, r.x + r.width);
    b.maxY = Math.max(b.maxY, r.y + r.height);
    bySheet.set(r.sheetIndex, b);
  }
  const sheets = [...bySheet.values()];
  return {
    sheets: sheets.length,
    sumHeight: sheets.reduce((sum, b) => sum + b.maxY + m, 0),
    maxRemainder: Math.max(0, ...sheets.map((b) => config.sheetHeight - (b.maxY + m))),
    sideFragments: sheets.reduce((sum, b) => sum + config.sheetWidth - (b.maxX + mX), 0),
    boundingArea: sheets.reduce((sum, b) => sum + b.maxX * b.maxY, 0),
  };
}

/** Ranking order (beam / best region): plain lexicographic, tiny epsilon. */
export function compareObjective(a: RegionObjective, b: RegionObjective): number {
  if (a.sheets !== b.sheets) return a.sheets - b.sheets;
  for (const [x, y, sign] of [
    [a.sumHeight, b.sumHeight, 1],
    [a.maxRemainder, b.maxRemainder, -1],
    [a.sideFragments, b.sideFragments, 1],
    [a.boundingArea, b.boundingArea, 1],
  ] as const) {
    if (Math.abs(x - y) > EPS) return sign * (x - y);
  }
  return 0;
}

/**
 * Acceptance: strictly better on the first key that differs meaningfully.
 * A lower key never compensates a higher one: more sheets or more used
 * height is never accepted, whatever the bounding area does.
 */
export function isRegionImprovement(candidate: RegionObjective, current: RegionObjective): boolean {
  if (candidate.sheets !== current.sheets) return candidate.sheets < current.sheets;
  if (candidate.sumHeight < current.sumHeight - HEIGHT_GAIN_MM) return true;
  if (candidate.sumHeight > current.sumHeight + EPS) return false;
  if (Math.abs(candidate.maxRemainder - current.maxRemainder) > REMAINDER_GAIN_MM) return candidate.maxRemainder > current.maxRemainder;
  if (Math.abs(candidate.sideFragments - current.sideFragments) > SIDE_GAIN_MM) return candidate.sideFragments < current.sideFragments;
  return candidate.boundingArea < current.boundingArea - AREA_GAIN_MM2;
}

interface Region {
  members: number[];
  origin: string;
  priority: number;
}

interface Placed<T> {
  gi: number;
  rect: Rect;
  candidate: OrderLayoutCandidate<T>;
}

interface BeamState<T> {
  rects: Rect[];
  placed: Placed<T>[];
  objective: RegionObjective;
  signature: string;
}

/**
 * V3A-4 FAST search on an already-valid layout. Pure and deterministic.
 */
export function improveWithRegionRepack<T>(
  baseline: GroupPlacement<T>[],
  config: Config,
  limits: RegionLimits = FAST_REGION_LIMITS,
  rule: RotationRule = V2_ROTATION_RULE
): { groups: GroupPlacement<T>[]; diagnostics: Omit<RegionDiagnostics, "runtimeMs"> } {
  const { marginX, marginY, gapX, gapY } = outerSpacing(config);
  const margin = { x: marginX, y: marginY };
  const packW = config.sheetWidth - 2 * marginX;
  const packH = config.sheetHeight - 2 * marginY;

  const d = {
    passes: 0,
    candidateRegionsDetected: 0,
    regionsEvaluated: 0,
    regionSizes: {} as Record<string, number>,
    beamStatesGenerated: 0,
    beamStatesKept: 0,
    statesPrunedBound: 0,
    statesPrunedDuplicate: 0,
    completeStatesInvalid: 0,
    packAttempts: 0,
    phantomSlotsDetected: 0,
    acceptedRegions: 0,
    accepted: [] as AcceptedRegion[],
    budgetUsed: 0,
    budgetLimit: limits.maxEvaluations,
    budgetExhausted: false,
    limits,
  };
  const spend = (n: number) => {
    d.budgetUsed += n;
    if (d.budgetUsed >= limits.maxEvaluations) d.budgetExhausted = true;
  };

  const orderKeyOf = (g: GroupPlacement<T>) => (g.orderId !== null ? `order-${g.orderId}` : `item-${String(g.candidate.placements[0]?.item.id)}`);
  const freeOf = (rects: Rect[], sheetIndex: number) =>
    replayFreeRects(
      rects.filter((r) => r.sheetIndex === sheetIndex),
      packW,
      packH,
      { x: gapX, y: gapY }
    );
  const touchesNode = (f: FreeRect, r: Rect) =>
    f.x < r.x + r.width + gapX && f.x + f.width > r.x && f.y < r.y + r.height + gapY && f.y + f.height > r.y;

  let current = baseline;
  /** Shapes per (receipt, target size), reset every pass (receipt indices refer to that pass's layout). */
  let shapeCache = new Map<string, OrderLayoutCandidate<T>[]>();

  for (let pass = 0; pass < limits.maxPasses && !d.budgetExhausted; pass++) {
    d.passes++;
    shapeCache = new Map();
    const groups = current;
    const rects = usableRects(groups, config);
    const s0 = regionObjective(rects, config);
    const sheets = [...new Set(rects.map((r) => r.sheetIndex))].sort((a, b) => a - b);
    const lastSheet = sheets[sheets.length - 1];
    const sheetBottom = new Map(sheets.map((s) => [s, Math.max(...rects.filter((r) => r.sheetIndex === s).map((r) => r.y + r.height))]));
    const sheetRight = new Map(sheets.map((s) => [s, Math.max(...rects.filter((r) => r.sheetIndex === s).map((r) => r.x + r.width))]));
    const freeBySheet = new Map(sheets.map((s) => [s, freeOf(rects, s)]));

    // ---- seeds ----
    const critical = rects.map((r) => r.y + r.height >= sheetBottom.get(r.sheetIndex)! - HEIGHT_GAIN_MM);
    const adjacent = (a: Rect, b: Rect) => {
      if (a.sheetIndex !== b.sheetIndex) return false;
      const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
      const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
      return (dx <= gapX + 1 && dy < 0) || (dy <= gapY + 1 && dx < 0);
    };
    const neighbours = rects.map((a, i) => rects.map((b, j) => (i !== j && adjacent(a, b) ? j : -1)).filter((j) => j >= 0));
    const seedScore = rects.map((r, i) => {
      const fragments = freeBySheet
        .get(r.sheetIndex)!
        .filter((f) => Math.min(f.width - gapX, f.height - gapY) < FRAGMENT_MM)
        .filter((f) => {
          const nr = r.x + r.width + gapX;
          const nb = r.y + r.height + gapY;
          const overlapY = f.y < nb && f.y + f.height > r.y;
          const overlapX = f.x < nr && f.x + f.width > r.x;
          return (overlapY && (Math.abs(f.x - nr) < EPS || Math.abs(f.x + f.width - r.x) < EPS)) || (overlapX && (Math.abs(f.y - nb) < EPS || Math.abs(f.y + f.height - r.y) < EPS));
        }).length;
      const frontier = r.y + r.height >= sheetBottom.get(r.sheetIndex)! - FRONTIER_MM || r.x + r.width >= sheetRight.get(r.sheetIndex)! - FRONTIER_MM;
      const lowUtil = groups[i].candidate.metrics.utilizationPercent < 80;
      return 8 * Number(critical[i]) + 4 * Number(r.sheetIndex === lastSheet) + 2 * Math.min(2, fragments) + 2 * Number(frontier) + Number(lowUtil && frontier);
    });

    // ---- regions (connected neighbourhoods + cross-sheet look-alikes), no brute force ----
    const regions = new Map<string, Region>();
    const contributionOf = (members: number[]) => s0.sumHeight - regionObjective(rects.filter((_, i) => !members.includes(i)), config).sumHeight;
    const add = (members: number[], origin: string) => {
      const sorted = [...new Set(members)].sort((a, b) => a - b);
      if (sorted.length < 2 || sorted.length > limits.maxRegionSize) return;
      const key = sorted.join(",");
      if (regions.has(key)) return;
      const score = sorted.reduce((sum, i) => sum + seedScore[i], 0);
      regions.set(key, { members: sorted, origin, priority: contributionOf(sorted) + 5 * score });
    };
    const seeds = rects
      .map((_, i) => i)
      .filter((i) => seedScore[i] > 0)
      .sort((a, b) => seedScore[b] - seedScore[a] || a - b);
    for (const s of seeds) {
      for (const n of neighbours[s]) {
        add([s, n], "neighbourhood");
        if (limits.maxRegionSize >= 3) for (const m of [...neighbours[s], ...neighbours[n]]) if (m !== s && m !== n) add([s, n, m], "neighbourhood");
      }
    }
    // Cross-sheet look-alikes: a height-setting receipt and a receipt of similar footprint on another sheet (swap candidates).
    const similar = (a: Rect, b: Rect) => {
      const areaRatio = Math.min(a.width * a.height, b.width * b.height) / Math.max(a.width * a.height, b.width * b.height);
      const dims = (w1: number, h1: number, w2: number, h2: number) => Math.abs(w1 - w2) <= 0.4 * Math.max(w1, w2) && Math.abs(h1 - h2) <= 0.4 * Math.max(h1, h2);
      return areaRatio >= 0.65 && (dims(a.width, a.height, b.width, b.height) || dims(a.width, a.height, b.height, b.width));
    };
    for (const c of rects.map((_, i) => i).filter((i) => critical[i])) {
      for (let p = 0; p < rects.length; p++) {
        if (rects[p].sheetIndex === rects[c].sheetIndex || !similar(rects[c], rects[p])) continue;
        add([c, p], "cross-sheet swap");
        if (limits.maxRegionSize >= 3) for (const n of [...neighbours[p], ...neighbours[c]]) if (n !== c && n !== p) add([c, p, n], "cross-sheet swap");
      }
    }
    d.candidateRegionsDetected += regions.size;
    const ranked = [...regions.values()]
      .sort((a, b) => b.priority - a.priority || a.members.join(",").localeCompare(b.members.join(",")))
      .slice(0, limits.maxRegionsPerPass);

    // ---- evaluate each region with a bounded beam ----
    let best: { objective: RegionObjective; state: BeamState<T>; region: Region; order: PlacementOrder } | null = null;

    for (const region of ranked) {
      if (d.budgetExhausted) break;
      const fixed = rects.filter((_, i) => !region.members.includes(i));
      // Rebuild check: no free rect of the rebuilt state may sit on an occupied node.
      let phantoms = 0;
      for (const s of sheets) for (const f of freeOf(fixed, s)) phantoms += fixed.filter((r) => r.sheetIndex === s && touchesNode(f, r)).length;
      d.phantomSlotsDetected += phantoms;
      if (phantoms > 0) continue;
      d.regionsEvaluated++;
      d.regionSizes[String(region.members.length)] = (d.regionSizes[String(region.members.length)] ?? 0) + 1;

      const minimal = new Map(region.members.map((gi) => [gi, minimalFootprint(groups[gi], rule)]));
      const orders: Record<PlacementOrder, number[]> = {
        HEIGHT_DESC: region.members.slice().sort((a, b) => groups[b].height - groups[a].height || a - b),
        AREA_DESC: region.members.slice().sort((a, b) => groups[b].width * groups[b].height - groups[a].width * groups[a].height || a - b),
        MOST_CONSTRAINED_FIRST: region.members.slice().sort((a, b) => {
          const ma = minimal.get(a)!;
          const mb = minimal.get(b)!;
          return Math.max(mb.width, mb.height) - Math.max(ma.width, ma.height) || groups[a].alternatives.length - groups[b].alternatives.length || a - b;
        }),
      };

      for (const order of PLACEMENT_ORDERS) {
        if (d.budgetExhausted) break;
        let beam: BeamState<T>[] = [{ rects: fixed, placed: [], objective: regionObjective(fixed, config), signature: "" }];
        for (const gi of orders[order]) {
          const g = groups[gi];
          const items = g.candidate.placements.map((p) => p.item);
          const expanded: BeamState<T>[] = [];
          for (const state of beam) {
            for (const sheet of sheets) {
              for (const f of freeOf(state.rects, sheet)) {
                if (d.budgetExhausted) break;
                const W = f.width - gapX;
                const H = f.height - gapY;
                if (!slotCanPossiblyHold(items, W, H, config.partGapMm, rule)) continue;
                for (const candidate of shapesFor(g, gi, W, H)) {
                  spend(1);
                  d.beamStatesGenerated++;
                  const rect = { x: f.x, y: f.y, width: candidate.width, height: candidate.height, sheetIndex: sheet };
                  const nextRects = [...state.rects, rect];
                  const objective = regionObjective(nextRects, config);
                  // Lower bound: used height and sheet count never drop as receipts are added back.
                  if (objective.sheets > s0.sheets || objective.sumHeight > s0.sumHeight + EPS) {
                    d.statesPrunedBound++;
                    continue;
                  }
                  const placed = [...state.placed, { gi, rect, candidate }];
                  const signature = placed
                    .map((p) => `${p.rect.sheetIndex}:${orderKeyOf(groups[p.gi])}:${p.rect.x.toFixed(3)},${p.rect.y.toFixed(3)},${p.rect.width.toFixed(3)},${p.rect.height.toFixed(3)}:${p.candidate.candidateId}`)
                    .sort()
                    .join("|");
                  expanded.push({ rects: nextRects, placed, objective, signature });
                }
              }
            }
          }
          expanded.sort((a, b) => compareObjective(a.objective, b.objective) || a.signature.localeCompare(b.signature));
          const seen = new Set<string>();
          beam = [];
          for (const state of expanded) {
            if (seen.has(state.signature)) {
              d.statesPrunedDuplicate++;
              continue;
            }
            seen.add(state.signature);
            if (beam.length < limits.beamWidth) beam.push(state);
          }
          d.beamStatesKept += beam.length;
          if (beam.length === 0) break;
        }

        for (const state of beam) {
          if (state.placed.length !== region.members.length) continue;
          if (!isRegionImprovement(state.objective, s0)) continue;
          if (best && compareObjective(state.objective, best.objective) >= 0) continue;
          if (validateLayout(buildGroups(groups, state.placed, margin), config).length > 0) {
            d.completeStatesInvalid++;
            continue;
          }
          best = { objective: state.objective, state, region, order };
        }
      }
    }

    if (!best) break;
    const next = buildGroups(groups, best.state.placed, margin);
    d.accepted.push({
      pass,
      origin: best.region.origin,
      order: best.order,
      receipts: best.state.placed
        .slice()
        .sort((a, b) => a.gi - b.gi)
        .map((p) => {
          const g = groups[p.gi];
          const to = next[p.gi];
          return {
            orderId: g.orderId,
            strategy: p.candidate.strategy,
            fromSheetIndex: g.sheetIndex,
            fromX: g.x,
            fromY: g.y,
            fromWidth: g.width,
            fromHeight: g.height,
            toSheetIndex: to.sheetIndex,
            toX: to.x,
            toY: to.y,
            toWidth: to.width,
            toHeight: to.height,
            moved:
              to.sheetIndex !== g.sheetIndex ||
              Math.abs(to.x - g.x) > 0.01 ||
              Math.abs(to.y - g.y) > 0.01 ||
              Math.abs(to.width - g.width) > 0.01 ||
              Math.abs(to.height - g.height) > 0.01,
            reshaped: Math.abs(to.width - g.width) > 0.01 || Math.abs(to.height - g.height) > 0.01,
            changedSheet: to.sheetIndex !== g.sheetIndex,
          };
        }),
      before: s0,
      after: best.objective,
      heightSavedMm: s0.sumHeight - best.objective.sumHeight,
    });
    d.acceptedRegions++;
    current = next;
  }

  const start = regionObjective(usableRects(baseline, config), config);
  const end = regionObjective(usableRects(current, config), config);
  return {
    groups: current,
    diagnostics: {
      ...d,
      baseline: start,
      final: end,
      sheetsAvoided: start.sheets - end.sheets,
      heightSavedMm: start.sumHeight - end.sumHeight,
      heightSavedPercent: start.sumHeight > 0 ? ((start.sumHeight - end.sumHeight) / start.sumHeight) * 100 : 0,
    },
  };

  /** Up to maxVariantsPerTarget shapes for receipt `gi` in a W x H target (cached per pass). */
  function shapesFor(g: GroupPlacement<T>, gi: number, W: number, H: number): OrderLayoutCandidate<T>[] {
    const key = `${gi}|${orderKeyOf(g)}|${W.toFixed(3)}|${H.toFixed(3)}`;
    const cached = shapeCache.get(key);
    if (cached) return cached;
    const fits = (c: OrderLayoutCandidate<T>) => c.width <= W + EPS && c.height <= H + EPS;
    const normal = [g.candidate, ...g.alternatives].filter(fits);
    const reflow = reflowOrderIntoSlot(
      g.candidate.placements.map((p) => p.item),
      W,
      H,
      config.partGapMm,
      { orderId: g.orderId, maxVariants: Math.min(limits.maxReflowVariants, Math.max(0, limits.maxEvaluations - d.budgetUsed)), rule }
    );
    d.packAttempts += reflow.attempts;
    spend(reflow.attempts);
    const seen = new Set<string>();
    const all = [...normal, ...reflow.candidates].filter((c) => {
      const k = `${c.width.toFixed(2)}x${c.height.toFixed(2)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Current shape if it fits, then the lowest, then the narrowest and the widest (strip) shapes.
    const picked: OrderLayoutCandidate<T>[] = [];
    const pick = (c: OrderLayoutCandidate<T> | undefined) => {
      if (c && !picked.includes(c) && picked.length < limits.maxVariantsPerTarget) picked.push(c);
    };
    pick(all.find((c) => c === g.candidate));
    for (const c of all.slice().sort((a, b) => a.height - b.height || a.width - b.width).slice(0, 3)) pick(c);
    pick(all.slice().sort((a, b) => a.width - b.width || a.height - b.height)[0]);
    pick(all.slice().sort((a, b) => b.width - a.width || a.height - b.height)[0]);
    for (const c of all.slice().sort((a, b) => a.width * a.height - b.width * b.height)) pick(c);
    shapeCache.set(key, picked);
    return picked;
  }
}

/** Applies `placed` (usable coordinates) to `groups`, keeping every other receipt as is, then normalizes sheets. */
function buildGroups<T>(groups: GroupPlacement<T>[], placed: Placed<T>[], margin: { x: number; y: number }): GroupPlacement<T>[] {
  const byIndex = new Map(placed.map((p) => [p.gi, p]));
  return normalizeSheets(
    groups.map((g, i) => {
      const p = byIndex.get(i);
      return p
        ? placeGroup(p.candidate, p.rect.x + margin.x, p.rect.y + margin.y, p.rect.sheetIndex, { alternatives: g.alternatives, localCandidate: g.localCandidate })
        : g;
    })
  ).groups;
}

/** The opt-in V3A-4 FAST stage for applySlotReflow / runGroupedNestingV3. */
export function regionStage<T>(
  config: Config,
  limits: RegionLimits = FAST_REGION_LIMITS,
  options: { clock?: () => number; rule?: RotationRule } = {}
): RegionReflowStage<T> {
  return {
    run(groups) {
      const startedAt = options.clock?.();
      const { groups: out, diagnostics } = improveWithRegionRepack(groups, config, limits, options.rule ?? V2_ROTATION_RULE);
      const runtimeMs = startedAt !== undefined && options.clock ? options.clock() - startedAt : null;
      return { groups: out, diagnostics: { ...diagnostics, runtimeMs } };
    },
  };
}

/** Request flag for the dry-run API: `slotReflowRegion: true` (only together with `slotReflow: true`). */
export function isRegionRequest(body: unknown): boolean {
  const b = body as { slotReflow?: unknown; slotReflowRegion?: unknown } | null;
  return b?.slotReflow === true && b?.slotReflowRegion === true;
}
