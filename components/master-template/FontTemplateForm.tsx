"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import type { Template } from "@/lib/db/schema";
import { ColorPaletteEditor, DEFAULT_COLOR, MAX_COLORS, MIN_COLORS } from "./ColorPaletteEditor";

/**
 * The parent keys this component by `editingTemplate?.id ?? "create"`, so a
 * switch between templates (or between edit/create) remounts it — that's
 * what resets these fields, rather than an effect syncing state from props.
 */
export function FontTemplateForm({
  editingTemplate,
  onCancelEdit,
}: {
  editingTemplate: Template | null;
  onCancelEdit: () => void;
}) {
  const [code, setCode] = useState(editingTemplate?.code ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailImage, setThumbnailImage] = useState<File | null>(null);
  const [colors, setColors] = useState<string[]>(
    editingTemplate && editingTemplate.colors.length > 0 ? editingTemplate.colors : [DEFAULT_COLOR]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const addTemplate = useTemplateStore((state) => state.addTemplate);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);

  const isEditing = Boolean(editingTemplate);

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
    if (!isEditing && !file) {
      toast.error("Pilih file font terlebih dahulu");
      return;
    }
    if (!isEditing && !thumbnailImage) {
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
    if (file) formData.set("file", file);
    if (thumbnailImage) formData.set("thumbnailImage", thumbnailImage);
    formData.set("colors", JSON.stringify(colors));

    setIsSubmitting(true);
    try {
      const url = editingTemplate ? `/api/templates/${editingTemplate.id}` : "/api/templates";
      const method = editingTemplate ? "PUT" : "POST";
      const res = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan template");

      if (editingTemplate) {
        updateTemplate(data.template as Template);
        toast.success("Template font berhasil diperbarui");
        onCancelEdit();
      } else {
        addTemplate(data.template as Template);
        toast.success("Template font berhasil disimpan");
        resetForm();
      }
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
        {isEditing && (
          <span className="text-xs text-slate-400">
            (Biarkan kosong jika tidak ingin mengubah file)
          </span>
        )}
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
        {isEditing && (
          <span className="text-xs text-slate-400">
            (Biarkan kosong jika tidak ingin mengubah file)
          </span>
        )}
      </label>

      <ColorPaletteEditor colors={colors} onChange={setColors} />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting
            ? isEditing
              ? "Memperbarui..."
              : "Menyimpan..."
            : isEditing
              ? "Update Template"
              : "Simpan Template Font"}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="w-fit rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Batal Edit
          </button>
        )}
      </div>
    </form>
  );
}
