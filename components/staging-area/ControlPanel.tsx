"use client";

import { Play, Download, Trash2, CheckCircle2, History, Layers } from "lucide-react";
import type { StagingSheet } from "@/lib/staging-types";

export function ControlPanel({
  sheets,
  activeSheetId,
  onSelectSheet,
  onRunNesting,
  onExport,
  onExportPrint,
  labelText,
  onLabelTextChange,
  isRunningNesting,
  isExportingPrint,
  viewMode,
  onViewModeChange,
  isLoadingHistory,
  onDeleteSheet,
  onCompleteSheet,
  pendingSheetActionId,
}: {
  sheets: StagingSheet[];
  activeSheetId: number | null;
  onSelectSheet: (sheetId: number) => void;
  onRunNesting: () => void;
  onExport: () => void;
  onExportPrint: () => void;
  labelText: string;
  onLabelTextChange: (value: string) => void;
  isRunningNesting: boolean;
  isExportingPrint: boolean;
  viewMode: "active" | "history";
  onViewModeChange: (mode: "active" | "history") => void;
  isLoadingHistory: boolean;
  onDeleteSheet: (sheetId: number) => void;
  onCompleteSheet: (sheetId: number) => void;
  pendingSheetActionId: number | null;
}) {
  const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId) ?? null;
  const isHistory = viewMode === "history";

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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Lembar Kerja ({sheets.length})</h2>
          <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs font-medium">
            <button
              type="button"
              onClick={() => onViewModeChange("active")}
              className={`flex items-center gap-1 px-2 py-1 transition-colors ${
                !isHistory ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Layers size={12} />
              Aktif
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("history")}
              className={`flex items-center gap-1 px-2 py-1 transition-colors ${
                isHistory ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <History size={12} />
              Riwayat
            </button>
          </div>
        </div>

        {isLoadingHistory ? (
          <p className="text-sm text-slate-400">Memuat riwayat...</p>
        ) : sheets.length === 0 ? (
          <p className="text-sm text-slate-400">
            {isHistory
              ? "Belum ada lembar kerja yang selesai."
              : "Belum ada lembar kerja. Jalankan nesting untuk menyusun pesanan pending."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sheets.map((sheet) => (
              <div
                key={sheet.sheetId}
                className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors ${
                  sheet.sheetId === activeSheetId
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSheet(sheet.sheetId)}
                  className="flex flex-1 items-center justify-between text-left hover:text-blue-700"
                >
                  <span>Lembar Kerja #{sheet.sheetId}</span>
                  <span className="text-xs text-slate-400">{sheet.items.length} item</span>
                </button>
                {!isHistory && (
                  <>
                    <button
                      type="button"
                      onClick={() => onCompleteSheet(sheet.sheetId)}
                      disabled={pendingSheetActionId === sheet.sheetId}
                      title="Tandai Selesai"
                      className="rounded p-1 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSheet(sheet.sheetId)}
                      disabled={pendingSheetActionId === sheet.sheetId}
                      title="Bongkar / Hapus"
                      className="rounded p-1 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
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
          Ekspor File Potong Laser (DXF)
        </button>
        <p className="text-xs text-slate-400">
          Mengunduh DXF (mm) vektor siap potong laser/CNC untuk lembar kerja yang aktif.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <h2 className="text-sm font-semibold text-slate-800">Ekspor Print (Xerox C70)</h2>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Kode Lembar / Urgent
          <input
            type="text"
            value={labelText}
            onChange={(event) => onLabelTextChange(event.target.value)}
            placeholder="Contoh: D 14 JULI"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>
        <button
          type="button"
          onClick={onExportPrint}
          disabled={!activeSheet || isExportingPrint}
          className="flex items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download size={16} />
          {isExportingPrint ? "Memproses JPG 300 DPI..." : "Ekspor File Print (Xerox C70)"}
        </button>
        <p className="text-xs text-slate-400">
          Mengunduh JPG raster 300 DPI khusus mesin cetak grafis: seluruh isi kanvas di-mirror
          horizontal untuk back-print, ditambah garis tepi hairline dan 4 titik registrasi di sudut.
        </p>
      </div>
    </div>
  );
}
