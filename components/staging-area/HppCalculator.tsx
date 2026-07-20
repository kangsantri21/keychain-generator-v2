"use client";

import { useEffect, useState } from "react";
import { Calculator } from "lucide-react";

const MODAL_STORAGE_KEY = "keychain-generator:modalPerSheet";
const DEFAULT_MODAL_PER_SHEET = 50000;

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")},-`;
}

/**
 * Simple per-sheet HPP (Harga Pokok Produksi) calculator: modal per sheet is
 * a user preference that rarely changes between sessions, so it's persisted
 * to localStorage rather than needing a backend settings table — reactive
 * to both the input and whichever sheet is currently active, since HPP/pcs
 * is just (modal / item count) recomputed on every render.
 */
function readStoredModal(): number {
  if (typeof window === "undefined") return DEFAULT_MODAL_PER_SHEET;
  const stored = localStorage.getItem(MODAL_STORAGE_KEY);
  const parsed = stored ? Number(stored) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MODAL_PER_SHEET;
}

export function HppCalculator({ itemCount }: { itemCount: number }) {
  const [modalPerSheet, setModalPerSheet] = useState(readStoredModal);

  useEffect(() => {
    localStorage.setItem(MODAL_STORAGE_KEY, String(modalPerSheet));
  }, [modalPerSheet]);

  const hppPerPcs = itemCount > 0 ? modalPerSheet / itemCount : 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <Calculator size={15} />
        Kalkulasi Finansial (HPP)
      </h2>

      <label className="flex flex-col gap-1 text-sm font-medium text-amber-900">
        Total Harga Modal 1 Lembar (Akrilik + Print)
        <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-2">
          <span className="text-sm text-slate-400">Rp</span>
          <input
            type="number"
            min={0}
            step={1000}
            value={modalPerSheet}
            onChange={(event) => setModalPerSheet(Math.max(0, Number(event.target.value) || 0))}
            className="w-full border-none bg-transparent text-sm text-slate-800 focus:outline-none"
          />
        </div>
      </label>

      <div className="flex flex-col gap-2 rounded-md bg-white/70 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-amber-900">Isi Lembar</span>
          <span className="text-sm font-semibold text-amber-900">{itemCount} Pcs</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-amber-900">HPP / Modal per Pcs</span>
          <span className="text-lg font-bold text-amber-700">
            {itemCount > 0 ? formatRupiah(hppPerPcs) : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}
