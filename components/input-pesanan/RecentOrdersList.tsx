"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Eye, Pencil, Trash2, X } from "lucide-react";
import { useTemplateStore, type OrderStatus, type OrderQueueEntry } from "@/lib/store/useTemplateStore";

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

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function itemSummary(order: OrderQueueEntry): string {
  return order.items
    .map((item) => `${item.templateCode ?? "Template?"} x${item.quantity}`)
    .join(", ");
}

export function RecentOrdersList() {
  const orderQueue = useTemplateStore((state) => state.orderQueue);
  const removeFromQueue = useTemplateStore((state) => state.removeFromQueue);
  const [previewOrder, setPreviewOrder] = useState<OrderQueueEntry | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function handleEdit(order: OrderQueueEntry) {
    // No edit flow (form repopulation + update API) exists yet — placeholder
    // until that's designed, so the action doesn't silently do nothing.
    console.log("Edit pesanan diminta untuk order:", order.id);
    toast("Fitur edit pesanan akan segera hadir", { icon: "🛠️" });
  }

  async function handleDelete(order: OrderQueueEntry) {
    const label = order.manualCode || order.receiptCode;
    if (!window.confirm(`Hapus pesanan "${label}"? Tindakan ini tidak bisa dibatalkan.`)) return;

    setDeletingId(order.id);
    try {
      const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus pesanan");

      removeFromQueue(order.id);
      toast.success("Pesanan berhasil dihapus");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus pesanan");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">
        Daftar Antrean Terbaru ({orderQueue.length})
      </h2>

      {orderQueue.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada pesanan.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Waktu</th>
                <th className="px-3 py-2.5">Resi / Kode</th>
                <th className="px-3 py-2.5">Detail Item</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {orderQueue.map((order) => {
                const created = new Date(order.createdAt);
                return (
                  <tr key={order.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-3 align-top text-slate-500">
                      <div className="text-slate-700">{created.toLocaleDateString("id-ID")}</div>
                      <div className="text-xs text-slate-400">
                        {created.toLocaleTimeString("id-ID")}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="font-semibold text-slate-800">{order.manualCode || "-"}</div>
                      <div className="text-xs text-slate-500">Resi: {order.receiptCode}</div>
                    </td>
                    <td className="max-w-xs px-3 py-3 align-top text-slate-600">
                      <span title={itemSummary(order)}>{itemSummary(order) || "-"}</span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewOrder(order)}
                          title="Preview"
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEdit(order)}
                          title="Edit"
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(order)}
                          disabled={deletingId === order.id}
                          title="Hapus"
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

      {previewOrder && (
        <OrderPreviewModal order={previewOrder} onClose={() => setPreviewOrder(null)} />
      )}
    </div>
  );
}

function OrderPreviewModal({
  order,
  onClose,
}: {
  order: OrderQueueEntry;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {order.manualCode || order.receiptCode}
            </h2>
            <p className="text-xs text-slate-500">Resi: {order.receiptCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-center justify-between">
            <StatusBadge status={order.status} />
            <span className="text-xs text-slate-400">
              {new Date(order.createdAt).toLocaleString("id-ID")}
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-3 rounded-lg bg-slate-50 p-3">
                {item.thumbnailPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailPath}
                    alt={item.templateCode ?? ""}
                    className="h-12 w-12 flex-shrink-0 rounded border border-slate-200 bg-white object-contain"
                  />
                ) : (
                  <span className="h-12 w-12 flex-shrink-0 rounded border border-dashed border-slate-200 bg-white" />
                )}
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-slate-700">
                    {item.templateCode ?? "Template tidak ditemukan"} x{item.quantity}
                  </span>
                  <span className="text-sm text-slate-500">{item.names.join(", ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
