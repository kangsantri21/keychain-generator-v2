"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Pencil, Trash2 } from "lucide-react";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import type { Template } from "@/lib/db/schema";

function TemplateCard({
  template,
  onEdit,
}: {
  template: Template;
  onEdit: (template: Template) => void;
}) {
  const removeTemplate = useTemplateStore((state) => state.removeTemplate);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/templates/${template.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus template");
      removeTemplate(template.id);
      toast.success(`Template ${template.code} berhasil dihapus`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus template");
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex h-32 items-center justify-center bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={template.thumbnailPath}
          alt={template.code}
          className="max-h-28 max-w-full object-contain"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">{template.code}</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-500">
            {template.type}
          </span>
        </div>
        {template.colors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.colors.map((color, index) => (
              <span
                key={`${color}-${index}`}
                className="h-5 w-5 rounded-full border border-slate-200"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        )}
        {template.isCharacter && (
          <span className="truncate text-xs text-slate-500">Teks: {template.defaultText}</span>
        )}
        <span className="text-xs text-slate-400">
          {new Date(template.createdAt).toLocaleString("id-ID")}
        </span>
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={() => onEdit(template)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-blue-200 px-2 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
          >
            <Pencil size={14} />
            Edit
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="flex flex-1 items-center justify-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 size={14} />
            {isDeleting ? "Menghapus..." : "Hapus"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateSection({
  title,
  items,
  emptyLabel,
  onEdit,
}: {
  title: string;
  items: Template[];
  emptyLabel: string;
  onEdit: (template: Template) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-slate-800">
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((template) => (
            <TemplateCard key={template.id} template={template} onEdit={onEdit} />
          ))}
        </div>
      )}
    </section>
  );
}

export function TemplateGallery({
  templates,
  isLoading,
  onEdit,
}: {
  templates: Template[];
  isLoading: boolean;
  onEdit: (template: Template) => void;
}) {
  if (isLoading) {
    return <p className="text-sm text-slate-400">Memuat template...</p>;
  }

  const characterTemplates = templates.filter((t) => t.isCharacter);
  const fontTemplates = templates.filter((t) => !t.isCharacter);

  return (
    <div className="flex flex-col gap-8">
      <TemplateSection
        title="Template Karakter"
        items={characterTemplates}
        emptyLabel="Belum ada template karakter."
        onEdit={onEdit}
      />
      <TemplateSection
        title="Template Font & Warna"
        items={fontTemplates}
        emptyLabel="Belum ada template font."
        onEdit={onEdit}
      />
    </div>
  );
}
