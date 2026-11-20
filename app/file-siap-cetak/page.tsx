"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Download, Search, Trash2 } from "lucide-react";
import { downloadSheetDxf } from "@/lib/export-dxf";
import { batchLabelOf, downloadPrintSheetJpg } from "@/lib/export-print-svg";
import { activeProductionFrame } from "@/lib/active-frame";
import type { StagingItemPayload } from "@/lib/staging-types";

type BatchStatus = "pending" | "printed" | "archived";

interface PrintBatch {
  id: number;
  batchCode: string;
  layoutData: StagingItemPayload[];
  canvasWidth: number;
  canvasHeight: number;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLES: Record<BatchStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  printed: "bg-blue-100 text-blue-700",
  archived: "bg-slate-200 text-slate-600",
};

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending: "Pending",
  printed: "Sudah Dicetak",
  archived: "Diarsipkan",
};

export default function FileSiapCetakPage() {
  const [batches, setBatches] = useState<PrintBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingJpgId, setExportingJpgId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/print-batches");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Gagal memuat batch produksi");
        if (!cancelled) setBatches(data.batches);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat batch produksi");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleDownloadDxf(batch: PrintBatch) {
    try {
      downloadSheetDxf({ sheetId: batch.id, items: batch.layoutData }, batch.batchCode);
      toast.success(`Batch ${batch.batchCode} diekspor (DXF)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengekspor file DXF");
    }
  }

  async function handleDownloadJpg(batch: PrintBatch) {
    setExportingJpgId(batch.id);
    try {
      await downloadPrintSheetJpg({ sheetId: batch.id, items: batch.layoutData }, batch.batchCode);
      toast.success(`Batch ${batch.batchCode} diekspor (JPG 300 DPI)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengekspor file print");
    } finally {
      setExportingJpgId(null);
    }
  }

  async function handleDelete(batch: PrintBatch) {
    if (
      !window.confirm(
        `Hapus batch "${batch.batchCode}"? File arsip ini akan dihapus permanen (pesanan di dalamnya tetap tercatat selesai).`
      )
    ) {
      return;
    }
    setDeletingId(batch.id);
    try {
      const res = await fetch(`/api/print-batches/${batch.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus batch");
      setBatches((prev) => prev.filter((b) => b.id !== batch.id));
      toast.success(`Batch ${batch.batchCode} dihapus`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus batch");
    } finally {
      setDeletingId(null);
    }
  }

  const filteredBatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((batch) => batch.batchCode.toLowerCase().includes(q));
  }, [batches, query]);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">File Siap Cetak</h1>
      <p className="mt-1 text-slate-500">
        Arsip batch produksi yang sudah dikunci dari Staging Area — unduh file potong laser (DXF)
        dan file print (JPG) di sini.
      </p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {!loading && batches.length > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari kode batch..."
              className="w-full border-none bg-transparent text-sm text-slate-800 focus:outline-none"
            />
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-400">Memuat batch produksi...</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-slate-400">
            Belum ada batch produksi. Kunci sebuah lembar kerja di Staging Area untuk membuatnya.
          </p>
        ) : filteredBatches.length === 0 ? (
          <p className="text-sm text-slate-400">Tidak ada batch yang cocok dengan pencarian.</p>
        ) : (
          <div className="overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Kode Batch</th>
                  <th className="px-3 py-2.5">Tanggal Pembuatan</th>
                  <th className="px-3 py-2.5">Jumlah Item</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((batch) => {
                  const created = new Date(batch.createdAt);
                  // Same frame + batch-code placement the JPG/DXF export uses (lib/active-frame.ts).
                  const sheet = { sheetId: batch.id, items: batch.layoutData };
                  const frame = activeProductionFrame(sheet);
                  const batchLabel = batchLabelOf(sheet, batch.batchCode);
                  return (
                    <tr key={batch.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-3 align-top font-semibold text-slate-800">
                        {batch.batchCode}
                        <div className="text-xs font-normal text-slate-500">
                          Frame {frame.widthMm} × {frame.heightMm} mm
                          {frame.errors.length > 0 && <span className="text-red-600"> · INVALID</span>}
                        </div>
                        {batchLabel && (
                          <div className={`text-xs font-normal ${batchLabel.status === "PLACED_INTERNAL" ? "text-emerald-700" : "text-amber-700"}`}>
                            BATCH_LABEL: {batchLabel.status}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-slate-600">
                        <div>{created.toLocaleDateString("id-ID")}</div>
                        <div className="text-xs text-slate-400">
                          {created.toLocaleTimeString("id-ID")}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-slate-600">
                        {batch.layoutData.length}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span
                          className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[batch.status]}`}
                        >
                          {STATUS_LABELS[batch.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleDownloadDxf(batch)}
                            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                          >
                            <Download size={14} />
                            DXF
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadJpg(batch)}
                            disabled={exportingJpgId === batch.id}
                            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Download size={14} />
                            {exportingJpgId === batch.id ? "Memproses..." : "Print (JPG)"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(batch)}
                            disabled={deletingId === batch.id}
                            title="Hapus batch"
                            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
