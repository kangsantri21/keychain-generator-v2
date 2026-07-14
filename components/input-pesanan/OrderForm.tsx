"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import { toOrderQueueEntry } from "@/lib/normalize-order";
import type { Template } from "@/lib/db/schema";
import { TemplatePickerModal } from "./TemplatePickerModal";
import { OrderItemBlock, createEmptyItemBlock, parseNamesInput, type ItemBlockState } from "./OrderItemBlock";

export function OrderForm() {
  const templates = useTemplateStore((state) => state.templates);
  const addToQueue = useTemplateStore((state) => state.addToQueue);

  const [receiptCode, setReceiptCode] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [items, setItems] = useState<ItemBlockState[]>(() => [createEmptyItemBlock()]);
  const [activePickerKey, setActivePickerKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateItem(key: string, patch: Partial<ItemBlockState>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function addItem() {
    setItems((current) => [...current, createEmptyItemBlock()]);
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  function handleSelectTemplate(template: Template) {
    if (!activePickerKey) return;
    const key = activePickerKey;
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, template, namesText: "" } : item))
    );
    setActivePickerKey(null);
  }

  function resetForm() {
    setReceiptCode("");
    setManualCode("");
    setItems([createEmptyItemBlock()]);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!receiptCode.trim()) {
      toast.error("Kode resi harus diisi");
      return;
    }
    if (items.length === 0) {
      toast.error("Tambahkan minimal satu template pesanan");
      return;
    }

    const payloadItems: { templateId: number; quantity: number; customerNames: string[] }[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.template) {
        toast.error(`Item #${i + 1}: pilih template terlebih dahulu`);
        return;
      }
      const customerNames = parseNamesInput(item.namesText);
      if (customerNames.length === 0) {
        toast.error(`Item #${i + 1}: daftar nama tidak boleh kosong`);
        return;
      }
      payloadItems.push({
        templateId: item.template.id,
        quantity: customerNames.length,
        customerNames,
      });
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptCode: receiptCode.trim(),
          manualCode: manualCode.trim(),
          items: payloadItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan pesanan");
      addToQueue(toOrderQueueEntry(data.order));
      toast.success("Pesanan berhasil ditambahkan ke antrean");
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan pesanan");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Kode Resi
            <input
              type="text"
              value={receiptCode}
              onChange={(event) => setReceiptCode(event.target.value)}
              placeholder="mis. JNE-123456789"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Kode Manual
            <input
              type="text"
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="mis. M-0001"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <OrderItemBlock
              key={item.key}
              item={item}
              index={index}
              canRemove={items.length > 1}
              onOpenPicker={() => setActivePickerKey(item.key)}
              onNamesTextChange={(text) => updateItem(item.key, { namesText: text })}
              onRemove={() => removeItem(item.key)}
            />
          ))}

          <button
            type="button"
            onClick={addItem}
            className="flex w-fit items-center gap-2 rounded-md border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-blue-600 hover:text-blue-600"
          >
            <Plus size={16} />
            Tambah Template
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-fit rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Menyimpan..." : "Simpan Pesanan Resi Ini"}
        </button>
      </form>

      <TemplatePickerModal
        templates={templates}
        isOpen={activePickerKey !== null}
        onClose={() => setActivePickerKey(null)}
        onSelect={handleSelectTemplate}
      />
    </>
  );
}
