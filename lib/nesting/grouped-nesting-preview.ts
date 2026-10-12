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
import type { SlotReflowDiagnostics, SlotReflowMove } from "./grouped-nesting-v3";
import type { OrderFunnel, PrunedCandidate, SlotFunnel } from "./grouped-nesting-v3-funnel";
import type { CompoundDiagnostics, CompoundMoveDetail } from "./grouped-nesting-v3-compound";

type Labeled<X> = X & { receiptCode: string | null };

/** V3A diagnostics as the API sends them (moves and funnel rows labeled with their receipt code). */
export type GroupedV2SlotReflow = Omit<SlotReflowDiagnostics, "moves" | "funnel" | "compound"> & {
  moves: Labeled<SlotReflowMove>[];
  funnel: (Omit<SlotFunnel, "orders" | "topPrunedForeign"> & { orders: Labeled<OrderFunnel>[]; topPrunedForeign: Labeled<PrunedCandidate>[] }) | null;
  /** V3A-3 compound stage (null unless requested). */
  compound:
    | (Omit<CompoundDiagnostics, "moves"> & {
        moves: (CompoundMoveDetail & { primaryReceiptCode: string | null; secondaryReceiptCode: string | null })[];
      })
    | null;
};

export interface GroupedV2PreviewItem {
  /** Per-request item id (PHASE 2F) — joins a benchmark scenario's positions to this item's render. */
  itemId: number | null;
  orderId: number | null;
  /** PHASE 2G — which sheet this item is on; posX/posY are local to that sheet. */
  sheetIndex: number;
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
  /** PHASE 2G — the one sheet this whole group sits on (x/y local to it). */
  sheetIndex: number;
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

/** PHASE 2G — one sheet's own metrics (coordinates of its groups are local to it). */
export interface GroupedV2SheetMetrics {
  sheetIndex: number;
  width: number;
  height: number;
  orderCount: number;
  itemCount: number;
  itemArea: number;
  usedWidth: number;
  usedHeight: number;
  remainingFullWidthHeight: number;
  sideFragmentWidth: number;
  utilizationPercent: number;
  wastePercent: number;
}

/** PHASE 2G — totals across all sheets. */
export interface GroupedV2Summary {
  sheetCount: number;
  totalOrders: number;
  totalItems: number;
  totalUnfitItems: number;
  sumUsedHeight: number;
  totalRemainingFullWidthHeight: number;
  totalSideFragmentWidth: number;
  totalSheetArea: number;
  totalItemArea: number;
  overallMaterialUtilizationPercent: number;
  averageUsedHeight: number;
  maxUsedHeight: number;
  minUsedHeight: number;
}

export interface GroupedV2UnfitGroup {
  orderId: number | null;
  reason: "ORDER_GROUP_TOO_LARGE_FOR_SHEET";
  width: number;
  height: number;
  itemCount: number;
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
  /** totalItemArea / (sheetCount * sheet area) * 100. */
  overallMaterialUtilizationPercent: number;
  sheets: GroupedV2SheetMetrics[];
  /** Widest sheet. */
  usedWidth: number;
  /** SUM of per-sheet used heights. */
  usedHeight: number;
  /** Sum over sheets. */
  remainingFullWidthHeight: number;
  /** Sum over sheets. */
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
  groups: { orderId: number | null; sheetIndex: number; receiptCode: string | null; x: number; y: number; width: number; height: number; itemCount: number }[];
  items: {
    itemId: number | null;
    orderId: number | null;
    sheetIndex: number;
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
  /** PHASE 2G — per-sheet metrics, totals and explicit unfit reasons. */
  sheets: GroupedV2SheetMetrics[];
  summary: GroupedV2Summary | null;
  unfitGroups: GroupedV2UnfitGroup[];
  /** V3A-1 EXPERIMENTAL — null/absent unless the request opted in (then the layout above is the V3A result or, on fallback, V2). */
  slotReflow?: GroupedV2SlotReflow | null;
}

/** The exact shape `POST /api/staging/nest` returns when `mode: "grouped-v2"` (see app/api/staging/nest/route.ts). */
export interface GroupedV2ApiResponse {
  mode: "grouped-v2";
  dryRun: true;
  groups: {
    orderId: number | null;
    /** PHASE 2G; optional so older payloads still parse (treated as sheet 0). */
    sheetIndex?: number;
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
    sheetIndex?: number;
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
  sheets?: GroupedV2SheetMetrics[];
  summary?: GroupedV2Summary;
  unfitGroups?: GroupedV2UnfitGroup[];
  slotReflow?: GroupedV2SlotReflow | null;
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
    sheetIndex: item.sheetIndex ?? 0,
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
    sheetIndex: group.sheetIndex ?? 0,
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
    sheets: response.sheets ?? [],
    summary: response.summary ?? null,
    unfitGroups: response.unfitGroups ?? [],
    slotReflow: response.slotReflow ?? null,
  };
}

/**
 * PHASE 2G — the preview's top header lines. One sheet: exactly the pre-2G
 * header (its bounding utilization IS that sheet's figure). Several sheets:
 * material figures over the whole fixed media — Sum Used Height and
 * totalItemArea / (sheetCount x sheet area) — and the bounding-box ratio
 * only under an explicit "(Diagnostic)" label, never as plain
 * "Utilization"/"Waste".
 */
export function buildHeaderMetrics(sheet: GroupedV2PreviewSheet): { label: string; value: string }[] {
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  const pct = (value: number) => `${value.toFixed(1)}%`;
  const summary = sheet.summary;

  if (!summary || summary.sheetCount <= 1) {
    return [
      { label: "Mode", value: "GROUPED V2" },
      { label: "Orders", value: String(sheet.metrics.totalOrders) },
      { label: "Items", value: String(sheet.metrics.totalItems) },
      { label: "Unfit", value: String(sheet.unfitCount) },
      { label: "Used Width", value: mm(sheet.metrics.usedWidth) },
      { label: "Used Height", value: mm(sheet.metrics.usedHeight) },
      { label: "Utilization", value: pct(sheet.metrics.packingUtilizationPercent) },
      { label: "Waste", value: pct(sheet.metrics.wastePercent) },
    ];
  }

  return [
    { label: "Mode", value: "GROUPED V2" },
    { label: "Sheet Count", value: String(summary.sheetCount) },
    { label: "Orders", value: String(summary.totalOrders) },
    { label: "Items", value: String(summary.totalItems) },
    { label: "Unfit", value: String(sheet.unfitCount) },
    { label: "Sum Used Height", value: mm(summary.sumUsedHeight) },
    { label: "Overall Material Utilization", value: pct(summary.overallMaterialUtilizationPercent) },
    { label: "Total Remaining Full-Width", value: mm(summary.totalRemainingFullWidthHeight) },
    { label: "Bounding Utilization (Diagnostic)", value: pct(sheet.metrics.packingUtilizationPercent) },
  ];
}

/**
 * PHASE 2G — splits a preview into one entry per sheet so each sheet gets its
 * own canvas and coordinate system. Every item and group goes to exactly the
 * sheet it reports (nothing duplicated, nothing dropped); sheets are listed
 * in sheetIndex order, including any sheet that only appears in `metrics`.
 */
export function partitionBySheet<I extends { sheetIndex: number }, G extends { sheetIndex: number }, M extends { sheetIndex: number }>(
  items: I[],
  groups: G[],
  metrics: M[] = []
): { sheetIndex: number; metrics: M | null; items: I[]; groups: G[] }[] {
  const indexes = [...new Set([...items, ...groups, ...metrics].map((entry) => entry.sheetIndex))].sort((a, b) => a - b);
  return indexes.map((sheetIndex) => ({
    sheetIndex,
    metrics: metrics.find((m) => m.sheetIndex === sheetIndex) ?? null,
    items: items.filter((item) => item.sheetIndex === sheetIndex),
    groups: groups.filter((group) => group.sheetIndex === sheetIndex),
  }));
}

/**
 * PHASE 2G — app vs. manual CorelDRAW for a multi-sheet batch: sheet count
 * and total (summed) used height. `null` if either manual value is missing/
 * invalid. Positive differences = the app uses more.
 */
export function compareWithManualMultiSheet(
  app: { sheetCount: number; sumUsedHeight: number },
  manual: { sheetCount: number; totalUsedHeight: number }
): { sheetDifference: number; heightDifferenceMm: number; heightDifferencePercent: number } | null {
  if (!Number.isInteger(manual.sheetCount) || manual.sheetCount <= 0) return null;
  const height = compareWithManualHeight(app.sumUsedHeight, manual.totalUsedHeight);
  if (!height) return null;
  return {
    sheetDifference: app.sheetCount - manual.sheetCount,
    heightDifferenceMm: height.differenceMm,
    heightDifferencePercent: height.differencePercent,
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
): { items: GroupedV2PreviewItem[]; groups: (GroupedV2CanvasGroup & { sheetIndex: number })[] } {
  const mainById = new Map(sheet.items.filter((item) => item.itemId !== null).map((item) => [item.itemId, item]));
  const items: GroupedV2PreviewItem[] = scenario.items.map((item) => {
    const main = item.itemId !== null ? mainById.get(item.itemId) : undefined;
    return {
      itemId: item.itemId,
      orderId: item.orderId,
      sheetIndex: item.sheetIndex,
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
    sheetIndex: group.sheetIndex,
    label: resolveGroupLabel(group.orderId, group.receiptCode),
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
  }));
  return { items, groups };
}
