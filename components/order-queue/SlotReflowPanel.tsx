import type { GroupedV2SlotReflow } from "@/lib/nesting/grouped-nesting-preview";

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
        <span>Orders Tried: {d.ordersTried}</span>
        <span>Orders Skipped (non-critical): {d.ordersSkippedNonCritical}</span>
        <span>Slots Detected: {d.slotsDetected}</span>
        <span>Slots Pruned: {d.slotsPruned}</span>
        <span>Slots Tried: {d.slotsTried}</span>
        <span>Reflow Attempts: {d.reflowAttempts}</span>
        <span>Successful Reflows: {d.successfulReflows}</span>
        <span>Layout Evaluations: {d.layoutEvaluations}</span>
        <span>Accepted Relocations: {d.acceptedRelocations}</span>
        <span>Rejected No-Ops: {d.rejectedNoOps}</span>
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
                #{index + 1} Order: {move.receiptCode ?? `Order #${move.orderId ?? "-"}`} · {move.source} · {move.strategy}
              </span>
              <span>
                FROM: {sheet(move.fromSheetIndex)} · {move.fromWidth.toFixed(1)}×{move.fromHeight.toFixed(1)} @ ({move.fromX.toFixed(1)}, {move.fromY.toFixed(1)})
              </span>
              <span>
                TO: {sheet(move.toSheetIndex)} · slot {move.slot.width.toFixed(1)}×{move.slot.height.toFixed(1)} → group {move.newWidth.toFixed(1)}×
                {move.newHeight.toFixed(1)} @ ({move.toX.toFixed(1)}, {move.toY.toFixed(1)})
              </span>
              <span>
                Global before: {move.before.sheetCount} sheet · {mm(move.before.sumUsedHeight)}
              </span>
              <span>
                Global after: {move.after.sheetCount} sheet · {mm(move.after.sumUsedHeight)}
                {move.sheetRemoved ? " · sheet dihapus" : ""}
              </span>
            </div>
          ))}
          <span className="text-slate-400">Index sheet FROM/TO = penomoran saat move itu dilakukan.</span>
        </div>
      )}
    </div>
  );
}

/** Dashed DEV overlay of each used slot on its final sheet (only when V3A was applied). */
export function slotOverlaysOf(d: GroupedV2SlotReflow | null | undefined) {
  if (!d || !d.applied) return [];
  return d.moves
    .filter((move) => move.finalSheetIndex !== null)
    .map((move) => ({
      sheetIndex: move.finalSheetIndex!,
      x: move.slot.x,
      y: move.slot.y,
      width: move.slot.width,
      height: move.slot.height,
      label: `FREE SLOT ${move.slot.width.toFixed(1)} × ${move.slot.height.toFixed(1)} · FILLED BY ${move.receiptCode ?? `Order #${move.orderId ?? "-"}`}`,
    }));
}
