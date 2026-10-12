import type { GroupedV2SlotReflow } from "@/lib/nesting/grouped-nesting-preview";
import { SlotFunnelPanel } from "@/components/order-queue/SlotFunnelPanel";
import { CompoundMovePanel } from "@/components/order-queue/CompoundMovePanel";
import { RegionRepackPanel } from "@/components/order-queue/RegionRepackPanel";

/**
 * V3A-1 EXPERIMENTAL DEV panel — baseline V2 vs the slot-aware reflow pass,
 * search counters and every accepted relocation. Read-only diagnostics of a
 * dry-run request; nothing here is persisted or exported.
 */
export function SlotReflowPanel({ diagnostics: d }: { diagnostics: GroupedV2SlotReflow }) {
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  const sheet = (index: number) => `Sheet ${index + 1}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50/40 p-3 font-mono text-xs text-slate-600">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-slate-700">V3A SLOT REFLOW (EXPERIMENTAL)</span>
        <span className={`rounded px-2 py-0.5 font-semibold ${d.applied ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}>
          {d.applied ? "V3A DIPAKAI (strictly better)" : `V2 DIPAKAI — ${d.fallbackReason ?? "tidak ada perbaikan"}`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">BASELINE V2</span>
          <span>Sheets: {d.baseline.sheetCount}</span>
          <span>Sum Used Height: {mm(d.baseline.sumUsedHeight)}</span>
          <span>Remaining Full-Width: {mm(d.baseline.totalRemainingFullWidthHeight)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">V3A</span>
          <span>Sheets: {d.final.sheetCount}</span>
          <span>Sum Used Height: {mm(d.final.sumUsedHeight)}</span>
          <span>Remaining Full-Width: {mm(d.final.totalRemainingFullWidthHeight)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">IMPROVEMENT</span>
          <span>Sheets Avoided: {d.sheetsAvoided}</span>
          <span>Height Saved: {mm(d.heightSavedMm)}</span>
          <span>Height Saved: {d.heightSavedPercent.toFixed(1)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-white p-2 sm:grid-cols-4">
        <span className="col-span-2 font-semibold text-slate-700 sm:col-span-4">SEARCH</span>
        <span>Passes: {d.passes}</span>
        <span>Orders Considered: {d.ordersConsidered}</span>
        <span>Orders Tried: {d.ordersTried}</span>
        <span>Slots Pruned: {d.slotsPruned}</span>
        <span>Foreign Slots Detected: {d.foreignSlotsDetected}</span>
        <span>Self Slots Detected: {d.selfSlotsDetected}</span>
        <span>Foreign Slots Tried: {d.foreignSlotsTried}</span>
        <span>Self Slots Tried: {d.selfSlotsTried}</span>
        <span>Reflow Attempts: {d.reflowAttempts}</span>
        <span>Successful Reflows: {d.successfulReflows}</span>
        <span>Layout Evaluations: {d.layoutEvaluations}</span>
        <span>Accepted SELF_REFLOW: {d.acceptedSelfReflow}</span>
        <span>Accepted FOREIGN_RELOCATION: {d.acceptedForeignRelocation}</span>
        <span>Rejected No-op: {d.rejectedNoOps}</span>
        <span>Rejected Not Better: {d.rejectedNotBetter}</span>
        <span>Rejected Invalid: {d.rejectedInvalid}</span>
        <span>
          Budget Used: {d.budgetUsed} / {d.budgetLimit}
          {d.budgetExhausted ? " (HABIS)" : ""}
        </span>
        <span>Runtime: {d.runtimeMs !== null ? `${d.runtimeMs.toFixed(1)} ms` : "—"}</span>
        <span className={d.finalViolations.length === 0 ? "text-green-700" : "text-red-700"} title={d.finalViolations.join("\n")}>
          Validation: {d.finalViolations.length === 0 ? "OK" : `${d.finalViolations.length} pelanggaran`}
        </span>
      </div>

      {d.moves.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-slate-700">ACCEPTED MOVES</span>
          {d.moves.map((move, index) => (
            <div key={index} className="grid grid-cols-1 gap-0.5 rounded bg-white p-2 sm:grid-cols-2">
              <span className="font-semibold text-slate-700 sm:col-span-2">
                #{index + 1}{" "}
                <span className={move.type === "FOREIGN_RELOCATION" ? "text-violet-700" : "text-amber-700"}>{move.type}</span> · Order:{" "}
                {move.receiptCode ?? `Order #${move.orderId ?? "-"}`} · {move.source} · {move.strategy} · gain: {move.improvement}
              </span>
              <span>
                FROM: {sheet(move.fromSheetIndex)} · ({move.fromX.toFixed(1)}, {move.fromY.toFixed(1)}) · {move.fromWidth.toFixed(1)}×
                {move.fromHeight.toFixed(1)}
              </span>
              <span>
                TO: {sheet(move.toSheetIndex)} · ({move.toX.toFixed(1)}, {move.toY.toFixed(1)}) · slot {move.slot.width.toFixed(1)}×
                {move.slot.height.toFixed(1)}
              </span>
              <span>
                REFLOW RESULT: {move.newWidth.toFixed(1)}×{move.newHeight.toFixed(1)}
              </span>
              <span>
                HEIGHT SAVED: {mm(move.heightSavedMm)} / {move.heightSavedPercent.toFixed(1)}%
              </span>
              <span>
                GLOBAL BEFORE: {move.before.sheetCount} sheet · {mm(move.before.sumUsedHeight)}
              </span>
              <span>
                GLOBAL AFTER: {move.after.sheetCount} sheet · {mm(move.after.sumUsedHeight)}
                {move.sheetRemoved ? " · sheet dihapus" : ""}
              </span>
            </div>
          ))}
          <span className="text-slate-400">Index sheet FROM/TO = penomoran saat move itu dilakukan.</span>
        </div>
      )}

      {d.compound && <CompoundMovePanel compound={d.compound} />}

      {d.region && <RegionRepackPanel region={d.region} />}

      {d.funnel && <SlotFunnelPanel funnel={d.funnel} />}
    </div>
  );
}

/**
 * Dashed DEV overlays on the FINAL sheets (only when V3A was applied): the
 * slot each move used, and for a FOREIGN_RELOCATION also the order's old
 * position. Preview only, never exported.
 */
export function slotOverlaysOf(d: GroupedV2SlotReflow | null | undefined) {
  if (!d || !d.applied) return [];
  const name = (move: GroupedV2SlotReflow["moves"][number]) => move.receiptCode ?? `Order #${move.orderId ?? "-"}`;
  return d.moves.flatMap((move) => {
    const overlays = [];
    if (move.finalSheetIndex !== null) {
      overlays.push({
        sheetIndex: move.finalSheetIndex,
        x: move.slot.x,
        y: move.slot.y,
        width: move.slot.width,
        height: move.slot.height,
        kind: "slot" as const,
        label: `${move.type === "FOREIGN_RELOCATION" ? "FOREIGN SLOT" : "SELF SLOT"} ${move.slot.width.toFixed(1)} × ${move.slot.height.toFixed(1)} · FILLED BY ${name(move)}`,
      });
    }
    if (move.type === "FOREIGN_RELOCATION" && move.finalFromSheetIndex !== null) {
      overlays.push({
        sheetIndex: move.finalFromSheetIndex,
        x: move.fromX,
        y: move.fromY,
        width: move.fromWidth,
        height: move.fromHeight,
        kind: "from" as const,
        label: `OLD ORDER POSITION · ${name(move)}`,
      });
    }
    return overlays;
  });
}
