"use client";

import { useState } from "react";
import { GroupedV2PreviewCanvas } from "@/components/order-queue/GroupedV2PreviewCanvas";
import {
  buildScenarioCanvas,
  compareWithManualHeight,
  type GroupedV2Benchmark,
  type GroupedV2PreviewSheet,
} from "@/lib/nesting/grouped-nesting-preview";

/**
 * PHASE 2F DEV-only spacing benchmark panel. Everything here is client state
 * for this page view: the scenarios came from a dry-run request, and the
 * manual CorelDRAW height is never sent or stored anywhere.
 */
export function SpacingBenchmarkPanel({ sheet, benchmark }: { sheet: GroupedV2PreviewSheet; benchmark: GroupedV2Benchmark }) {
  const [manualHeightInput, setManualHeightInput] = useState("");
  const [viewGap, setViewGap] = useState<number | null>(null);

  const { scenarios, recommendation, productionDefaultOrderGapMm } = benchmark;
  const reference = scenarios[0];
  const best = scenarios.find((s) => s.orderGapMm === recommendation.recommendedOrderGapMm) ?? reference;
  const manualHeight = manualHeightInput.trim() === "" ? NaN : Number(manualHeightInput);
  const manual = compareWithManualHeight(best.usedHeight, manualHeight);
  const viewed = viewGap === null ? null : scenarios.find((s) => s.orderGapMm === viewGap) ?? null;
  const viewedCanvas = viewed ? buildScenarioCanvas(sheet, viewed) : null;
  const signed = (value: number, digits = 1) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-violet-200 bg-violet-50/40 p-3 font-mono text-xs text-slate-600">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-slate-700">SPACING BENCHMARK (DEV) — ORDER GAP {scenarios.map((s) => s.orderGapMm).join(" / ")} mm</span>
        <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
          PRODUCTION DEFAULT REMAINS {productionDefaultOrderGapMm} MM
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap">
          <thead className="text-left text-slate-400">
            <tr>
              {[
                "Order Gap",
                "Edge",
                "Orders",
                "Items",
                "Unfit",
                "Sheets",
                "Used W",
                "Used H",
                "Full-Width Left",
                "Side Frag",
                "Util",
                "Waste",
                "Strategy",
                "Sort",
                "States",
                "Outer Att.",
                "Height Saved vs 8mm",
                "Integrity",
                "Time",
              ].map((heading) => (
                <th key={heading} className="py-1 pr-3 font-medium">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.orderGapMm} className={`border-t border-violet-100 ${s.orderGapMm === best.orderGapMm ? "font-semibold text-slate-800" : ""}`}>
                <td className="py-1 pr-3">{s.orderGapMm} mm</td>
                <td className="py-1 pr-3">{s.edgeClearanceMm} mm</td>
                <td className="py-1 pr-3">{s.totalOrders}</td>
                <td className="py-1 pr-3">{s.totalItems}</td>
                <td className="py-1 pr-3">{s.unfitCount}</td>
                <td className="py-1 pr-3">{s.sheetCount}</td>
                <td className="py-1 pr-3">{s.usedWidth.toFixed(1)}</td>
                <td className="py-1 pr-3">{s.usedHeight.toFixed(1)}</td>
                <td className="py-1 pr-3">{s.remainingFullWidthHeight.toFixed(1)}</td>
                <td className="py-1 pr-3">{s.sideFragmentWidth.toFixed(1)}</td>
                <td className="py-1 pr-3">{s.packingUtilizationPercent.toFixed(1)}%</td>
                <td className="py-1 pr-3">{s.wastePercent.toFixed(1)}%</td>
                <td className="py-1 pr-3">{s.selectedHeuristic}</td>
                <td className="py-1 pr-3">{s.selectedSort}</td>
                <td className="py-1 pr-3">{s.candidateStatesEvaluated}</td>
                <td className="py-1 pr-3">{s.outerPackAttempts}</td>
                <td className="py-1 pr-3">
                  {s === reference
                    ? "baseline"
                    : `${s.heightSavedVsDefaultMm.toFixed(1)} mm / ${s.heightSavedVsDefaultPercent.toFixed(1)}%`}
                </td>
                <td className={`py-1 pr-3 ${s.integrity.ok ? "text-green-700" : "text-red-700"}`} title={s.integrity.violations.join("\n")}>
                  {s.integrity.ok ? "OK" : `${s.integrity.violations.length} pelanggaran`}
                </td>
                <td className="py-1 pr-3">{s.elapsedMs !== null ? `${s.elapsedMs.toFixed(0)} ms` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="text-slate-400">
        Edge = jarak efektif group ke tepi media (sheet margin + order gap). Total waktu benchmark: {benchmark.totalElapsedMs.toFixed(0)} ms.
      </span>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">BEST COMPUTER RESULT</span>
          <span>Gap: {best.orderGapMm} mm</span>
          <span>Used Height: {best.usedHeight.toFixed(1)} mm</span>
          <span>Remaining Full-Width: {best.remainingFullWidthHeight.toFixed(1)} mm</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded bg-white p-2">
          <span className="font-semibold text-slate-700">CURRENT PRODUCTION DEFAULT</span>
          <span>Gap: {reference.orderGapMm} mm</span>
          <span>Used Height: {reference.usedHeight.toFixed(1)} mm</span>
          <span>
            Potential Saving: {best.heightSavedVsDefaultMm.toFixed(1)} mm / {best.heightSavedVsDefaultPercent.toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded bg-white p-2">
          <label className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Manual Corel Used Height (mm)</span>
            <input
              type="number"
              min={0}
              step="0.1"
              value={manualHeightInput}
              onChange={(event) => setManualHeightInput(event.target.value)}
              placeholder="opsional"
              className="w-24 rounded border border-slate-300 px-1.5 py-0.5"
            />
          </label>
          {manual ? (
            <>
              <span>APP Used Height (gap {best.orderGapMm} mm): {best.usedHeight.toFixed(1)} mm</span>
              <span>MANUAL Used Height: {manualHeight.toFixed(1)} mm</span>
              <span className={manual.differenceMm > 0 ? "text-red-700" : "text-green-700"}>
                APP vs MANUAL: {signed(manual.differenceMm)} mm / {signed(manual.differencePercent)}%
              </span>
            </>
          ) : (
            <span className="text-slate-400">Kosongkan jika tidak ada pembanding manual. Tidak disimpan.</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 rounded bg-white p-2">
        <span className="font-semibold text-slate-700">
          Recommended for testing: {recommendation.recommendedOrderGapMm} mm
        </span>
        {recommendation.reasons.map((reason) => (
          <span key={reason}>- {reason}</span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span>Lihat layout scenario:</span>
        {scenarios.map((s) => (
          <button
            key={s.orderGapMm}
            type="button"
            onClick={() => setViewGap(viewGap === s.orderGapMm ? null : s.orderGapMm)}
            className={`rounded border px-2 py-0.5 ${viewGap === s.orderGapMm ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white"}`}
          >
            {s.orderGapMm} mm
          </button>
        ))}
      </div>
      {viewed && viewedCanvas && (
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-slate-700">Layout scenario ORDER GAP {viewed.orderGapMm} mm (preview saja)</span>
          <GroupedV2PreviewCanvas items={viewedCanvas.items} groups={viewedCanvas.groups} />
        </div>
      )}
    </div>
  );
}
