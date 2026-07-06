"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  LayoutTemplate,
  ClipboardList,
  Layers,
  Printer,
  type LucideIcon,
} from "lucide-react";
import {
  PAGE_LABELS,
  PAGE_ROUTES,
  useTemplateStore,
  type PageKey,
} from "@/lib/store/useTemplateStore";

const NAV_ICONS: Record<PageKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  "master-template": LayoutTemplate,
  "input-pesanan": ClipboardList,
  "staging-area": Layers,
  "file-siap-cetak": Printer,
};

const NAV_ORDER: PageKey[] = [
  "dashboard",
  "master-template",
  "input-pesanan",
  "staging-area",
  "file-siap-cetak",
];

export function Sidebar() {
  const pathname = usePathname();
  const setActivePage = useTemplateStore((state) => state.setActivePage);

  useEffect(() => {
    const page = NAV_ORDER.find((key) => PAGE_ROUTES[key] === pathname);
    if (page) setActivePage(page);
  }, [pathname, setActivePage]);

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col bg-slate-800 text-slate-100">
      <div className="flex h-16 items-center px-6 text-lg font-semibold tracking-tight">
        Keychain Generator
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ORDER.map((page) => {
          const href = PAGE_ROUTES[page];
          const Icon = NAV_ICONS[page];
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <Link
              key={page}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {PAGE_LABELS[page]}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
