"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { Search } from "lucide-react";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import { FontTemplateForm } from "@/components/master-template/FontTemplateForm";
import { TemplateGallery } from "@/components/master-template/TemplateGallery";
import type { Template } from "@/lib/db/schema";

// paper.js (used by the character live preview) touches browser-only APIs
// that break during SSR, so this tab is rendered client-side only.
const CharacterTemplateForm = dynamic(
  () =>
    import("@/components/master-template/CharacterTemplateForm").then(
      (mod) => mod.CharacterTemplateForm
    ),
  { ssr: false }
);

type Tab = "character" | "font";

export default function MasterTemplatePage() {
  const [activeTab, setActiveTab] = useState<Tab>("character");
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const templates = useTemplateStore((state) => state.templates);
  const setTemplates = useTemplateStore((state) => state.setTemplates);

  const filteredTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) => template.code.toLowerCase().includes(query));
  }, [templates, searchQuery]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/templates");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Gagal memuat data template");
        if (!cancelled) setTemplates(data.templates);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Gagal memuat data template");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setTemplates]);

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setEditingTemplate(null);
  }

  function handleEdit(template: Template) {
    setEditingTemplate(template);
    setActiveTab(template.isCharacter ? "character" : "font");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleCancelEdit() {
    setEditingTemplate(null);
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Master Template</h1>
      <p className="mt-1 text-slate-500">
        Kelola template karakter dan template font &amp; warna untuk produksi gantungan kunci.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex border-b border-slate-200">
          <button
            type="button"
            onClick={() => handleTabChange("character")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "character"
                ? "bg-slate-800 text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            Template Karakter
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("font")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "font"
                ? "bg-slate-800 text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            Template Font &amp; Warna
          </button>
        </div>

        <div className="p-6">
          {editingTemplate && (
            <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              Mengedit template <strong>{editingTemplate.code}</strong>
            </div>
          )}
          {activeTab === "character" ? (
            <CharacterTemplateForm
              key={editingTemplate?.isCharacter ? `edit-${editingTemplate.id}` : "create-character"}
              editingTemplate={editingTemplate?.isCharacter ? editingTemplate : null}
              onCancelEdit={handleCancelEdit}
            />
          ) : (
            <FontTemplateForm
              key={editingTemplate && !editingTemplate.isCharacter ? `edit-${editingTemplate.id}` : "create-font"}
              editingTemplate={editingTemplate && !editingTemplate.isCharacter ? editingTemplate : null}
              onCancelEdit={handleCancelEdit}
            />
          )}
        </div>
      </div>

      <div className="mt-10">
        <div className="relative mb-4 max-w-sm">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Cari kode template..."
            className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
        <TemplateGallery templates={filteredTemplates} isLoading={isLoading} onEdit={handleEdit} />
      </div>
    </div>
  );
}
