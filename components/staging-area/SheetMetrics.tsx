"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import type { StagingSheet } from "@/lib/staging-types";
import { activeProductionFrame } from "@/lib/active-frame";

/** Operator metrics for the Staging Area: totals over the listed sheets and the active sheet's own numbers + validation status. */
export function SheetMetrics({ sheets, activeSheet }: { sheets: StagingSheet[]; activeSheet: StagingSheet | null }) {
  const totalItems = sheets.reduce((sum, sheet) => sum + sheet.items.length, 0);
  const totalReceipts = new Set(sheets.flatMap((sheet) => sheet.items.map((item) => item.orderId))).size;
  const summary = activeSheet?.summary;
  const mm = (value: number) => `${value.toFixed(1)} mm`;
  // Same frame as the Staging canvas and the JPG/DXF export (lib/active-frame.ts).
  const frame = activeSheet ? activeProductionFrame(activeSheet) : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Jumlah Lembar" value={String(sheets.length)} />
        <Metric label="Jumlah Item" value={String(totalItems)} />
        <Metric label="Jumlah Resi" value={String(totalReceipts)} />
      </div>

      {activeSheet && summary && (
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-800">
              Lembar Kerja #{activeSheet.sheetId}{" "}
              <span className="text-xs font-normal text-slate-500">
                ({summary.profile === "production" ? "Production Nesting" : summary.profile === "mixed" ? "Campuran mode" : "Legacy Flat"}
                {summary.modeSource === "geometry" ? ", dideteksi dari geometri" : ""})
              </span>
            </span>
            {summary.valid ? (
              <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={14} /> VALID
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                <XCircle size={14} /> INVALID
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Item di lembar ini" value={String(summary.itemCount)} />
            <Metric label="Resi di lembar ini" value={String(summary.receiptCount)} />
            <Metric label="Used Height" value={mm(summary.usedHeight)} />
            <Metric label="Sisa Full-Width" value={mm(summary.remainingFullWidth)} />
          </div>
          {frame && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric
                label={frame.adaptive ? "Frame Produksi Aktif" : "Frame Produksi"}
                value={`${frame.widthMm} × ${frame.heightMm} mm`}
              />
              <Metric label="Sisa Full-Width di Bawah Frame" value={mm(frame.savedMm)} />
            </div>
          )}
          {!summary.valid && (
            <ul className="list-disc rounded bg-red-50 py-2 pl-6 pr-2 text-xs text-red-700">
              {summary.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}
