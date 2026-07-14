"use client";

import { Trash2 } from "lucide-react";
import type { Template } from "@/lib/db/schema";

export interface ItemBlockState {
  key: string;
  template: Template | null;
  quantity: number;
  namesText: string;
  namesGrid: string[];
}

export function createEmptyItemBlock(): ItemBlockState {
  return {
    key: crypto.randomUUID(),
    template: null,
    quantity: 1,
    namesText: "",
    namesGrid: [""],
  };
}

export function OrderItemBlock({
  item,
  index,
  canRemove,
  onOpenPicker,
  onQuantityChange,
  onNamesTextChange,
  onNamesGridChange,
  onRemove,
}: {
  item: ItemBlockState;
  index: number;
  canRemove: boolean;
  onOpenPicker: () => void;
  onQuantityChange: (quantity: number) => void;
  onNamesTextChange: (text: string) => void;
  onNamesGridChange: (nameIndex: number, value: string) => void;
  onRemove: () => void;
}) {
  const { template } = item;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Item #{index + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Hapus item ini"
            className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Pilih Template</span>
        {template ? (
          <div className="flex items-center gap-3 rounded-md border border-slate-300 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={template.thumbnailPath}
              alt={template.code}
              className="h-12 w-12 rounded bg-slate-50 object-contain"
            />
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-semibold text-slate-800">{template.code}</span>
              <span className="text-xs text-slate-500">
                {template.isCharacter ? "Template Karakter" : "Font & Warna Standar"}
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenPicker}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Ganti
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenPicker}
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
          value={item.quantity}
          onChange={(event) => onQuantityChange(Math.max(1, Number(event.target.value) || 1))}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">Daftar Nama</span>
        {!template ? (
          <p className="text-sm text-slate-400">Pilih template terlebih dahulu.</p>
        ) : template.isCharacter ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {item.namesGrid.map((name, nameIndex) => (
              <div
                key={nameIndex}
                className="flex flex-col items-center gap-2 rounded-md border border-slate-200 p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.thumbnailPath}
                  alt={template.code}
                  className="h-14 w-14 object-contain"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(event) => onNamesGridChange(nameIndex, event.target.value)}
                  placeholder={`Nama #${nameIndex + 1}`}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-center text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <textarea
              value={item.namesText}
              onChange={(event) => onNamesTextChange(event.target.value)}
              rows={3}
              placeholder="Ali, Budi, Caca"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            <span className="text-xs text-slate-400">
              Pisah nama dengan koma (contoh: Ali, Budi, Caca)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
