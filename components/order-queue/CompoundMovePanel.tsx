import type { GroupedV2SlotReflow } from "@/lib/nesting/grouped-nesting-preview";
import type { CompoundGroupMove } from "@/lib/nesting/grouped-nesting-v3-compound";

type Compound = NonNullable<GroupedV2SlotReflow["compound"]>;

/**
 * V3A-3 EXPERIMENTAL DEV panel — the two-group compound stage: its own
 * baseline (the V3A-2 result), search counters and each accepted A+B pair.
 * Read-only diagnostics of a dry-run request; never exported.
 */
export function CompoundMovePanel({ compound: c }: { compound: Compound }) {
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  const size = (w: number, h: number) => `${w.toFixed(1)}×${h.toFixed(1)}`;
  const totals = (t: { sheetCount: number; sumUsedHeight: number }) => `${t.sheetCount} sheet · ${mm(t.sumUsedHeight)}`;
  const groupMove = (label: string, receipt: string | null, m: CompoundGroupMove) => (
    <>
      <span className="font-semibold text-slate-700 sm:col-span-2">
        {label}: {receipt ?? `Order #${m.orderId ?? "-"}`} · {m.type} · {m.source} · {m.strategy}
      </span>
      <span>
        FROM: Sheet {m.fromSheetIndex + 1} · ({m.fromX.toFixed(1)}, {m.fromY.toFixed(1)}) · {size(m.beforeWidth, m.beforeHeight)}
      </span>
      <span>
        TO: Sheet {m.toSheetIndex + 1} · ({m.toX.toFixed(1)}, {m.toY.toFixed(1)}) · {size(m.afterWidth, m.afterHeight)}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50/40 p-3 font-mono text-xs text-slate-600">
      <span className="font-semibold text-slate-700">V3A COMPOUND MOVE (EXPERIMENTAL)</span>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">BASELINE (V3A-2)</span>
          <span>Sheets: {c.baseline.sheetCount}</span>
          <span>Sum Used Height: {mm(c.baseline.sumUsedHeight)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">COMPOUND</span>
          <span>Sheets: {c.final.sheetCount}</span>
          <span>Sum Used Height: {mm(c.final.sumUsedHeight)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">IMPROVEMENT</span>
          <span>Sheets Avoided: {c.sheetsAvoided}</span>
          <span>
            Height Saved: {mm(c.heightSavedMm)} / {c.heightSavedPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-white p-2 sm:grid-cols-4">
        <span className="col-span-2 font-semibold text-slate-700 sm:col-span-4">SEARCH</span>
        <span>Passes: {c.passes}</span>
        <span>Primary Groups Considered: {c.primaryGroupsConsidered}</span>
        <span>Primary Moves Tried: {c.primaryMovesTried}</span>
        <span>Primary Rejected (penalty): {c.primaryRejectedPenalty}</span>
        <span>Temporary States Generated: {c.temporaryStatesGenerated}</span>
        <span>Slots After Consolidation: {c.slotsAfterConsolidation}</span>
        <span>Secondary Groups Considered: {c.secondaryGroupsConsidered}</span>
        <span>Pair Attempts: {c.pairAttempts}</span>
        <span>Pair States Evaluated: {c.pairStatesEvaluated}</span>
        <span>Valid Pair States: {c.validPairStates}</span>
        <span>Strictly Better Pair States: {c.strictlyBetterPairStates}</span>
        <span>Accepted Compound Moves: {c.acceptedCompoundMoves}</span>
        <span>
          Budget Used: {c.budgetUsed} / {c.budgetLimit}
          {c.budgetExhausted ? " (HABIS)" : ""}
        </span>
        <span>Max Intermediate Penalty: {mm(c.limits.maxIntermediatePenaltyMm)}</span>
        <span>Runtime: {c.runtimeMs !== null ? `${c.runtimeMs.toFixed(1)} ms` : "—"}</span>
      </div>

      {c.moves.map((move, index) => (
        <div key={index} className="grid grid-cols-1 gap-0.5 rounded bg-white p-2 sm:grid-cols-2">
          <span className="font-semibold text-sky-800 sm:col-span-2">COMPOUND MOVE #{index + 1}</span>
          {groupMove("PRIMARY A", move.primaryReceiptCode, move.primary)}
          <span className="sm:col-span-2">
            SLOT EFFECT (sheet yang disentuh A): free slots {move.slotEffect.before.freeSlots} → {move.slotEffect.after.freeSlots} · largest usable slot{" "}
            {size(move.slotEffect.before.largest.width, move.slotEffect.before.largest.height)} → {size(move.slotEffect.after.largest.width, move.slotEffect.after.largest.height)}
          </span>
          {groupMove("SECONDARY B", move.secondaryReceiptCode, move.secondary)}
          <span>BEFORE: {totals(move.before)}</span>
          <span>INTERMEDIATE (S1, tidak dipakai): {totals(move.intermediate)}</span>
          <span>FINAL: {totals(move.final)}</span>
          <span>
            NET SAVING: {mm(move.netSavingMm)} / {move.netSavingPercent.toFixed(1)}%{move.sheetRemoved ? " · sheet dihapus" : ""}
          </span>
        </div>
      ))}
      <span className="text-slate-400">Index sheet A = penomoran S0; index sheet B = penomoran S1.</span>
    </div>
  );
}
