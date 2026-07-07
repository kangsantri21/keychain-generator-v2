"use client";

import { Play, Download } from "lucide-react";
import type { StagingSheet } from "@/lib/staging-types";

export function ControlPanel({
  sheets,
  activeSheetId,
  onSelectSheet,
  onRunNesting,
  onExport,
  isRunningNesting,
}: {
  sheets: StagingSheet[];
  activeSheetId: number | null;
  onSelectSheet: (sheetId: number) => void;
  onRunNesting: () => void;
  onExport: () => void;
  isRunningNesting: boolean;
}) {
  const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId) ?? null;

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Nesting</h2>
        <button
          type="button"
          onClick={onRunNesting}
          disabled={isRunningNesting}
          className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={16} />
          {isRunningNesting ? "Menyusun..." : "Mulai Susun Lembar Kerja (Run Nesting)"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-800">
          Lembar Kerja ({sheets.length})
        </h2>
        {sheets.length === 0 ? (
          <p className="text-sm text-slate-400">
            Belum ada lembar kerja. Jalankan nesting untuk menyusun pesanan pending.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sheets.map((sheet) => (
              <button
                key={sheet.sheetId}
                type="button"
                onClick={() => onSelectSheet(sheet.sheetId)}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  sheet.sheetId === activeSheetId
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>Lembar Kerja #{sheet.sheetId}</span>
                <span className="text-xs text-slate-400">{sheet.items.length} item</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={onExport}
          disabled={!activeSheet}
          className="flex items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download size={16} />
          Ekspor File Cetak (PDF/SVG)
        </button>
        <p className="text-xs text-slate-400">
          Mengunduh SVG vektor siap potong laser untuk lembar kerja yang aktif.
        </p>
      </div>
    </div>
  );
}
