"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LayoutTemplate,
  ClipboardList,
  ListChecks,
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
  "order-queue": ListChecks,
  "staging-area": Layers,
  "file-siap-cetak": Printer,
};

const NAV_ORDER: PageKey[] = [
  "dashboard",
  "master-template",
  "input-pesanan",
  "order-queue",
  "staging-area",
  "file-siap-cetak",
];

export function Sidebar() {
  const pathname = usePathname();
  const setActivePage = useTemplateStore((state) => state.setActivePage);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    const page = NAV_ORDER.find((key) => PAGE_ROUTES[key] === pathname);
    if (page) setActivePage(page);
  }, [pathname, setActivePage]);

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col bg-blue-950 text-slate-100">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-6">
        {!logoError && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/logo.png"
            alt="Kedai Creative"
            width={40}
            height={40}
            className="h-10 w-10 flex-shrink-0 rounded-lg object-contain"
            onError={() => setLogoError(true)}
          />
        )}
        <span className="truncate text-lg font-extrabold tracking-tight text-white">
          Kedai <span className="text-blue-300">Creative</span>
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
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
                  : "text-slate-300 hover:bg-blue-900 hover:text-white"
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
