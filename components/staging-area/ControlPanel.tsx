"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Lock, Trash2, CheckCircle2, History, Layers, Unlock } from "lucide-react";
import type { StagingSheet } from "@/lib/staging-types";
import { sheetSplitBadge } from "@/lib/receipt-lock";
import { HppCalculator } from "./HppCalculator";

export function ControlPanel({
  sheets,
  activeSheetId,
  onSelectSheet,
  onStartNesting,
  nestNotice,
  onLockBatch,
  isStartingNesting,
  isLocking,
  canLock = true,
  isVerifying = false,
  viewMode,
  onViewModeChange,
  isLoadingHistory,
  onDeleteSheet,
  onCompleteSheet,
  onReopenSheet,
  pendingSheetActionId,
}: {
  sheets: StagingSheet[];
  activeSheetId: number | null;
  onSelectSheet: (sheetId: number) => void;
  onStartNesting: () => void;
  /** Stays on screen after a nest so a 4xx reason is not only a toast that disappears. */
  nestNotice?: { tone: "error" | "warn"; text: string } | null;
  onLockBatch: (batchCode: string) => void;
  isStartingNesting: boolean;
  isLocking: boolean;
  /** False when the active sheet fails the production validation gate — locking is blocked (the server enforces it too). */
  canLock?: boolean;
  /** True while the shown sheets come from the client cache and are being re-checked with the server — locking waits. */
  isVerifying?: boolean;
  viewMode: "active" | "history";
  onViewModeChange: (mode: "active" | "history") => void;
  isLoadingHistory: boolean;
  onDeleteSheet: (sheetId: number) => void;
  onCompleteSheet: (sheetId: number) => void;
  onReopenSheet: (sheetId: number) => void;
  pendingSheetActionId: number | null;
}) {
  const [batchCode, setBatchCode] = useState("");
  const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId) ?? null;
  const isHistory = viewMode === "history";

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Nesting</h2>
        <button
          type="button"
          onClick={onStartNesting}
          disabled={isStartingNesting}
          className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={16} />
          {isStartingNesting ? "Menyusun..." : "Mulai Susun Lembar Kerja"}
        </button>
        {nestNotice && (
          <p
            role="alert"
            className={`whitespace-pre-wrap rounded-md px-3 py-2 text-xs ${
              nestNotice.tone === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
            }`}
          >
            {nestNotice.text}
          </p>
        )}
        <p className="text-xs text-slate-400">
          Menyusun semua resi yang masih pending dengan Production Nesting. Untuk memilih sebagian nama, buka{" "}
          <Link href="/order-queue" className="font-medium text-blue-600 hover:text-blue-700">
            Antrean Pesanan
          </Link>
          . Untuk menyusun ulang, bongkar lembarnya dulu lalu kirim ulang.
        </p>
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
            {sheets.map((sheet) => {
              const partBadge = sheetSplitBadge(sheet.items);
              return (
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
                  <span className="flex items-center gap-1.5">
                    Lembar Kerja #{sheet.sheetId}
                    {partBadge ? (
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                        Bagian {partBadge}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-400">{sheet.items.length} item</span>
                </button>
                {isHistory ? (
                  <button
                    type="button"
                    onClick={() => onReopenSheet(sheet.sheetId)}
                    disabled={pendingSheetActionId === sheet.sheetId}
                    title="Buka Kunci"
                    className="rounded p-1 text-sky-700 transition-colors hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Unlock size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onCompleteSheet(sheet.sheetId)}
                    disabled={pendingSheetActionId === sheet.sheetId}
                    title="Tandai Selesai"
                    className="rounded p-1 text-emerald-600 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDeleteSheet(sheet.sheetId)}
                  disabled={pendingSheetActionId === sheet.sheetId}
                  title="Bongkar / Hapus"
                  className="rounded p-1 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-4">
        <HppCalculator itemCount={activeSheet?.items.length ?? 0} />
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <h2 className="text-sm font-semibold text-slate-800">Kunci Produksi</h2>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Kode Batch (opsional)
          <input
            type="text"
            value={batchCode}
            onChange={(event) => setBatchCode(event.target.value)}
            placeholder="Kosongkan untuk generate otomatis"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>
        <button
          type="button"
          onClick={() => onLockBatch(batchCode)}
          disabled={!activeSheet || isLocking || !canLock || isVerifying}
          className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Lock size={16} />
          {isLocking ? "Mengunci Batch..." : "Kunci & Simpan Batch Produksi"}
        </button>
        {activeSheet && isVerifying && (
          <p className="text-xs text-slate-400">Memeriksa data terbaru dari server sebelum bisa dikunci...</p>
        )}
        {activeSheet && !canLock && (
          <p className="text-xs font-medium text-red-600">Lembar kerja ini INVALID — perbaiki atau bongkar sebelum dikunci.</p>
        )}
        <p className="text-xs text-slate-400">
          Mengarsipkan lembar yang aktif sebagai batch produksi di File Siap Cetak, lalu
          mengosongkan lembar ini. Kalau resi dipecah, hanya bagian di lembar ini yang selesai.
          Resi utuh selesai setelah semua bagiannya terkunci.
        </p>
      </div>
    </div>
  );
}
