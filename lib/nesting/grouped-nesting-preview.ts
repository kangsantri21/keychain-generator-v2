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

export interface GroupedV2PreviewSheet {
  items: GroupedV2PreviewItem[];
  groups: GroupedV2PreviewGroup[];
  metrics: GroupedV2PreviewMetrics;
  optimizer: OuterOptimizerStats & { elapsedMs?: number };
  warnings: string[];
  unfitCount: number;
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
}

/** `receiptCode` when known, else the explicit `Order #<id>` fallback — see the PHASE 2B instructions' own priority order for this. */
function resolveGroupLabel(orderId: number | null, receiptCode: string | null): string {
  if (receiptCode) return receiptCode;
  if (orderId !== null) return `Order #${orderId}`;
  return "(tanpa order)";
}

export function buildGroupedV2PreviewSheet(response: GroupedV2ApiResponse): GroupedV2PreviewSheet {
  const items: GroupedV2PreviewItem[] = response.items.map((item) => ({
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
  };
}
