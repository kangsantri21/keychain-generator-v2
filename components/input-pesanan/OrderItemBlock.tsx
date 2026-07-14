"use client";

import { Trash2 } from "lucide-react";
import type { Template } from "@/lib/db/schema";

export interface ItemBlockState {
  key: string;
  template: Template | null;
  namesText: string;
}

export function createEmptyItemBlock(): ItemBlockState {
  return {
    key: crypto.randomUUID(),
    template: null,
    namesText: "",
  };
}

/**
 * Splits a pasted name list on commas AND/OR newlines (either format, or a
 * mix of both) into a clean array — trimmed, empty entries dropped. This is
 * the single source of truth for an item's quantity: however many names
 * come out of this is how many units get ordered, no separate count field.
 */
export function parseNamesInput(text: string): string[] {
  return text
    .split(/[,\n]+/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export function OrderItemBlock({
  item,
  index,
  canRemove,
  onOpenPicker,
  onNamesTextChange,
  onRemove,
}: {
  item: ItemBlockState;
  index: number;
  canRemove: boolean;
  onOpenPicker: () => void;
  onNamesTextChange: (text: string) => void;
  onRemove: () => void;
}) {
  const { template } = item;
  const names = parseNamesInput(item.namesText);

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

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Daftar Nama</span>
          <span
            className={`text-xs font-medium ${names.length > 0 ? "text-blue-600" : "text-slate-400"}`}
          >
            Total: {names.length} nama terdeteksi
          </span>
        </div>
        {!template ? (
          <p className="text-sm text-slate-400">Pilih template terlebih dahulu.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <textarea
              value={item.namesText}
              onChange={(event) => onNamesTextChange(event.target.value)}
              rows={4}
              placeholder={"Rofiq, Faza, Nailil\natau satu nama per baris"}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            <span className="text-xs text-slate-400">
              Pisah nama dengan koma atau baris baru — jumlah pesanan otomatis mengikuti jumlah nama.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
