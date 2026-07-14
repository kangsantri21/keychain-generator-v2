"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import { OrderForm } from "@/components/input-pesanan/OrderForm";
import { RecentOrdersList } from "@/components/input-pesanan/RecentOrdersList";

export default function InputPesananPage() {
  const setTemplates = useTemplateStore((state) => state.setTemplates);
  const setOrderQueue = useTemplateStore((state) => state.setOrderQueue);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [templatesRes, ordersRes] = await Promise.all([
          fetch("/api/templates"),
          fetch("/api/orders"),
        ]);
        const templatesData = await templatesRes.json();
        if (!templatesRes.ok) throw new Error(templatesData.error ?? "Gagal memuat template");
        const ordersData = await ordersRes.json();
        if (!ordersRes.ok) throw new Error(ordersData.error ?? "Gagal memuat pesanan");

        if (!cancelled) {
          setTemplates(templatesData.templates);
          setOrderQueue(ordersData.orders);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat data");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setTemplates, setOrderQueue]);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Input Pesanan</h1>
      <p className="mt-1 text-slate-500">
        Masukkan pesanan pelanggan baru dan tambahkan ke antrean produksi.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <OrderForm />
        <RecentOrdersList />
      </div>
    </div>
  );
}
