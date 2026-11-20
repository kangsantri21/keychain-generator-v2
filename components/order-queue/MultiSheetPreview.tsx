import { GroupedV2PreviewCanvas, type PreviewSlotOverlay } from "@/components/order-queue/GroupedV2PreviewCanvas";
import {
  partitionBySheet,
  type GroupedV2CanvasGroup,
  type GroupedV2PreviewItem,
  type GroupedV2SheetMetrics,
} from "@/lib/nesting/grouped-nesting-preview";

/**
 * PHASE 2G — one canvas per physical sheet. Each canvas has the media's own
 * 310 x 470 aspect and its own coordinate system (group/item x/y are already
 * sheet-local); sheets are never stacked into one SVG. A single-sheet
 * result renders exactly like the pre-2G preview (one canvas, no header).
 */
export function MultiSheetPreview({
  items,
  groups,
  sheets,
  slots = [],
}: {
  items: GroupedV2PreviewItem[];
  groups: (GroupedV2CanvasGroup & { sheetIndex: number })[];
  sheets: GroupedV2SheetMetrics[];
  /** V3A-1 DEV overlay, per sheet. */
  slots?: (PreviewSlotOverlay & { sheetIndex: number })[];
}) {
  const partitions = partitionBySheet(items, groups, sheets);

  if (partitions.length <= 1) {
    return <GroupedV2PreviewCanvas items={items} groups={groups} slots={slots} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {partitions.map((partition) => {
        const m = partition.metrics;
        return (
          <section key={partition.sheetIndex} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-slate-800">
              SHEET {partition.sheetIndex + 1} / {partitions.length}
            </h3>
            {m && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600 sm:grid-cols-4">
                <span>Orders: {m.orderCount}</span>
                <span>Items: {m.itemCount}</span>
                <span>Used Width: {m.usedWidth.toFixed(1)} mm</span>
                <span>Used Height: {m.usedHeight.toFixed(1)} mm</span>
                <span>Remaining Full-Width: {m.remainingFullWidthHeight.toFixed(1)} mm</span>
                <span>Side Fragment: {m.sideFragmentWidth.toFixed(1)} mm</span>
                <span>Utilization: {m.utilizationPercent.toFixed(1)}%</span>
                <span>Waste: {m.wastePercent.toFixed(1)}%</span>
              </div>
            )}
            <GroupedV2PreviewCanvas
              items={partition.items}
              groups={partition.groups}
              slots={slots.filter((slot) => slot.sheetIndex === partition.sheetIndex)}
            />
          </section>
        );
      })}
    </div>
  );
}
