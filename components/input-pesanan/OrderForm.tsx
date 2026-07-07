"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useTemplateStore, type OrderQueueItem } from "@/lib/store/useTemplateStore";
import type { Template } from "@/lib/db/schema";
import { TemplatePickerModal } from "./TemplatePickerModal";

export function OrderForm() {
  const templates = useTemplateStore((state) => state.templates);
  const addToQueue = useTemplateStore((state) => state.addToQueue);

  const [receiptCode, setReceiptCode] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [namesText, setNamesText] = useState("");
  const [namesGrid, setNamesGrid] = useState<string[]>([""]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resizeNamesGrid(current: string[], nextQuantity: number): string[] {
    if (current.length === nextQuantity) return current;
    if (current.length < nextQuantity) {
      return [...current, ...Array(nextQuantity - current.length).fill("")];
    }
    return current.slice(0, nextQuantity);
  }

  function handleQuantityChange(nextQuantity: number) {
    setQuantity(nextQuantity);
    if (selectedTemplate?.isCharacter) {
      setNamesGrid((current) => resizeNamesGrid(current, nextQuantity));
    }
  }

  function handleSelectTemplate(template: Template) {
    setSelectedTemplate(template);
    setIsPickerOpen(false);
    if (template.isCharacter) {
      setNamesGrid(Array(quantity).fill(""));
      setNamesText("");
    } else {
      setNamesGrid([""]);
    }
  }

  function resetForm() {
    setReceiptCode("");
    setManualCode("");
    setSelectedTemplate(null);
    setQuantity(1);
    setNamesText("");
    setNamesGrid([""]);
  }

  function getCustomerNames(): string[] {
    if (selectedTemplate?.isCharacter) {
      return namesGrid.map((name) => name.trim()).filter((name) => name.length > 0);
    }
    return namesText
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!receiptCode.trim()) {
      toast.error("Kode resi harus diisi");
      return;
    }
    if (!manualCode.trim()) {
      toast.error("Kode manual harus diisi");
      return;
    }
    if (!selectedTemplate) {
      toast.error("Pilih template terlebih dahulu");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast.error("Jumlah pesanan minimal 1");
      return;
    }

    const customerNames = getCustomerNames();
    if (customerNames.length === 0) {
      toast.error("Daftar nama tidak boleh kosong");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptCode: receiptCode.trim(),
          manualCode: manualCode.trim(),
          templateId: selectedTemplate.id,
          quantity,
          customerNames,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan pesanan");
      addToQueue(data.order as OrderQueueItem);
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

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Pilih Template</span>
          {selectedTemplate ? (
            <div className="flex items-center gap-3 rounded-md border border-slate-300 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedTemplate.thumbnailPath}
                alt={selectedTemplate.code}
                className="h-12 w-12 rounded bg-slate-50 object-contain"
              />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-semibold text-slate-800">
                  {selectedTemplate.code}
                </span>
                <span className="text-xs text-slate-500">
                  {selectedTemplate.isCharacter ? "Template Karakter" : "Font & Warna Standar"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Ganti
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Pilih Template
            </button>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:max-w-[160px]">
          Jumlah Pesanan
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => handleQuantityChange(Math.max(1, Number(event.target.value) || 1))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Daftar Nama</span>
          {!selectedTemplate ? (
            <p className="text-sm text-slate-400">Pilih template terlebih dahulu.</p>
          ) : selectedTemplate.isCharacter ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {namesGrid.map((name, index) => (
                <div
                  key={index}
                  className="flex flex-col items-center gap-2 rounded-md border border-slate-200 p-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedTemplate.thumbnailPath}
                    alt={selectedTemplate.code}
                    className="h-14 w-14 object-contain"
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => {
                      const next = [...namesGrid];
                      next[index] = event.target.value;
                      setNamesGrid(next);
                    }}
                    placeholder={`Nama #${index + 1}`}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <textarea
                value={namesText}
                onChange={(event) => setNamesText(event.target.value)}
                rows={4}
                placeholder="Ali, Budi, Caca"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
              <span className="text-xs text-slate-400">
                Pisah nama dengan koma (contoh: Ali, Budi, Caca)
              </span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-fit rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Menyimpan..." : "Simpan Pesanan"}
        </button>
      </form>

      <TemplatePickerModal
        templates={templates}
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={handleSelectTemplate}
      />
    </>
  );
}
