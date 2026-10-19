"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ControlPanel } from "@/components/staging-area/ControlPanel";
import { StagingCanvas } from "@/components/staging-area/StagingCanvas";
import { SheetMetrics } from "@/components/staging-area/SheetMetrics";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";
import type { StagingSheet } from "@/lib/staging-types";
import {
  fetchStagingSnapshot,
  invalidateStagingCache,
  isStagingChanged,
  readStagingCache,
  rememberActiveSheet,
  stagingCacheGeneration,
  writeStagingCache,
} from "@/lib/staging-cache";

type ViewMode = "active" | "history";

export default function StagingAreaPage() {
  const router = useRouter();
  // Cache-first (lib/staging-cache.ts): a revisit renders the last snapshot at once and revalidates in the background.
  const [initialCache] = useState(() => readStagingCache());
  const [sheets, setSheets] = useState<StagingSheet[]>(() => initialCache?.sheets ?? []);
  const [activeSheetId, setActiveSheetId] = useState<number | null>(() => {
    if (!initialCache) return null;
    const remembered = initialCache.activeSheetId;
    if (remembered !== null && initialCache.sheets.some((sheet) => sheet.sheetId === remembered)) return remembered;
    return initialCache.sheets[0]?.sheetId ?? null;
  });
  const [isLoading, setIsLoading] = useState(() => !initialCache);
  // True while the shown active sheets are not yet confirmed by the server — locking waits for it.
  const [isRevalidating, setIsRevalidating] = useState(() => Boolean(initialCache));
  /** Signature of the active-sheet data on screen (null = history or nothing verified). */
  const shownSignature = useRef<string | null>(initialCache?.signature ?? null);
  const viewModeRef = useRef<ViewMode>("active");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [pendingSheetActionId, setPendingSheetActionId] = useState<number | null>(null);

  async function loadHistorySheets(): Promise<StagingSheet[]> {
    const res = await fetch("/api/staging?history=1");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat staging area");
    return data.sheets as StagingSheet[];
  }

  function applySheets(nextSheets: StagingSheet[]) {
    setSheets(nextSheets);
    setActiveSheetId((current) => {
      const next = current && nextSheets.some((sheet) => sheet.sheetId === current) ? current : (nextSheets[0]?.sheetId ?? null);
      if (viewModeRef.current === "active") rememberActiveSheet(next);
      return next;
    });
  }

  /**
   * Fetches the active sheets from the server, refreshes the cache, and only
   * touches the screen when the data actually differs — identical data keeps
   * the current render (no remount, no flicker). Never runs nesting.
   */
  async function refreshActiveSheets() {
    const fetchGeneration = stagingCacheGeneration();
    const fresh = await fetchStagingSnapshot();
    writeStagingCache(fresh, fetchGeneration);
    if (viewModeRef.current !== "active") return;
    if (isStagingChanged({ signature: shownSignature.current ?? "" }, fresh)) {
      shownSignature.current = fresh.signature;
      applySheets(fresh.sheets);
    }
  }

  async function revalidateActiveSheets() {
    setIsRevalidating(true);
    await finishRevalidation();
  }

  /** Runs the background refresh; the revalidating/loading flags are already set (initial state on mount). */
  async function finishRevalidation() {
    try {
      await refreshActiveSheets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat staging area");
    } finally {
      setIsLoading(false);
      setIsRevalidating(false);
    }
  }

  useEffect(() => {
    void finishRevalidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectSheet(sheetId: number) {
    setActiveSheetId(sheetId);
    if (viewModeRef.current === "active") rememberActiveSheet(sheetId);
  }

  async function handleViewModeChange(mode: ViewMode) {
    if (mode === viewMode) return;
    setViewMode(mode);
    viewModeRef.current = mode;
    if (mode === "active") {
      // Back from history: show the cached active sheets at once, confirm in the background.
      const cached = readStagingCache();
      shownSignature.current = cached?.signature ?? null;
      if (cached) applySheets(cached.sheets);
      else setIsLoadingHistory(true);
      try {
        await revalidateActiveSheets();
      } finally {
        setIsLoadingHistory(false);
      }
      return;
    }
    shownSignature.current = null;
    setIsLoadingHistory(true);
    try {
      applySheets(await loadHistorySheets());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat lembar kerja");
    } finally {
      setIsLoadingHistory(false);
    }
  }

  /** After a staging mutation: drop the cache and reload whatever view is open from the server. */
  async function reloadAfterMutation() {
    invalidateStagingCache();
    shownSignature.current = null;
    if (viewModeRef.current === "active") await refreshActiveSheets();
    else applySheets(await loadHistorySheets());
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
      if (!res.ok) {
        const details: string[] = Array.isArray(data.details) ? data.details : [];
        throw new Error([data.error ?? "Gagal mengunci batch produksi", ...details.slice(0, 5)].join("\n"));
      }

      invalidateStagingCache();
      toast.success(`Batch ${data.batch.batchCode} berhasil disimpan`);
      router.push("/file-siap-cetak");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengunci batch produksi");
      setIsLocking(false);
      // The server rejected what is on screen (e.g. stale) — reload it from the server.
      invalidateStagingCache();
      void revalidateActiveSheets();
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
      await reloadAfterMutation();
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
      await reloadAfterMutation();
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
          onSelectSheet={handleSelectSheet}
          onLockBatch={handleLockBatch}
          isLocking={isLocking}
          canLock={!activeSheet?.summary || activeSheet.summary.valid}
          isVerifying={viewMode === "active" && isRevalidating}
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
          <div className="flex flex-col gap-4">
            {viewMode === "active" && isRevalidating && (
              <p className="text-xs text-slate-400">Memeriksa data terbaru...</p>
            )}
            <SheetMetrics sheets={sheets} activeSheet={activeSheet} />
            <StagingCanvas sheet={activeSheet} />
          </div>
        )}
      </div>
    </div>
  );
}
