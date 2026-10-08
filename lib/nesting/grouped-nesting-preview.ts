/**
 * PHASE 2B — pure, framework-free conversion from the `POST /api/staging/
 * nest` grouped-v2 JSON response into the shape a preview canvas actually
 * renders. Kept separate from any React component specifically so it's
 * unit-testable without a DOM/component-testing framework (this project has
 * neither) — see grouped-nesting.test.ts's sibling test file for the tests
 * this conversion is checked against (item count preserved, exactly one
 * label per group, etc).
 *
 * Field names deliberately match `StagingItemPayload`'s own convention
 * (`posX`/`posY` instead of `x`/`y`) so the SAME `getItemTransform`/
 * `getContentSize` helpers (lib/staging-transform.ts) the legacy Staging
 * Area canvas already uses can be reused as-is for the V2 preview canvas —
 * per the PHASE 2B instructions, "transform item tidak berubah".
 */
import type { KeychainRenderPayload } from "@/lib/staging-types";
import type { OuterOptimizerStats } from "./grouped-nesting-outer";

export interface GroupedV2PreviewItem {
  /** Per-request item id (PHASE 2F) — joins a benchmark scenario's positions to this item's render. */
  itemId: number | null;
  orderId: number | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
  templateId: number;
  customerName: string;
  render: KeychainRenderPayload | null;
  groupX: number;
  groupY: number;
  groupWidth: number;
  groupHeight: number;
}

export interface GroupedV2PreviewGroup {
  orderId: number | null;
  /** The ONE label this group's boundary shows — receiptCode if known, else `Order #<id>` as an explicit fallback (never both, never per-item). */
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  itemCount: number;
  /** PHASE 2C dev diagnostics (see `GroupedV2ApiResponse.groups`). */
  candidateCount: number;
  selectedStrategy: string;
  /** Phase 2C's local pick — differs from `selectedStrategy` when Phase 2D chose another shape globally. */
  localStrategy: string;
  itemArea: number;
  internalUtilizationPercent: number;
}

export interface GroupedV2PreviewMetrics {
  totalItems: number;
  totalOrders: number;
  usedWidth: number;
  usedHeight: number;
  usedArea: number;
  totalItemArea: number;
  packingUtilizationPercent: number;
  wastePercent: number;
}

/** What the preview canvas needs per group — the main sheet's groups and a benchmark scenario's groups both fit. */
export type GroupedV2CanvasGroup = Pick<GroupedV2PreviewGroup, "label" | "x" | "y" | "width" | "height">;

/** PHASE 2F — one DEV spacing-benchmark scenario, as returned by the API (see app/api/staging/nest/route.ts). */
export interface GroupedV2BenchmarkScenario {
  orderGapMm: number;
  partGapMm: number;
  sheetMarginMm: number;
  edgeClearanceMm: number;
  totalOrders: number;
  totalItems: number;
  unfitCount: number;
  sheetCount: number;
  usedWidth: number;
  usedHeight: number;
  remainingFullWidthHeight: number;
  sideFragmentWidth: number;
  packingUtilizationPercent: number;
  wastePercent: number;
  selectedHeuristic: string;
  selectedSort: string;
  candidateStatesEvaluated: number;
  outerPackAttempts: number;
  heightSavedVsDefaultMm: number;
  heightSavedVsDefaultPercent: number;
  integrity: { ok: boolean; violations: string[] };
  warnings: string[];
  elapsedMs: number | null;
  groups: { orderId: number | null; receiptCode: string | null; x: number; y: number; width: number; height: number; itemCount: number }[];
  items: {
    itemId: number | null;
    orderId: number | null;
    x: number;
    y: number;
    width: number;
    height: number;
    rotated: boolean;
    groupX: number;
    groupY: number;
    groupWidth: number;
    groupHeight: number;
  }[];
}

export interface GroupedV2Benchmark {
  /** Always the configured production default; the benchmark never changes it. */
  productionDefaultOrderGapMm: number;
  recommendation: { productionDefaultOrderGapMm: number; recommendedOrderGapMm: number; reasons: string[] };
  totalElapsedMs: number;
  scenarios: GroupedV2BenchmarkScenario[];
}

export interface GroupedV2PreviewSheet {
  items: GroupedV2PreviewItem[];
  groups: GroupedV2PreviewGroup[];
  metrics: GroupedV2PreviewMetrics;
  optimizer: OuterOptimizerStats & { elapsedMs?: number };
  warnings: string[];
  unfitCount: number;
  /** PHASE 2F DEV spacing benchmark — null unless the request asked for it. */
  benchmark: GroupedV2Benchmark | null;
}

/** The exact shape `POST /api/staging/nest` returns when `mode: "grouped-v2"` (see app/api/staging/nest/route.ts). */
export interface GroupedV2ApiResponse {
  mode: "grouped-v2";
  dryRun: true;
  groups: {
    orderId: number | null;
    receiptCode: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    itemCount: number;
    /** Pareto-surviving inner layouts generated for this order (PHASE 2C). */
    candidateCount: number;
    selectedStrategy: string;
    /** Phase 2C local pick (PHASE 2D). */
    localStrategy: string;
    /** Sum of item rectangle areas, mm². */
    itemArea: number;
    /** itemArea / (width * height) * 100. */
    internalUtilizationPercent: number;
  }[];
  items: {
    /** PHASE 2F; optional so older payloads still parse. */
    itemId?: number | null;
    orderId: number | null;
    x: number;
    y: number;
    width: number;
    height: number;
    rotated: boolean;
    groupX: number;
    groupY: number;
    groupWidth: number;
    groupHeight: number;
    customerName: string;
    templateId: number;
    render: KeychainRenderPayload | null;
  }[];
  metrics: GroupedV2PreviewMetrics;
  /** PHASE 2D/2E optimizer diagnostics (`elapsedMs` added by the API route, not part of the deterministic result). */
  optimizer: OuterOptimizerStats & { elapsedMs?: number };
  warnings: string[];
  unfitCount: number;
  benchmark?: GroupedV2Benchmark | null;
}

/**
 * PHASE 2F — app vs. manual (CorelDRAW) used height, for the DEV benchmark's
 * optional manual field. Positive = the app uses more material height.
 * `null` when the manual value is missing/invalid (the benchmark then just
 * omits the comparison). Lives here, not in grouped-nesting-benchmark.ts,
 * so the client page can use it without bundling the nesting engine.
 */
export function compareWithManualHeight(
  appHeightMm: number,
  manualHeightMm: number
): { differenceMm: number; differencePercent: number } | null {
  if (!Number.isFinite(appHeightMm) || !Number.isFinite(manualHeightMm) || manualHeightMm <= 0) return null;
  const differenceMm = appHeightMm - manualHeightMm;
  return { differenceMm, differencePercent: (differenceMm / manualHeightMm) * 100 };
}

/** `receiptCode` when known, else the explicit `Order #<id>` fallback — see the PHASE 2B instructions' own priority order for this. */
function resolveGroupLabel(orderId: number | null, receiptCode: string | null): string {
  if (receiptCode) return receiptCode;
  if (orderId !== null) return `Order #${orderId}`;
  return "(tanpa order)";
}

export function buildGroupedV2PreviewSheet(response: GroupedV2ApiResponse): GroupedV2PreviewSheet {
  const items: GroupedV2PreviewItem[] = response.items.map((item) => ({
    itemId: item.itemId ?? null,
    orderId: item.orderId,
    posX: item.x,
    posY: item.y,
    width: item.width,
    height: item.height,
    rotated: item.rotated,
    templateId: item.templateId,
    customerName: item.customerName,
    render: item.render,
    groupX: item.groupX,
    groupY: item.groupY,
    groupWidth: item.groupWidth,
    groupHeight: item.groupHeight,
  }));

  const groups: GroupedV2PreviewGroup[] = response.groups.map((group) => ({
    orderId: group.orderId,
    label: resolveGroupLabel(group.orderId, group.receiptCode),
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
    itemCount: group.itemCount,
    candidateCount: group.candidateCount,
    selectedStrategy: group.selectedStrategy,
    localStrategy: group.localStrategy,
    itemArea: group.itemArea,
    internalUtilizationPercent: group.internalUtilizationPercent,
  }));

  return {
    items,
    groups,
    metrics: response.metrics,
    optimizer: response.optimizer,
    warnings: response.warnings,
    unfitCount: response.unfitCount,
    benchmark: response.benchmark ?? null,
  };
}

/**
 * PHASE 2F — canvas data for one benchmark scenario: that scenario's own
 * positions and group boxes, with each item's artwork/name taken from the
 * main sheet by `itemId` (scenarios ship positions only). An item whose id
 * can't be matched is still drawn (as an empty placeholder box), never
 * dropped silently.
 */
export function buildScenarioCanvas(
  sheet: GroupedV2PreviewSheet,
  scenario: GroupedV2BenchmarkScenario
): { items: GroupedV2PreviewItem[]; groups: GroupedV2CanvasGroup[] } {
  const mainById = new Map(sheet.items.filter((item) => item.itemId !== null).map((item) => [item.itemId, item]));
  const items: GroupedV2PreviewItem[] = scenario.items.map((item) => {
    const main = item.itemId !== null ? mainById.get(item.itemId) : undefined;
    return {
      itemId: item.itemId,
      orderId: item.orderId,
      posX: item.x,
      posY: item.y,
      width: item.width,
      height: item.height,
      rotated: item.rotated,
      templateId: main?.templateId ?? -1,
      customerName: main?.customerName ?? "",
      render: main?.render ?? null,
      groupX: item.groupX,
      groupY: item.groupY,
      groupWidth: item.groupWidth,
      groupHeight: item.groupHeight,
    };
  });
  const groups = scenario.groups.map((group) => ({
    label: resolveGroupLabel(group.orderId, group.receiptCode),
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
  }));
  return { items, groups };
}
