"use client";

import { X } from "lucide-react";
import type { Template } from "@/lib/db/schema";

export function TemplatePickerModal({
  templates,
  isOpen,
  onClose,
  onSelect,
}: {
  templates: Template[];
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: Template) => void;
}) {
  if (!isOpen) return null;

  const characterTemplates = templates.filter((t) => t.isCharacter);
  const fontTemplates = templates.filter((t) => !t.isCharacter);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-800">Pilih Master Template</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {templates.length === 0 ? (
            <p className="text-sm text-slate-400">
              Belum ada template. Buat template terlebih dahulu di Master Template.
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              <TemplateGroup
                title="Template Karakter"
                items={characterTemplates}
                onSelect={onSelect}
              />
              <TemplateGroup
                title="Template Font & Warna"
                items={fontTemplates}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateGroup({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: Template[];
  onSelect: (template: Template) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {items.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition-colors hover:border-blue-500 hover:ring-1 hover:ring-blue-500"
          >
            <div className="flex h-24 items-center justify-center bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={template.thumbnailPath}
                alt={template.code}
                className="max-h-20 max-w-full object-contain"
              />
            </div>
            <div className="flex flex-col gap-1 p-2">
              <span className="truncate text-sm font-semibold text-slate-800">
                {template.code}
              </span>
              <span className="w-fit rounded bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-500">
                {template.type}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
