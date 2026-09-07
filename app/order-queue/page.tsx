"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { OrderItemVariant, OrderQueueEntry, OrderStatus } from "@/lib/store/useTemplateStore";

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  processing: "Diproses",
  completed: "Selesai",
};

const VARIANT_STYLES: Record<OrderItemVariant, string> = {
  keychain: "bg-violet-100 text-violet-700",
  pin: "bg-fuchsia-100 text-fuchsia-700",
};

const VARIANT_LABELS: Record<OrderItemVariant, string> = {
  keychain: "Ganci",
  pin: "Pin",
};

// One row per customer name — the actual unit the nesting machine places on
// a sheet, matching order_items' invariant that names.length is the item's
// real quantity (see components/input-pesanan/OrderItemBlock.tsx).
interface QueueRow {
  rowId: string;
  orderId: number;
  itemId: number;
  customText: string;
  templateCode: string | null;
  variant: OrderItemVariant;
  qty: number;
  status: OrderStatus;
}

function flattenToRows(orders: OrderQueueEntry[]): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      item.names.forEach((name, index) => {
        rows.push({
          rowId: `${item.id}:${index}`,
          orderId: order.id,
          itemId: item.id,
          customText: name,
          templateCode: item.templateCode,
          variant: item.variant,
          qty: 1,
          status: order.status,
        });
      });
    }
  }
  return rows;
}

export default function OrderQueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/orders");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Gagal memuat antrean pesanan");
        if (!cancelled) setRows(flattenToRows(data.orders));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat antrean pesanan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleRow(rowId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.rowId))));
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.rowId)),
    [rows, selected]
  );

  async function handleSendToNesting() {
    if (selectedRows.length === 0) {
      toast.error("Pilih minimal satu pesanan terlebih dahulu");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/staging/nest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: selectedRows.map((row) => row.rowId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengirim ke mesin nesting");

      toast.success(`${data.items} pesanan berhasil disusun di ${data.sheets} lembar`);
      router.push("/staging-area");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengirim ke mesin nesting");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Antrean Pesanan</h1>
      <p className="mt-1 text-slate-500">
        Pilih pesanan yang siap disusun, lalu kirim ke mesin nesting.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {selected.size} dari {rows.length} pesanan dipilih
          </span>
          <button
            type="button"
            onClick={handleSendToNesting}
            disabled={sending}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Memproses..." : "Kirim ke Mesin Nesting"}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Memuat antrean pesanan...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada pesanan dalam antrean.</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Pilih semua pesanan"
                    />
                  </th>
                  <th className="px-3 py-2.5">Nama Pemesan</th>
                  <th className="px-3 py-2.5">Template</th>
                  <th className="px-3 py-2.5">Varian</th>
                  <th className="px-3 py-2.5">Qty</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(row.rowId)}
                        onChange={() => toggleRow(row.rowId)}
                        aria-label={`Pilih pesanan ${row.customText}`}
                      />
                    </td>
                    <td className="px-3 py-3 align-top font-medium text-slate-800">
                      {row.customText}
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600">
                      {row.templateCode ?? "Template tidak ditemukan"}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_STYLES[row.variant]}`}
                      >
                        {VARIANT_LABELS[row.variant]}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600">{row.qty}</td>
                    <td className="px-3 py-3 align-top">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                      >
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
