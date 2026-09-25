"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Play, Lock, Download, History, Layers } from "lucide-react";
import { packMaxRects, type NestableRect } from "@/lib/nesting";
import { MAHAR_SHEET_WIDTH_MM, MAHAR_SHEET_HEIGHT_MM, MAHAR_ITEM_PADDING_MM, resolveMaharSizeMm } from "@/lib/mahar-geometry";
import { downloadMaharSheetDxf } from "@/lib/mahar-dxf";
import { formatWeddingDate } from "@/lib/mahar-format";
import type { MaharLayoutItem } from "@/lib/mahar-types";
import type { MaharBatch } from "@/lib/db/mahar-schema";
import type { MaharOrderRow } from "@/components/mahar/MaharRecentOrdersList";
import { MaharSheetCanvas } from "@/components/mahar/MaharSheetCanvas";

export default function MaharNestingPage() {
  const [pendingOrders, setPendingOrders] = useState<MaharOrderRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sheets, setSheets] = useState<MaharLayoutItem[][]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [batches, setBatches] = useState<MaharBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNesting, setIsNesting] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [batchCode, setBatchCode] = useState("");

  async function loadPendingOrders() {
    const res = await fetch("/api/mahar/orders?status=pending");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat antrean mahar");
    setPendingOrders(data.orders);
  }

  async function loadBatches() {
    const res = await fetch("/api/mahar/batches");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat riwayat batch mahar");
    setBatches(data.batches);
  }

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadPendingOrders(), loadBatches()]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat data mahar");
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === pendingOrders.length ? new Set() : new Set(pendingOrders.map((o) => o.id))));
  }

  /**
   * Runs entirely in the browser — unlike the keychain module's nest route,
   * a mahar item's size is already known upfront from its preset (no
   * font/Clipper rendering needed first to discover its footprint), so
   * there's nothing an API round-trip would add here. Only locking the
   * result (below) needs the server, to persist it and mark orders done.
   */
  function handleRunNesting() {
    const selectedOrders = pendingOrders.filter((order) => selected.has(order.id));
    if (selectedOrders.length === 0) {
      toast.error("Pilih minimal satu pesanan mahar untuk disusun");
      return;
    }

    setIsNesting(true);
    try {
      const items: NestableRect<MaharOrderRow>[] = selectedOrders.map((order) => {
        const { widthMm, heightMm } = resolveMaharSizeMm(order.size);
        return { width: widthMm, height: heightMm, data: order };
      });

      // Mahar has no receipt-label asymmetry need — same padding value both
      // ways reproduces plain uniform spacing (see lib/nesting.ts's own doc
      // comment on packMaxRects's paddingRight/paddingBottom parameters).
      const packed = packMaxRects(
        items,
        MAHAR_SHEET_WIDTH_MM,
        MAHAR_SHEET_HEIGHT_MM,
        MAHAR_ITEM_PADDING_MM,
        MAHAR_ITEM_PADDING_MM,
        true
      );

      if (packed.length === 0) {
        toast.error("Tidak ada item yang berhasil disusun (ukuran melebihi lembar kerja)");
        return;
      }
      if (packed.length < items.length) {
        toast.error(`${items.length - packed.length} item terlalu besar untuk muat di lembar kerja manapun, dilewati`);
      }

      const sheetCount = Math.max(...packed.map((p) => p.sheetIndex)) + 1;
      const nextSheets: MaharLayoutItem[][] = Array.from({ length: sheetCount }, () => []);
      for (const p of packed) {
        nextSheets[p.sheetIndex].push({
          orderId: p.data.id,
          brideName: p.data.brideName,
          groomName: p.data.groomName,
          weddingDate: p.data.weddingDate,
          nominal: p.data.nominal,
          frameShape: p.data.frameShape,
          size: p.data.size,
          posX: p.x,
          posY: p.y,
          width: p.width,
          height: p.height,
          rotated: p.rotated,
        });
      }

      setSheets(nextSheets);
      setActiveSheetIndex(0);
      toast.success(`${packed.length} item disusun ke ${sheetCount} lembar kerja`);
    } finally {
      setIsNesting(false);
    }
  }

  const activeItems = sheets[activeSheetIndex] ?? [];

  async function handleLockBatch() {
    if (activeItems.length === 0) return;

    setIsLocking(true);
    try {
      const res = await fetch("/api/mahar/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placements: activeItems.map((item) => ({
            orderId: item.orderId,
            posX: item.posX,
            posY: item.posY,
            width: item.width,
            height: item.height,
            rotated: item.rotated,
          })),
          canvasWidth: MAHAR_SHEET_WIDTH_MM,
          canvasHeight: MAHAR_SHEET_HEIGHT_MM,
          batchCode: batchCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunci batch mahar");

      toast.success(`Batch ${data.batch.batchCode} berhasil disimpan`);
      setSheets((prev) => prev.filter((_, index) => index !== activeSheetIndex));
      setActiveSheetIndex(0);
      setBatchCode("");
      setSelected(new Set());
      await Promise.all([loadPendingOrders(), loadBatches()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengunci batch mahar");
    } finally {
      setIsLocking(false);
    }
  }

  function handleDownloadActiveDxf() {
    if (activeItems.length === 0) return;
    downloadMaharSheetDxf(activeItems, `mahar-lembar-${activeSheetIndex + 1}.dxf`);
  }

  function handleDownloadBatchDxf(batch: MaharBatch) {
    downloadMaharSheetDxf(batch.layoutData, `${batch.batchCode}.dxf`);
  }

  const allSelected = pendingOrders.length > 0 && selected.size === pendingOrders.length;
  const displayedBatches = useMemo(() => batches, [batches]);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Mahar Nesting</h1>
      <p className="mt-1 text-slate-500">
        Susun pesanan mahar pending ke lembar kerja {MAHAR_SHEET_WIDTH_MM}x{MAHAR_SHEET_HEIGHT_MM}mm sebelum diekspor untuk laser
        cutting.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Antrean Pending</h2>
              {pendingOrders.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-xs font-medium text-blue-600 hover:underline">
                  {allSelected ? "Batal Pilih Semua" : "Pilih Semua"}
                </button>
              )}
            </div>

            {isLoading ? (
              <p className="text-sm text-slate-400">Memuat...</p>
            ) : pendingOrders.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada pesanan mahar pending.</p>
            ) : (
              <div className="flex max-h-72 flex-col gap-1.5 overflow-auto">
                {pendingOrders.map((order) => (
                  <label
                    key={order.id}
                    className="flex items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={() => toggleSelected(order.id)}
                      className="mt-0.5"
                    />
                    <span className="flex flex-col">
                      <span className="font-medium text-slate-800">
                        {order.groomName} &amp; {order.brideName}
                      </span>
                      <span className="text-xs text-slate-400">
                        {order.size} — {order.frameShape} — {formatWeddingDate(order.weddingDate)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleRunNesting}
              disabled={isNesting || selected.size === 0}
              className="mt-1 flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} />
              {isNesting ? "Menyusun..." : "Susun Otomatis (Nesting)"}
            </button>
          </div>

          {sheets.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">Lembar Kerja ({sheets.length})</h2>
              <div className="flex flex-wrap gap-1.5">
                {sheets.map((sheetItems, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setActiveSheetIndex(index)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      index === activeSheetIndex
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Lembar #{index + 1} ({sheetItems.length})
                  </button>
                ))}
              </div>

              <div className="mt-2 flex flex-col gap-2 border-t border-slate-200 pt-3">
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
                  onClick={handleLockBatch}
                  disabled={isLocking}
                  className="flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Lock size={16} />
                  {isLocking ? "Mengunci..." : "Kunci Batch"}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadActiveDxf}
                  className="flex items-center justify-center gap-2 rounded-md border border-blue-600 px-4 py-2.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50"
                >
                  <Download size={16} />
                  Download DXF
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <History size={16} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-800">Riwayat Batch</h2>
            </div>
            {displayedBatches.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada batch mahar yang dikunci.</p>
            ) : (
              <div className="flex max-h-56 flex-col gap-1.5 overflow-auto">
                {displayedBatches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-2 text-sm"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-slate-800">{batch.batchCode}</span>
                      <span className="text-xs text-slate-400">{batch.layoutData.length} item</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownloadBatchDxf(batch)}
                      title="Download DXF"
                      className="rounded p-1.5 text-blue-600 transition-colors hover:bg-blue-50"
                    >
                      <Download size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Layers size={16} />
            {sheets.length > 0 ? `Lembar Kerja #${activeSheetIndex + 1}` : "Kanvas Nesting"}
          </div>
          {sheets.length === 0 ? (
            <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-400">
              Pilih pesanan lalu klik &quot;Susun Otomatis&quot; untuk melihat kanvas nesting.
            </div>
          ) : (
            <MaharSheetCanvas items={activeItems} />
          )}
        </div>
      </div>
    </div>
  );
}
