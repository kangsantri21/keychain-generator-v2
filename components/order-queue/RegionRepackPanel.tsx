import type { GroupedV2SlotReflow } from "@/lib/nesting/grouped-nesting-preview";

type Region = NonNullable<GroupedV2SlotReflow["region"]>;

/**
 * V3A-4 FAST EXPERIMENTAL DEV panel — the local region repack stage: its
 * input (the V3A-3 result, or V3A-2 when compound is off), search counters
 * and each accepted region. Read-only diagnostics; never exported.
 */
export function RegionRepackPanel({ region: r }: { region: Region }) {
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  const size = (w: number, h: number) => `${w.toFixed(1)}×${h.toFixed(1)}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3 font-mono text-xs text-slate-600">
      <span className="font-semibold text-slate-700">V3A-4 REGION REPACK (FAST, EXPERIMENTAL)</span>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">BASE (input stage ini)</span>
          <span>Sheets: {r.baseline.sheets}</span>
          <span>Sum Used Height: {mm(r.baseline.sumHeight)}</span>
          <span>Largest Full-Width Remainder: {mm(r.baseline.maxRemainder)}</span>
          <span>Side Fragments: {mm(r.baseline.sideFragments)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">V3A-4 FAST</span>
          <span>Sheets: {r.final.sheets}</span>
          <span>Sum Used Height: {mm(r.final.sumHeight)}</span>
          <span>Largest Full-Width Remainder: {mm(r.final.maxRemainder)}</span>
          <span>Side Fragments: {mm(r.final.sideFragments)}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">IMPROVEMENT</span>
          <span>Sheets Avoided: {r.sheetsAvoided}</span>
          <span>
            Height Saved: {mm(r.heightSavedMm)} / {r.heightSavedPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded bg-white p-2 sm:grid-cols-4">
        <span className="col-span-2 font-semibold text-slate-700 sm:col-span-4">SEARCH</span>
        <span>Passes: {r.passes}</span>
        <span>Candidate Regions: {r.candidateRegionsDetected}</span>
        <span>Regions Evaluated: {r.regionsEvaluated}</span>
        <span>
          Region Sizes:{" "}
          {Object.entries(r.regionSizes)
            .map(([k, v]) => `${k}×${v}`)
            .join(", ") || "—"}
        </span>
        <span>Beam States Generated: {r.beamStatesGenerated}</span>
        <span>Beam States Kept: {r.beamStatesKept}</span>
        <span>Pruned (bound): {r.statesPrunedBound}</span>
        <span>Pruned (duplicate): {r.statesPrunedDuplicate}</span>
        <span>Pack Attempts: {r.packAttempts}</span>
        <span>Phantom Slots: {r.phantomSlotsDetected}</span>
        <span>Accepted Regions: {r.acceptedRegions}</span>
        <span>
          Budget: {r.budgetUsed} / {r.budgetLimit}
          {r.budgetExhausted ? " (HABIS)" : ""}
        </span>
        <span>Runtime: {r.runtimeMs !== null ? `${r.runtimeMs.toFixed(1)} ms` : "—"}</span>
      </div>

      {r.accepted.map((a, index) => (
        <div key={index} className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-emerald-800">
            REGION #{index + 1} (pass {a.pass + 1}, {a.origin}, order {a.order}) · {mm(a.before.sumHeight)} → {mm(a.after.sumHeight)} (−
            {a.heightSavedMm.toFixed(1)} mm)
          </span>
          {a.receipts.map((x) => (
            <span key={`${index}-${x.orderId}`} className={x.moved ? "" : "text-slate-400"}>
              {x.receiptCode ?? `Order #${x.orderId ?? "-"}`}: Sheet {x.fromSheetIndex + 1} ({x.fromX.toFixed(1)}, {x.fromY.toFixed(1)}) {size(x.fromWidth, x.fromHeight)} →
              Sheet {x.toSheetIndex + 1} ({x.toX.toFixed(1)}, {x.toY.toFixed(1)}) {size(x.toWidth, x.toHeight)}
              {x.changedSheet ? " · pindah sheet" : ""}
              {x.reshaped ? " · bentuk baru" : ""}
              {x.moved ? "" : " · tetap"} · {x.strategy}
            </span>
          ))}
        </div>
      ))}
      <span className="text-slate-400">Index sheet = penomoran pada pass tersebut. Canvas di bawah menampilkan layout final.</span>
    </div>
  );
}
