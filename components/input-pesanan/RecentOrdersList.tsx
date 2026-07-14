"use client";

import { useTemplateStore, type OrderStatus } from "@/lib/store/useTemplateStore";

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

export function RecentOrdersList() {
  const orderQueue = useTemplateStore((state) => state.orderQueue);

  return (
    <div className="flex h-fit flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">
        Daftar Antrean Terbaru ({orderQueue.length})
      </h2>

      {orderQueue.length === 0 ? (
        <p className="text-sm text-slate-400">Belum ada pesanan.</p>
      ) : (
        <ul className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          {orderQueue.map((order) => (
            <li
              key={order.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-slate-800">
                    {order.manualCode || "-"}
                  </span>
                  <span className="text-xs text-slate-500">Resi: {order.receiptCode}</span>
                </div>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}
                >
                  {STATUS_LABELS[order.status]}
                </span>
              </div>

              <ul className="flex flex-col gap-1.5 rounded-md bg-slate-50 p-2">
                {order.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-xs">
                    {item.thumbnailPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnailPath}
                        alt={item.templateCode ?? ""}
                        className="h-8 w-8 flex-shrink-0 rounded border border-slate-200 bg-white object-contain"
                      />
                    ) : (
                      <span className="h-8 w-8 flex-shrink-0 rounded border border-dashed border-slate-200 bg-white" />
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium text-slate-700">
                        {item.templateCode ?? "Template tidak ditemukan"} x{item.quantity}
                      </span>
                      <span className="truncate text-slate-500">{item.names.join(", ")}</span>
                    </div>
                  </li>
                ))}
              </ul>

              <span className="text-xs text-slate-400">
                {new Date(order.createdAt).toLocaleString("id-ID")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
