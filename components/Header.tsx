"use client";

import { PAGE_LABELS, useTemplateStore } from "@/lib/store/useTemplateStore";

export function Header() {
  const activePage = useTemplateStore((state) => state.activePage);

  return (
    <header className="flex h-16 flex-shrink-0 items-center bg-slate-800 px-8 text-lg font-semibold text-white">
      {PAGE_LABELS[activePage]}
    </header>
  );
}
