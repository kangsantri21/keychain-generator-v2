"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import type { Template } from "@/lib/db/schema";
import { ColorPaletteEditor, DEFAULT_COLOR, MAX_COLORS, MIN_COLORS } from "./ColorPaletteEditor";

export function FontTemplateForm() {
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailImage, setThumbnailImage] = useState<File | null>(null);
  const [colors, setColors] = useState<string[]>([DEFAULT_COLOR]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const addTemplate = useTemplateStore((state) => state.addTemplate);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  function handleThumbnailChange(event: React.ChangeEvent<HTMLInputElement>) {
    setThumbnailImage(event.target.files?.[0] ?? null);
  }

  function resetForm() {
    setCode("");
    setFile(null);
    setThumbnailImage(null);
    setColors([DEFAULT_COLOR]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!code.trim()) {
      toast.error("Kode template harus diisi");
      return;
    }
    if (!file) {
      toast.error("Pilih file font terlebih dahulu");
      return;
    }
    if (!thumbnailImage) {
      toast.error("Pilih gambar preview/thumbnail terlebih dahulu");
      return;
    }
    if (colors.length < MIN_COLORS || colors.length > MAX_COLORS) {
      toast.error(`Jumlah warna harus antara ${MIN_COLORS} - ${MAX_COLORS}`);
      return;
    }

    const formData = new FormData();
    formData.set("code", code.trim());
    formData.set("category", "font");
    formData.set("file", file);
    formData.set("thumbnailImage", thumbnailImage);
    formData.set("colors", JSON.stringify(colors));

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/templates", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan template");
      addTemplate(data.template as Template);
      toast.success("Template font berhasil disimpan");
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan template");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Kode Template
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="mis. FONT-001"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 sm:max-w-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        File Font (TTF/OTF)
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          onChange={handleFileChange}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 sm:max-w-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Upload Gambar Preview/Thumbnail (PNG/JPG)
        <input
          ref={thumbnailInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,image/png,image/jpeg"
          onChange={handleThumbnailChange}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 sm:max-w-sm"
        />
      </label>

      <ColorPaletteEditor colors={colors} onChange={setColors} />

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Menyimpan..." : "Simpan Template Font"}
      </button>
    </form>
  );
}
