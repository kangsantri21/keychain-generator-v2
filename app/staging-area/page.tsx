"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ControlPanel } from "@/components/staging-area/ControlPanel";
import { StagingCanvas } from "@/components/staging-area/StagingCanvas";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";
import type { StagingSheet } from "@/lib/staging-types";

type ViewMode = "active" | "history";

export default function StagingAreaPage() {
  const router = useRouter();
  const [sheets, setSheets] = useState<StagingSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRunningNesting, setIsRunningNesting] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [pendingSheetActionId, setPendingSheetActionId] = useState<number | null>(null);

  async function loadSheets(mode: ViewMode): Promise<StagingSheet[]> {
    const res = await fetch(mode === "history" ? "/api/staging?history=1" : "/api/staging");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat staging area");
    return data.sheets as StagingSheet[];
  }

  function applySheets(nextSheets: StagingSheet[]) {
    setSheets(nextSheets);
    setActiveSheetId((current) => {
      if (current && nextSheets.some((sheet) => sheet.sheetId === current)) return current;
      return nextSheets[0]?.sheetId ?? null;
    });
  }

  useEffect(() => {
    (async () => {
      try {
        applySheets(await loadSheets("active"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat staging area");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function handleViewModeChange(mode: ViewMode) {
    if (mode === viewMode) return;
    setViewMode(mode);
    setIsLoadingHistory(true);
    try {
      applySheets(await loadSheets(mode));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat lembar kerja");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function handleRunNesting() {
    setIsRunningNesting(true);
    try {
      const res = await fetch("/api/staging/nest", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyusun lembar kerja");
      toast.success(`${data.items} item disusun ke ${data.sheets} lembar kerja`);
      applySheets(await loadSheets(viewMode));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyusun lembar kerja");
    } finally {
      setIsRunningNesting(false);
    }
  }

  async function handleLockBatch(batchCode: string) {
    const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId);
    if (!activeSheet) return;

    setIsLocking(true);
    try {
      const res = await fetch("/api/print-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId: activeSheet.sheetId,
          batchCode: batchCode.trim() || undefined,
          items: activeSheet.items,
          canvasWidth: SHEET_WIDTH_MM,
          canvasHeight: SHEET_HEIGHT_MM,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunci batch produksi");

      toast.success(`Batch ${data.batch.batchCode} berhasil disimpan`);
      router.push("/file-siap-cetak");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengunci batch produksi");
      setIsLocking(false);
    }
  }

  async function handleDeleteSheet(sheetId: number) {
    if (
      !window.confirm(
        `Bongkar Lembar Kerja #${sheetId}? Item di dalamnya akan kembali ke antrean pesanan pending untuk di-nesting ulang.`
      )
    ) {
      return;
    }
    setPendingSheetActionId(sheetId);
    try {
      const res = await fetch(`/api/staging/sheets/${sheetId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal membongkar lembar kerja");
      toast.success(`Lembar Kerja #${sheetId} dibongkar, pesanan kembali ke antrean`);
      applySheets(await loadSheets(viewMode));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membongkar lembar kerja");
    } finally {
      setPendingSheetActionId(null);
    }
  }

  async function handleCompleteSheet(sheetId: number) {
    if (
      !window.confirm(
        `Tandai Lembar Kerja #${sheetId} selesai? Seluruh pesanan di dalamnya akan ditandai selesai dan hilang dari antrean.`
      )
    ) {
      return;
    }
    setPendingSheetActionId(sheetId);
    try {
      const res = await fetch(`/api/staging/sheets/${sheetId}/complete`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menandai lembar kerja selesai");
      toast.success(`Lembar Kerja #${sheetId} ditandai selesai`);
      applySheets(await loadSheets(viewMode));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menandai lembar kerja selesai");
    } finally {
      setPendingSheetActionId(null);
    }
  }

  const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId) ?? null;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Staging Area</h1>
      <p className="mt-1 text-slate-500">
        Susun pesanan pending ke lembar kerja akrilik 310x470mm sebelum diekspor untuk laser cutting.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <ControlPanel
          sheets={sheets}
          activeSheetId={activeSheetId}
          onSelectSheet={setActiveSheetId}
          onRunNesting={handleRunNesting}
          onLockBatch={handleLockBatch}
          isRunningNesting={isRunningNesting}
          isLocking={isLocking}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          isLoadingHistory={isLoadingHistory}
          onDeleteSheet={handleDeleteSheet}
          onCompleteSheet={handleCompleteSheet}
          pendingSheetActionId={pendingSheetActionId}
        />
        {isLoading ? (
          <p className="text-sm text-slate-400">Memuat staging area...</p>
        ) : (
          <StagingCanvas sheet={activeSheet} />
        )}
      </div>
    </div>
  );
}
