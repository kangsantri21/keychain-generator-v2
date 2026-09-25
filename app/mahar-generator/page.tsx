"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MaharOrderForm } from "@/components/mahar/MaharOrderForm";
import { MaharRecentOrdersList, type MaharOrderRow } from "@/components/mahar/MaharRecentOrdersList";

export default function MaharGeneratorPage() {
  const [rows, setRows] = useState<MaharOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function loadOrders() {
    try {
      const res = await fetch("/api/mahar/orders");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal memuat antrean mahar");
      setRows(data.orders);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat antrean mahar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadOrders();
    })();
  }, []);

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/mahar/orders/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus pesanan mahar");
      toast.success("Pesanan mahar dihapus");
      setRows((prev) => prev.filter((row) => row.id !== id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus pesanan mahar");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Mahar Generator</h1>
      <p className="mt-1 text-slate-500">
        Masukkan data mahar pengantin baru, lihat pratinjaunya, lalu tambahkan ke antrean nesting.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <MaharOrderForm onCreated={loadOrders} />
        <MaharRecentOrdersList rows={rows} loading={loading} deletingId={deletingId} onDelete={handleDelete} />
      </div>
    </div>
  );
}
