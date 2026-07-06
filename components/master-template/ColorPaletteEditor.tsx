"use client";

import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";

export const MIN_COLORS = 1;
export const MAX_COLORS = 6;
export const DEFAULT_COLOR = "#3b82f6";

export function ColorPaletteEditor({
  colors,
  onChange,
}: {
  colors: string[];
  onChange: (colors: string[]) => void;
}) {
  function addColor() {
    if (colors.length >= MAX_COLORS) {
      toast.error(`Maksimal ${MAX_COLORS} warna`);
      return;
    }
    onChange([...colors, DEFAULT_COLOR]);
  }

  function removeColor(index: number) {
    if (colors.length <= MIN_COLORS) {
      toast.error(`Minimal ${MIN_COLORS} warna`);
      return;
    }
    onChange(colors.filter((_, i) => i !== index));
  }

  function updateColor(index: number, value: string) {
    onChange(colors.map((c, i) => (i === index ? value : c)));
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">
        Warna ({colors.length}/{MAX_COLORS})
      </span>
      <div className="flex flex-wrap gap-3">
        {colors.map((color, index) => (
          <div
            key={index}
            className="flex items-center gap-1 rounded-md border border-slate-300 p-1"
          >
            <input
              type="color"
              value={color}
              onChange={(event) => updateColor(index, event.target.value)}
              className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <button
              type="button"
              onClick={() => removeColor(index)}
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Hapus warna"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addColor}
          className="flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-blue-600 hover:text-blue-600"
        >
          <Plus size={14} /> Tambah Warna
        </button>
      </div>
    </div>
  );
}
