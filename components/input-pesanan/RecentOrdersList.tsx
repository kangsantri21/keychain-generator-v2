"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Eye, Pencil, Trash2, X, Palette, Type, LayoutGrid } from "lucide-react";
import { useTemplateStore, type OrderStatus, type OrderQueueEntry } from "@/lib/store/useTemplateStore";
import { KeychainRenderSvg } from "@/components/shared/KeychainRenderSvg";
import type { OrderItemPreviewPayload } from "@/lib/order-preview-types";
import { invalidateStagingCache } from "@/lib/staging-cache";

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
      invalidateStagingCache(); // the order's staged units are deleted with it

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

const CATEGORY_LABELS = {
  character: "Template Karakter",
  font: "Template Font & Warna",
} as const;

function OrderPreviewModal({
  order,
  onClose,
}: {
  order: OrderQueueEntry;
  onClose: () => void;
}) {
  const [previews, setPreviews] = useState<Map<number, OrderItemPreviewPayload>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          order.items.map(async (item) => {
            const res = await fetch(`/api/order-items/${item.id}/preview`);
            if (!res.ok) return null;
            return (await res.json()) as OrderItemPreviewPayload;
          })
        );
        if (cancelled) return;
        const next = new Map<number, OrderItemPreviewPayload>();
        for (const result of results) {
          if (result) next.set(result.itemId, result);
        }
        setPreviews(next);
      } catch {
        if (!cancelled) toast.error("Gagal memuat pratinjau render item pesanan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [order]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-lg"
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

          <div className="flex flex-col gap-3">
            {order.items.map((item) => {
              const preview = previews.get(item.id);
              const isLoadingThis = loading && !preview;

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row"
                >
                  {/* Left: actual production render — the same pipeline GET
                      /api/staging uses for the Staging Area canvas, not a
                      static admin thumbnail. */}
                  <div className="flex h-[150px] w-full flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 sm:w-[150px]">
                    {isLoadingThis ? (
                      <span className="text-xs text-slate-400">Memuat render...</span>
                    ) : preview?.render ? (
                      <KeychainRenderSvg render={preview.render} className="h-full w-full p-3" />
                    ) : item.thumbnailPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnailPath}
                        alt={item.templateCode ?? ""}
                        className="h-full w-full object-contain p-3"
                      />
                    ) : (
                      <span className="px-3 text-center text-xs text-slate-400">Render tidak tersedia</span>
                    )}
                  </div>

                  {/* Right: full variation data pulled from the template row. */}
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <LayoutGrid size={15} className="flex-shrink-0 text-slate-400" />
                      <span className="font-semibold text-slate-800">
                        {item.templateCode ?? "Template tidak ditemukan"}
                      </span>
                      {preview?.template && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {CATEGORY_LABELS[preview.template.isCharacter ? "character" : "font"]}
                        </span>
                      )}
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                        {item.variant === "pin" ? "Pin" : "Ganci"} x{item.quantity}
                      </span>
                    </div>

                    {preview?.template && preview.template.colors.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Palette size={14} className="flex-shrink-0 text-slate-400" />
                        <div className="flex items-center gap-1">
                          {preview.template.colors.map((color, index) => (
                            <span
                              key={`${color}-${index}`}
                              title={color}
                              className="h-4 w-4 rounded-full border border-slate-300"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {preview?.template && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Type size={14} className="flex-shrink-0 text-slate-400" />
                        Font: {preview.template.fontFileName}
                      </div>
                    )}

                    <div>
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Daftar Nama ({item.names.length})
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.names.map((name, index) => (
                          <span
                            key={`${name}-${index}`}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
