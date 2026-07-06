"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import { FontTemplateForm } from "@/components/master-template/FontTemplateForm";
import { TemplateGallery } from "@/components/master-template/TemplateGallery";

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
  const templates = useTemplateStore((state) => state.templates);
  const setTemplates = useTemplateStore((state) => state.setTemplates);

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
            onClick={() => setActiveTab("character")}
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
            onClick={() => setActiveTab("font")}
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
          {activeTab === "character" ? <CharacterTemplateForm /> : <FontTemplateForm />}
        </div>
      </div>

      <div className="mt-10">
        <TemplateGallery templates={templates} isLoading={isLoading} />
      </div>
    </div>
  );
}
