"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ControlPanel } from "@/components/staging-area/ControlPanel";
import { StagingCanvas } from "@/components/staging-area/StagingCanvas";
import { downloadSheetSvg } from "@/lib/export-svg";
import { downloadPrintSheetJpg } from "@/lib/export-print-svg";
import type { StagingSheet } from "@/lib/staging-types";

export default function StagingAreaPage() {
  const [sheets, setSheets] = useState<StagingSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningNesting, setIsRunningNesting] = useState(false);
  const [isExportingPrint, setIsExportingPrint] = useState(false);
  const [labelText, setLabelText] = useState("");

  async function loadSheets(): Promise<StagingSheet[]> {
    const res = await fetch("/api/staging");
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
        applySheets(await loadSheets());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat staging area");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  async function handleRunNesting() {
    setIsRunningNesting(true);
    try {
      const res = await fetch("/api/staging/nest", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyusun lembar kerja");
      toast.success(`${data.items} item disusun ke ${data.sheets} lembar kerja`);
      applySheets(await loadSheets());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyusun lembar kerja");
    } finally {
      setIsRunningNesting(false);
    }
  }

  function handleExport() {
    const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId);
    if (!activeSheet) return;
    downloadSheetSvg(activeSheet);
    toast.success(`Lembar Kerja #${activeSheet.sheetId} diekspor`);
  }

  async function handleExportPrint() {
    const activeSheet = sheets.find((sheet) => sheet.sheetId === activeSheetId);
    if (!activeSheet) return;
    setIsExportingPrint(true);
    try {
      await downloadPrintSheetJpg(activeSheet, labelText);
      toast.success(`File print Lembar Kerja #${activeSheet.sheetId} diekspor (JPG 300 DPI)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengekspor file print");
    } finally {
      setIsExportingPrint(false);
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
          onExport={handleExport}
          onExportPrint={handleExportPrint}
          labelText={labelText}
          onLabelTextChange={setLabelText}
          isRunningNesting={isRunningNesting}
          isExportingPrint={isExportingPrint}
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
