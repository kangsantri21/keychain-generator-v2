import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import {
  Clock,
  RefreshCw,
  Package,
  ClipboardList,
  ListChecks,
  Layers,
  Printer,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/lib/db";
import { orders, orderItems, printBatches, templates } from "@/lib/db/schema";
import { PAGE_ROUTES } from "@/lib/store/useTemplateStore";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 19) return "Selamat sore";
  return "Selamat malam";
}

async function getDashboardData() {
  const [pendingResult, processingResult, batchResult, recentItems] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(eq(orders.status, "pending")),
    db
      .select({ count: sql<number>`count(*)` })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(eq(orders.status, "processing")),
    db.select({ count: sql<number>`count(*)` }).from(printBatches),
    db
      .select({
        id: orderItems.id,
        customerNames: orderItems.customerNames,
        variant: orderItems.variant,
        templateCode: templates.code,
        createdAt: orders.createdAt,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .leftJoin(templates, eq(orderItems.templateId, templates.id))
      .orderBy(desc(orders.createdAt), desc(orderItems.id))
      .limit(5),
  ]);

  return {
    pendingCount: pendingResult[0]?.count ?? 0,
    processingCount: processingResult[0]?.count ?? 0,
    batchCount: batchResult[0]?.count ?? 0,
    recentItems,
  };
}

const VARIANT_LABELS: Record<string, string> = {
  keychain: "Ganci",
  pin: "Pin",
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-md shadow-slate-200/50">
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg ${accent}`}>
        <Icon size={22} />
      </div>
      <div className="flex flex-col">
        <span className="text-2xl font-semibold text-slate-800">{value}</span>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-xl border border-slate-200/70 px-4 py-5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
        <Icon size={18} />
      </div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </Link>
  );
}

export default async function DashboardPage() {
  const { pendingCount, processingCount, batchCount, recentItems } = await getDashboardData();

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Dashboard Produksi</h1>
      <p className="mt-1 text-slate-500">
        {greeting()}! Berikut ringkasan operasional pabrik hari ini.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Clock}
          label="Pesanan Menunggu"
          value={pendingCount}
          accent="bg-amber-100 text-amber-700"
        />
        <StatCard
          icon={RefreshCw}
          label="Sedang Diproses"
          value={processingCount}
          accent="bg-blue-100 text-blue-700"
        />
        <StatCard
          icon={Package}
          label="Total Batch Produksi"
          value={batchCount}
          accent="bg-emerald-100 text-emerald-700"
        />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-md shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-800">Aksi Cepat</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <QuickAction href={PAGE_ROUTES["input-pesanan"]} icon={ClipboardList} label="Input Pesanan" />
          <QuickAction href={PAGE_ROUTES["order-queue"]} icon={ListChecks} label="Kelola Antrean" />
          <QuickAction href={PAGE_ROUTES["staging-area"]} icon={Layers} label="Staging Area" />
          <QuickAction href={PAGE_ROUTES["file-siap-cetak"]} icon={Printer} label="File Siap Cetak" />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-md shadow-slate-200/50">
        <h2 className="text-sm font-semibold text-slate-800">Pesanan Masuk Terakhir</h2>

        {recentItems.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Belum ada pesanan masuk.</p>
        ) : (
          <div className="mt-3 overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Nama</th>
                  <th className="px-3 py-2.5">Template</th>
                  <th className="px-3 py-2.5">Varian</th>
                  <th className="px-3 py-2.5">Tanggal</th>
                </tr>
              </thead>
              <tbody>
                {recentItems.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-3 align-top font-medium text-slate-800">
                      {item.customerNames.join(", ")}
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600">
                      {item.templateCode ?? "Template tidak ditemukan"}
                    </td>
                    <td className="px-3 py-3 align-top text-slate-600">
                      {VARIANT_LABELS[item.variant] ?? item.variant}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-slate-500">
                      {new Date(item.createdAt).toLocaleDateString("id-ID")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
