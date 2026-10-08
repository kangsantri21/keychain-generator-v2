/**
 * Grouped Nesting V2 — Phase 2F spacing benchmark (DEV-only).
 *
 * Re-runs the exact same engine and objective (`runGroupedNesting`) on the
 * same items once per ORDER_GAP scenario, changing ONLY `orderGapMm` through
 * the engine's existing per-call config override. Nothing here changes a
 * default, persists anything or does I/O: the override lives only in the
 * arguments of that one call. The scenario gaps are a fixed server-side
 * list — a request can switch the benchmark on, never choose its own gap.
 *
 * Note for interpreting results: the outer pack reserves `orderGapMm` both
 * BETWEEN groups and as a border at the sheet edge (on top of
 * SHEET_MARGIN_MM), so a smaller gap also brings groups closer to the media
 * edge — `edgeClearanceMm` reports that per scenario.
 */
import { runGroupedNesting, type GroupedNestingResult } from "./grouped-nesting";
import { ORDER_GAP_MM, PART_GAP_MM, SHEET_HEIGHT_MM, SHEET_MARGIN_MM, SHEET_WIDTH_MM } from "./grouped-nesting-config";
import type { GroupedNestingItem } from "./grouped-nesting-types";

/** Scenario order matters: the first one is the production default every other scenario is compared against. */
export const BENCHMARK_ORDER_GAPS_MM = [ORDER_GAP_MM, 6, 4] as const;

/** True only for an explicit grouped-v2 benchmark request — every other request runs exactly as before. */
export function isSpacingBenchmarkRequest(body: unknown): boolean {
  const parsed = body as { mode?: unknown; benchmark?: unknown } | null;
  return parsed?.mode === "grouped-v2" && parsed?.benchmark === true;
}

export interface IntegrityReport {
  ok: boolean;
  violations: string[];
}

const EPS = 1e-6;

/**
 * Re-checks the business rules on a finished layout instead of trusting the
 * engine: one group per order, no cross-order item, items inside their own
 * group without overlapping, groups at least `orderGapMm` apart on the same
 * sheet, and everything inside the sheet margin.
 */
export function checkLayoutIntegrity<T>(
  result: GroupedNestingResult<T>,
  orderGapMm: number,
  sheet = { width: SHEET_WIDTH_MM, height: SHEET_HEIGHT_MM, margin: SHEET_MARGIN_MM }
): IntegrityReport {
  const violations: string[] = [];
  const groups = result.groups;

  const orderIds = groups.map((g) => g.orderId).filter((id) => id !== null);
  if (new Set(orderIds).size !== orderIds.length) violations.push("lebih dari satu group untuk satu order");

  for (const group of groups) {
    const label = `order ${group.orderId ?? "(tanpa orderId)"}`;
    if (group.x < sheet.margin - EPS || group.y < sheet.margin - EPS) violations.push(`${label}: melewati margin kiri/atas`);
    if (group.x + group.width > sheet.width - sheet.margin + EPS || group.y + group.height > sheet.height - sheet.margin + EPS) {
      violations.push(`${label}: melewati margin kanan/bawah`);
    }
    group.items.forEach((item, i) => {
      if (item.orderId !== group.orderId) violations.push(`${label}: item order ${item.orderId} tercampur`);
      const inside =
        item.x >= group.x - EPS &&
        item.y >= group.y - EPS &&
        item.x + item.width <= group.x + group.width + EPS &&
        item.y + item.height <= group.y + group.height + EPS;
      if (!inside) violations.push(`${label}: item keluar dari boundary group`);
      for (const other of group.items.slice(i + 1)) {
        if (item.x < other.x + other.width - EPS && item.x + item.width > other.x + EPS && item.y < other.y + other.height - EPS && item.y + item.height > other.y + EPS) {
          violations.push(`${label}: item overlap`);
        }
      }
    });
  }

  // Groups must be separated by at least the gap: grow one by the gap and test overlap.
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (a.sheetIndex !== b.sheetIndex) continue;
      const tooClose =
        a.x < b.x + b.width + orderGapMm - EPS &&
        a.x + a.width + orderGapMm > b.x + EPS &&
        a.y < b.y + b.height + orderGapMm - EPS &&
        a.y + a.height + orderGapMm > b.y + EPS;
      if (tooClose) violations.push(`order ${a.orderId} dan ${b.orderId}: jarak antar group < ${orderGapMm} mm`);
    }
  }

  return { ok: violations.length === 0, violations };
}

export interface SpacingScenario<T> {
  orderGapMm: number;
  partGapMm: number;
  sheetMarginMm: number;
  /** Effective distance from the media edge to the nearest group: sheet margin + order gap (see top doc comment). */
  edgeClearanceMm: number;
  result: GroupedNestingResult<T>;
  usedWidth: number;
  usedHeight: number;
  /** SHEET_HEIGHT_MM - usedHeight. */
  remainingFullWidthHeight: number;
  /** SHEET_WIDTH_MM - usedWidth. */
  sideFragmentWidth: number;
  sheetCount: number;
  heightSavedVsDefaultMm: number;
  heightSavedVsDefaultPercent: number;
  integrity: IntegrityReport;
  /** Only when a clock was passed in — dev diagnostic, never part of a decision. */
  elapsedMs?: number;
}

export interface SpacingRecommendation {
  /** Always the configured production default — the benchmark never changes it. */
  productionDefaultOrderGapMm: number;
  recommendedOrderGapMm: number;
  reasons: string[];
}

export interface SpacingBenchmark<T> {
  scenarios: SpacingScenario<T>[];
  recommendation: SpacingRecommendation;
}

/**
 * Runs every BENCHMARK_ORDER_GAPS_MM scenario sequentially (bounded: one
 * full optimization each, same pack budgets as a normal request).
 */
export function runSpacingBenchmark<T>(
  items: GroupedNestingItem<T>[],
  gaps: readonly number[] = BENCHMARK_ORDER_GAPS_MM,
  clock?: () => number
): SpacingBenchmark<T> {
  const base = gaps.map((orderGapMm) => {
    const startedAt = clock?.();
    const result = runGroupedNesting(items, { orderGapMm });
    const elapsedMs = clock && startedAt !== undefined ? clock() - startedAt : undefined;
    return {
      elapsedMs,
      orderGapMm,
      partGapMm: PART_GAP_MM,
      sheetMarginMm: SHEET_MARGIN_MM,
      edgeClearanceMm: SHEET_MARGIN_MM + orderGapMm,
      result,
      usedWidth: result.metrics.usedWidth,
      usedHeight: result.metrics.usedHeight,
      remainingFullWidthHeight: SHEET_HEIGHT_MM - result.metrics.usedHeight,
      sideFragmentWidth: SHEET_WIDTH_MM - result.metrics.usedWidth,
      sheetCount: result.optimizer.finalScore.sheetCount,
      integrity: checkLayoutIntegrity(result, orderGapMm),
    };
  });

  const reference = base[0];
  const scenarios: SpacingScenario<T>[] = base.map((s) => {
    const saved = reference.usedHeight - s.usedHeight;
    return {
      ...s,
      heightSavedVsDefaultMm: saved,
      heightSavedVsDefaultPercent: reference.usedHeight > 0 ? (saved / reference.usedHeight) * 100 : 0,
    };
  });

  return { scenarios, recommendation: recommendSpacing(scenarios) };
}

/**
 * Recommendation for OPERATOR TESTING only. Eligible = integrity ok, no
 * unfit items, no extra sheet vs. the default. Among eligible scenarios pick
 * the lowest used height; on equal height prefer the LARGER gap (same
 * material, more separation). If nothing beats the default, keep the default.
 */
export function recommendSpacing<T>(scenarios: SpacingScenario<T>[]): SpacingRecommendation {
  const reference = scenarios[0];
  const eligible = scenarios.filter(
    (s) => s.integrity.ok && s.result.unfit.length === 0 && s.sheetCount <= reference.sheetCount
  );

  let best = reference;
  for (const s of eligible) {
    const lower = s.usedHeight < best.usedHeight - EPS;
    const sameHeightLargerGap = Math.abs(s.usedHeight - best.usedHeight) <= EPS && s.orderGapMm > best.orderGapMm;
    if (lower || sameHeightLargerGap) best = s;
  }

  const reasons =
    best === reference
      ? ["gap lebih kecil tidak menurunkan used height secara valid — default tetap yang terbaik"]
      : [
          `hemat ${best.heightSavedVsDefaultMm.toFixed(1)} mm tinggi material (${best.heightSavedVsDefaultPercent.toFixed(1)}%) vs ${reference.orderGapMm} mm`,
          `jarak antar group tetap >= ${best.orderGapMm} mm, tanpa overlap (dicek ulang)`,
          `jarak ke tepi media turun ke ${best.edgeClearanceMm} mm — perlu dicek operator`,
        ];

  return { productionDefaultOrderGapMm: ORDER_GAP_MM, recommendedOrderGapMm: best.orderGapMm, reasons };
}
