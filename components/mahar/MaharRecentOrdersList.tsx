"use client";

import { Trash2 } from "lucide-react";
import { formatWeddingDate } from "@/lib/mahar-format";
import type { MaharFrameShape, MaharStatus } from "@/lib/mahar-types";

export interface MaharOrderRow {
  id: number;
  brideName: string;
  groomName: string;
  weddingDate: string;
  nominal: string;
  frameShape: MaharFrameShape;
  size: string;
  status: MaharStatus;
  createdAt: string;
}

const STATUS_STYLES: Record<MaharStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS: Record<MaharStatus, string> = {
  pending: "Pending",
  processing: "Diproses",
  completed: "Selesai",
};

export function MaharRecentOrdersList({
  rows,
  loading,
  deletingId,
  onDelete,
}: {
  rows: MaharOrderRow[];
  loading: boolean;
  deletingId: number | null;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">Antrean Mahar Terbaru</h2>

      {loading ? (
        <p className="mt-3 text-sm text-slate-400">Memuat antrean...</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Belum ada pesanan mahar.</p>
      ) : (
        <div className="mt-3 overflow-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Mempelai</th>
                <th className="px-3 py-2.5">Tanggal</th>
                <th className="px-3 py-2.5">Ukuran / Bentuk</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-3 align-top font-medium text-slate-800">
                    {row.groomName} &amp; {row.brideName}
                  </td>
                  <td className="px-3 py-3 align-top text-slate-600">{formatWeddingDate(row.weddingDate)}</td>
                  <td className="px-3 py-3 align-top text-slate-600">
                    {row.size} — {row.frameShape}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
                      {STATUS_LABELS[row.status]}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    {row.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => onDelete(row.id)}
                        disabled={deletingId === row.id}
                        title="Hapus pesanan"
                        className="rounded p-1 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
