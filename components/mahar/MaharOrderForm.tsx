"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { MAHAR_FRAME_SHAPES, MAHAR_SIZE_PRESETS, resolveMaharSizeMm } from "@/lib/mahar-geometry";
import type { MaharFrameShape, MaharOrderFields } from "@/lib/mahar-types";
import { MaharShapePreview } from "./MaharShapePreview";

const DEFAULT_FIELDS: MaharOrderFields = {
  brideName: "",
  groomName: "",
  weddingDate: "",
  nominal: "",
  frameShape: "rectangle",
  size: MAHAR_SIZE_PRESETS[0].label,
};

export function MaharOrderForm({ onCreated }: { onCreated: () => void }) {
  const [fields, setFields] = useState<MaharOrderFields>(DEFAULT_FIELDS);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function set<K extends keyof MaharOrderFields>(key: K, value: MaharOrderFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!fields.brideName.trim()) return toast.error("Nama mempelai wanita harus diisi");
    if (!fields.groomName.trim()) return toast.error("Nama mempelai pria harus diisi");
    if (!fields.weddingDate) return toast.error("Tanggal pernikahan harus diisi");
    if (!fields.nominal.trim()) return toast.error("Nominal/mahar harus diisi");

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/mahar/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan pesanan mahar");

      toast.success("Pesanan mahar ditambahkan ke antrean");
      setFields(DEFAULT_FIELDS);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan pesanan mahar");
    } finally {
      setIsSubmitting(false);
    }
  }

  const { widthMm, heightMm } = resolveMaharSizeMm(fields.size);
  const canvasPadding = Math.max(widthMm, heightMm) * 0.06;
  const canvasWidth = widthMm + canvasPadding * 2;
  const canvasHeight = heightMm + canvasPadding * 2;

  return (
    <div className="grid gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nama Mempelai Wanita
          <input
            type="text"
            value={fields.brideName}
            onChange={(event) => set("brideName", event.target.value)}
            placeholder="mis. Siti Aisyah"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nama Mempelai Pria
          <input
            type="text"
            value={fields.groomName}
            onChange={(event) => set("groomName", event.target.value)}
            placeholder="mis. Ahmad Fauzi"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Tanggal Pernikahan
          <input
            type="date"
            value={fields.weddingDate}
            onChange={(event) => set("weddingDate", event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nominal / Mahar
          <input
            type="text"
            value={fields.nominal}
            onChange={(event) => set("nominal", event.target.value)}
            placeholder="mis. Seperangkat Alat Sholat & Rp 5.000.000"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Bentuk Frame / Pigura
          <select
            value={fields.frameShape}
            onChange={(event) => set("frameShape", event.target.value as MaharFrameShape)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          >
            {MAHAR_FRAME_SHAPES.map((shape) => (
              <option key={shape.value} value={shape.value}>
                {shape.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Ukuran
          <select
            value={fields.size}
            onChange={(event) => set("size", event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          >
            {MAHAR_SIZE_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.label}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Menyimpan..." : "Simpan ke Antrean"}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">Live Preview</span>
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-3">
          <svg viewBox={`${-canvasPadding} ${-canvasPadding} ${canvasWidth} ${canvasHeight}`} className="h-64 w-full max-w-full">
            <MaharShapePreview widthMm={widthMm} heightMm={heightMm} fields={fields} />
          </svg>
        </div>
        <span className="text-center text-xs text-slate-400">
          {fields.size} ({widthMm}x{heightMm}mm)
        </span>
      </div>
    </div>
  );
}
