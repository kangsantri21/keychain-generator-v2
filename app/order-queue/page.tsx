"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Search, CircleDot, Trash2, X } from "lucide-react";
import type { OrderItemVariant, OrderQueueEntry, OrderStatus, HoleOverride } from "@/lib/store/useTemplateStore";
import type { StagingSheet } from "@/lib/staging-types";
import type { Template } from "@/lib/db/schema";
import { HoleOverrideModal } from "@/components/order-queue/HoleOverrideModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MultiSheetPreview } from "@/components/order-queue/MultiSheetPreview";
import { SpacingBenchmarkPanel } from "@/components/order-queue/SpacingBenchmarkPanel";
import { SlotReflowPanel, slotOverlaysOf } from "@/components/order-queue/SlotReflowPanel";
import { buildGroupedV2PreviewSheet, buildHeaderMetrics, type GroupedV2ApiResponse, type GroupedV2PreviewSheet } from "@/lib/nesting/grouped-nesting-preview";
import { PART_GAP_MM, ORDER_GAP_MM, SHEET_MARGIN_MM, SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/nesting/grouped-nesting-config";
import { invalidateStagingCache } from "@/lib/staging-cache";
import { rememberCompaction } from "@/lib/staging-overlay";

type NestingMode = "production" | "legacy" | "grouped-v2-preview";

/** "Tambahkan ke Batch Aktif" uses the legacy append packer, so only legacy sheets may receive it. */
function isAppendableSheet(sheet: StagingSheet): boolean {
  return (sheet.summary?.profile ?? "legacy") === "legacy";
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  processing: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pending",
  processing: "Diproses",
  completed: "Selesai",
};

const VARIANT_STYLES: Record<OrderItemVariant, string> = {
  keychain: "bg-violet-100 text-violet-700",
  pin: "bg-fuchsia-100 text-fuchsia-700",
};

const VARIANT_LABELS: Record<OrderItemVariant, string> = {
  keychain: "Ganci",
  pin: "Pin",
};

// One row per customer name — the actual unit the nesting machine places on
// a sheet, matching order_items' invariant that names.length is the item's
// real quantity (see components/input-pesanan/OrderItemBlock.tsx).
interface QueueRow {
  rowId: string;
  orderId: number;
  itemId: number;
  templateId: number;
  nameIndex: number;
  receiptCode: string;
  customText: string;
  templateCode: string | null;
  variant: OrderItemVariant;
  qty: number;
  status: OrderStatus;
  progressLabel: string | null;
  holeOverride: HoleOverride | null;
}

interface ReceiptGroup {
  receiptCode: string;
  rows: QueueRow[];
}

function flattenToRows(orders: OrderQueueEntry[]): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      item.names.forEach((name, index) => {
        rows.push({
          rowId: `${item.id}:${index}`,
          orderId: order.id,
          itemId: item.id,
          templateId: item.templateId,
          nameIndex: index,
          receiptCode: order.receiptCode,
          customText: name,
          templateCode: item.templateCode,
          variant: item.variant,
          qty: 1,
      status: order.status,
      progressLabel: order.progressLabel ?? null,
      holeOverride: item.holeOverrides?.[index] ?? null,
        });
      });
    }
  }
  return rows;
}

/**
 * Groups CONSECUTIVE rows sharing a receiptCode — relies on GET /api/orders'
 * own default sort (orderBy receiptCode, see app/api/orders/route.ts) to
 * already hand back every row from the same receipt contiguously, so this
 * never needs to re-sort (and never silently merges two same-code groups
 * that a re-sort elsewhere could otherwise separate and reunite).
 */
function groupByReceipt(rows: QueueRow[]): ReceiptGroup[] {
  const groups: ReceiptGroup[] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current && current.receiptCode === row.receiptCode) {
      current.rows.push(row);
    } else {
      groups.push({ receiptCode: row.receiptCode, rows: [row] });
    }
  }
  return groups;
}

function GroupCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />;
}

export default function OrderQueuePage() {
  const router = useRouter();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [receiptFilter, setReceiptFilter] = useState("");

  const [activeSheets, setActiveSheets] = useState<StagingSheet[]>([]);
  const [targetSheetId, setTargetSheetId] = useState<number | "">("");
  const [appending, setAppending] = useState(false);

  const [templates, setTemplates] = useState<Map<number, Template>>(new Map());
  const [editingRow, setEditingRow] = useState<QueueRow | null>(null);

  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<ReceiptGroup | null>(null);
  const [isDeletingReceipt, setIsDeletingReceipt] = useState(false);

  // PHASE 2B — dev/engineering visual validation only. `nestingMode`
  // defaults to "legacy" so the normal user workflow (and every existing
  // caller of handleSendToNesting/the button it drives) is completely
  // unchanged unless someone explicitly flips this toggle. `v2Preview` is
  // PURE CLIENT STATE, never written anywhere else — switching back to
  // "legacy" just stops rendering it; nothing about the order/DB/Staging
  // Area was ever touched by having it set.
  // Production Nesting (V3 FAST, ORDER_GAP 8) is the default; Legacy Flat stays as a fallback.
  const [nestingMode, setNestingMode] = useState<NestingMode>("production");
  const [v2Preview, setV2Preview] = useState<GroupedV2PreviewSheet | null>(null);
  // PHASE 2F — opt-in DEV spacing benchmark (ORDER GAP 8/6/4) on the same dry-run request.
  const [benchmarkSpacing, setBenchmarkSpacing] = useState(false);
  // V3A-1 EXPERIMENTAL — opt-in slot-aware reflow on the same dry-run request (off = plain V2).
  const [slotReflow, setSlotReflow] = useState(false);
  // V3A-3 EXPERIMENTAL — two-group compound moves on top of the slot reflow (needs slotReflow).
  const [slotReflowCompound, setSlotReflowCompound] = useState(false);
  // V3A-4 EXPERIMENTAL — local region repack (FAST) on top of the slot reflow (needs slotReflow).
  const [slotReflowRegion, setSlotReflowRegion] = useState(false);

  async function loadOrders() {
    const res = await fetch("/api/orders");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat antrean pesanan");
    setRows(flattenToRows(data.orders));
  }

  async function loadActiveSheets() {
    const res = await fetch("/api/staging");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat lembar kerja aktif");
    const sheets = data.sheets as StagingSheet[];
    setActiveSheets(sheets);
    // Only legacy sheets accept "Tambahkan ke Batch Aktif" (Production Nesting sheets are blocked server-side too).
    const appendable = sheets.filter((sheet) => isAppendableSheet(sheet));
    setTargetSheetId((current) => {
      if (current !== "" && appendable.some((sheet) => sheet.sheetId === current)) return current;
      return appendable[0]?.sheetId ?? "";
    });
  }

  async function loadTemplates() {
    const res = await fetch("/api/templates");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal memuat data template");
    setTemplates(new Map((data.templates as Template[]).map((t) => [t.id, t])));
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([loadOrders(), loadActiveSheets(), loadTemplates()]);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Gagal memuat antrean pesanan");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /** "Edit Lubang" is only meaningful for a text-only ("Custom Nama") template — see HoleOverrideModal's own doc comment. */
  function canEditHole(row: QueueRow): boolean {
    const template = templates.get(row.templateId);
    return Boolean(template && !template.isCharacter && template.layoutMode === "dynamic" && template.hasHole);
  }

  async function handleSaveHoleOverride(row: QueueRow, override: { x: number; y: number } | null) {
    try {
      const res = await fetch(`/api/order-items/${row.itemId}/hole-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameIndex: row.nameIndex, x: override?.x ?? null, y: override?.y ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan override lubang ring");

      toast.success(override ? "Override lubang ring disimpan" : "Override lubang ring direset ke otomatis");
      setEditingRow(null);
      await loadOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan override lubang ring");
    }
  }

  /**
   * receiptCode is unique per order (lib/db/schema.ts), so every row in a
   * ReceiptGroup already shares the same orderId — "Hapus Resi" is really
   * just deleting that one order, cascading its order_items/staging_items
   * (see app/api/orders/[id]/route.ts), reusing the exact same endpoint
   * Input Pesanan's own delete button already calls.
   */
  async function handleConfirmDeleteReceipt() {
    if (!confirmDeleteGroup) return;
    const orderId = confirmDeleteGroup.rows[0].orderId;

    setIsDeletingReceipt(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menghapus resi");
      invalidateStagingCache(); // the order's staged units are deleted with it

      toast.success(`Resi ${confirmDeleteGroup.receiptCode} berhasil dihapus`);
      const deletedRowIds = new Set(confirmDeleteGroup.rows.map((row) => row.rowId));
      setRows((prev) => prev.filter((row) => !deletedRowIds.has(row.rowId)));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const rowId of deletedRowIds) next.delete(rowId);
        return next;
      });
      setConfirmDeleteGroup(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus resi");
    } finally {
      setIsDeletingReceipt(false);
    }
  }

  const filteredRows = useMemo(() => {
    const query = receiptFilter.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => row.receiptCode.toLowerCase().includes(query));
  }, [rows, receiptFilter]);

  const groups = useMemo(() => groupByReceipt(filteredRows), [filteredRows]);

  const allSelected = filteredRows.length > 0 && filteredRows.every((row) => selected.has(row.rowId));

  function toggleRow(rowId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const allCurrentlySelected = filteredRows.every((row) => prev.has(row.rowId));
      const next = new Set(prev);
      for (const row of filteredRows) {
        if (allCurrentlySelected) next.delete(row.rowId);
        else next.add(row.rowId);
      }
      return next;
    });
  }

  function toggleGroup(group: ReceiptGroup) {
    setSelected((prev) => {
      const allInGroupSelected = group.rows.every((row) => prev.has(row.rowId));
      const next = new Set(prev);
      for (const row of group.rows) {
        if (allInGroupSelected) next.delete(row.rowId);
        else next.add(row.rowId);
      }
      return next;
    });
  }

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.rowId)), [rows, selected]);

  async function handleSendToNesting() {
    if (selectedRows.length === 0) {
      toast.error("Pilih minimal satu pesanan terlebih dahulu");
      return;
    }
    // Production: 1 receipt = 1 sheet — receipts already staged/processed are refused (the server enforces it too).
    if (nestingMode === "production") {
      const notPending = [...new Set(selectedRows.filter((row) => row.status !== "pending").map((row) => row.receiptCode))];
      if (notPending.length > 0) {
        toast.error(
          `${notPending.length} resi bukan Pending (sudah di Lembar Kerja/diproses): ${notPending.slice(0, 5).join(", ")}${notPending.length > 5 ? ", …" : ""}. Hapus dari pilihan, atau bongkar lembarnya dulu.`
        );
        return;
      }
    }

    setSending(true);
    try {
      const res = await fetch("/api/staging/nest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          nestingMode === "grouped-v2-preview"
            ? {
                selections: selectedRows.map((row) => row.rowId),
                mode: "grouped-v2",
                ...(benchmarkSpacing ? { benchmark: true } : {}),
                ...(slotReflow ? { slotReflow: true } : {}),
                ...(slotReflow && slotReflowCompound ? { slotReflowCompound: true } : {}),
                ...(slotReflow && slotReflowRegion ? { slotReflowRegion: true } : {}),
              }
            : nestingMode === "production"
              ? { selections: selectedRows.map((row) => row.rowId), mode: "production-v3" }
              : { selections: selectedRows.map((row) => row.rowId) }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        const details: string[] = Array.isArray(data.details) ? data.details : [];
        throw new Error([data.error ?? "Gagal mengirim ke mesin nesting", ...details.slice(0, 5)].join("\n"));
      }

      if (nestingMode === "grouped-v2-preview") {
        // Dry-run only (app/api/staging/nest/route.ts's grouped-v2 branch
        // never writes to stagingItems or order status) — render inline,
        // no navigation, nothing persisted. `v2Preview` is the only place
        // this result lives.
        setV2Preview(buildGroupedV2PreviewSheet(data as GroupedV2ApiResponse));
        if (data.unfitCount > 0) {
          toast.error(`${data.unfitCount} item tidak muat dan dilewati — lihat panel info di bawah`);
        } else {
          toast.success(`Preview: ${data.metrics.totalItems} item, ${data.metrics.totalOrders} grup resi`);
        }
        return;
      }

      invalidateStagingCache();
      if (Array.isArray(data.compaction)) rememberCompaction(data.compaction);
      toast.success(`${data.items} pesanan berhasil disusun di ${data.sheets} lembar`);
      router.push("/staging-area");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengirim ke mesin nesting");
    } finally {
      setSending(false);
    }
  }

  async function handleAppendToActiveBatch() {
    if (selectedRows.length === 0) {
      toast.error("Pilih minimal satu pesanan terlebih dahulu");
      return;
    }
    if (selectedRows.some((row) => row.status !== "pending")) {
      toast.error("Hanya pesanan berstatus Pending yang bisa ditambahkan ke Batch Aktif");
      return;
    }
    if (targetSheetId === "") {
      toast.error(
        activeSheets.length > 0
          ? "Lembar Kerja Production Nesting tidak bisa ditambah — bongkar lalu kirim ulang semua pesanannya dengan Production Nesting"
          : "Belum ada Lembar Kerja aktif — jalankan Nesting terlebih dahulu untuk membuatnya"
      );
      return;
    }

    setAppending(true);
    try {
      const res = await fetch(`/api/staging/sheets/${targetSheetId}/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: selectedRows.map((row) => row.rowId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menambahkan ke batch aktif");

      invalidateStagingCache();
      toast.success(`${data.items} pesanan ditambahkan ke Lembar Kerja #${targetSheetId}`);
      setSelected(new Set());
      await Promise.all([loadOrders(), loadActiveSheets()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambahkan ke batch aktif");
    } finally {
      setAppending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-800">Antrean Pesanan</h1>
      <p className="mt-1 text-slate-500">
        Pilih pesanan yang siap disusun, lalu kirim ke mesin nesting.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">
              {selected.size} dari {filteredRows.length} pesanan dipilih
            </span>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={receiptFilter}
                onChange={(event) => setReceiptFilter(event.target.value)}
                placeholder="Filter Nomor Resi..."
                className="w-48 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Nesting engine — Production Nesting by default; Legacy Flat is the fallback; Grouped V2 Preview is a dev dry-run. Switching never touches the DB by itself. */}
            <div className="flex items-center overflow-hidden rounded-md border border-slate-300 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setNestingMode("production");
                  setV2Preview(null);
                }}
                title="Mesin nesting produksi: satu resi = satu grup, jarak antar resi 8 mm"
                className={`px-2.5 py-2 transition-colors ${
                  nestingMode === "production" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Production Nesting
              </button>
              <button
                type="button"
                onClick={() => {
                  setNestingMode("legacy");
                  setV2Preview(null);
                }}
                className={`px-2.5 py-2 transition-colors ${
                  nestingMode === "legacy" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Legacy Flat (fallback)
              </button>
              <button
                type="button"
                onClick={() => setNestingMode("grouped-v2-preview")}
                title="Alat validasi engineering — hasil tidak disimpan ke database, hanya preview di halaman ini"
                className={`px-2.5 py-2 transition-colors ${
                  nestingMode === "grouped-v2-preview" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                Grouped V2 Preview (Dev)
              </button>
            </div>
            {nestingMode === "grouped-v2-preview" && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600" title="DEV: jalankan juga ORDER GAP 8/6/4 mm untuk perbandingan. Default produksi tidak berubah.">
                <input type="checkbox" checked={benchmarkSpacing} onChange={(event) => setBenchmarkSpacing(event.target.checked)} />
                Benchmark gap 8/6/4
              </label>
            )}
            {nestingMode === "grouped-v2-preview" && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600" title="EXPERIMENTAL: setelah V2, coba pindahkan + susun ulang satu resi ke free slot. Dipakai hanya jika lebih baik. Dry-run, tidak disimpan.">
                <input type="checkbox" checked={slotReflow} onChange={(event) => setSlotReflow(event.target.checked)} />
                V3A Slot Reflow (exp)
              </label>
            )}
            {nestingMode === "grouped-v2-preview" && slotReflow && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600" title="EXPERIMENTAL: setelah slot reflow, coba pasangan 2 resi (A pindah dulu, lalu B). Dipakai hanya jika hasil akhirnya lebih baik. Dry-run.">
                <input type="checkbox" checked={slotReflowCompound} onChange={(event) => setSlotReflowCompound(event.target.checked)} />
                V3A-3 Compound (exp)
              </label>
            )}
            {nestingMode === "grouped-v2-preview" && slotReflow && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600" title="EXPERIMENTAL: lepas 2–3 resi sekaligus dan susun ulang region itu (beam search FAST). Dipakai hanya jika hasil akhirnya lebih baik. Dry-run.">
                <input type="checkbox" checked={slotReflowRegion} onChange={(event) => setSlotReflowRegion(event.target.checked)} />
                V3A-4 Region Repack (FAST)
              </label>
            )}
            <select
              value={targetSheetId}
              onChange={(event) => setTargetSheetId(event.target.value ? Number(event.target.value) : "")}
              disabled={activeSheets.length === 0}
              className="rounded-md border border-slate-300 px-2.5 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeSheets.length === 0 ? (
                <option value="">Belum ada Lembar Kerja aktif</option>
              ) : (
                <>
                  {!activeSheets.some((sheet) => isAppendableSheet(sheet)) && <option value="">Tidak ada Lembar Kerja Legacy aktif</option>}
                  {activeSheets.map((sheet) => (
                    <option key={sheet.sheetId} value={sheet.sheetId} disabled={!isAppendableSheet(sheet)}>
                      Lembar Kerja #{sheet.sheetId} ({sheet.items.length} item)
                      {isAppendableSheet(sheet) ? "" : " — Production, tidak bisa ditambah"}
                    </option>
                  ))}
                </>
              )}
            </select>
            <button
              type="button"
              onClick={handleAppendToActiveBatch}
              disabled={appending || activeSheets.length === 0}
              title="Sisipkan pesanan Pending yang dipilih ke sisa ruang Lembar Kerja aktif tanpa membuat batch baru"
              className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {appending ? "Menambahkan..." : "Tambahkan ke Batch Aktif"}
            </button>
            <button
              type="button"
              onClick={handleSendToNesting}
              disabled={sending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending
                ? "Memproses..."
                : nestingMode === "grouped-v2-preview"
                  ? "Jalankan Preview Grouped V2"
                  : "Kirim ke Mesin Nesting"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Memuat antrean pesanan...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada pesanan dalam antrean.</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-sm text-slate-400">Tidak ada pesanan dengan Nomor Resi &quot;{receiptFilter}&quot;.</p>
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Pilih semua pesanan"
                    />
                  </th>
                  <th className="px-3 py-2.5">Nomor Resi</th>
                  <th className="px-3 py-2.5">Nama Pemesan</th>
                  <th className="px-3 py-2.5">Template</th>
                  <th className="px-3 py-2.5">Varian</th>
                  <th className="px-3 py-2.5">Qty</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const groupChecked = group.rows.every((row) => selected.has(row.rowId));
                  const groupIndeterminate = !groupChecked && group.rows.some((row) => selected.has(row.rowId));

                  return (
                    <Fragment key={group.receiptCode}>
                      <tr className="border-t border-slate-200 bg-slate-50/80">
                        <td className="px-3 py-2 align-top">
                          <GroupCheckbox
                            checked={groupChecked}
                            indeterminate={groupIndeterminate}
                            onChange={() => toggleGroup(group)}
                            label={`Pilih semua item resi ${group.receiptCode}`}
                          />
                        </td>
                        <td colSpan={6} className="px-3 py-2 align-top text-xs font-semibold text-slate-600">
                          Resi: {group.receiptCode}{" "}
                          <span className="font-normal text-slate-400">({group.rows.length} item)</span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteGroup(group)}
                            title={`Hapus seluruh pesanan pada Resi ${group.receiptCode}`}
                            className="flex items-center gap-1 whitespace-nowrap rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                          >
                            <Trash2 size={12} />
                            Hapus
                          </button>
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.rowId} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-3 align-top">
                            <input
                              type="checkbox"
                              checked={selected.has(row.rowId)}
                              onChange={() => toggleRow(row.rowId)}
                              aria-label={`Pilih pesanan ${row.customText}`}
                            />
                          </td>
                          <td className="px-3 py-3 align-top text-slate-500">{row.receiptCode}</td>
                          <td className="px-3 py-3 align-top font-medium text-slate-800">{row.customText}</td>
                          <td className="px-3 py-3 align-top text-slate-600">
                            {row.templateCode ?? "Template tidak ditemukan"}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_STYLES[row.variant]}`}
                            >
                              {VARIANT_LABELS[row.variant]}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top text-slate-600">{row.qty}</td>
                          <td className="px-3 py-3 align-top">
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                                row.progressLabel ? "bg-sky-100 text-sky-800" : STATUS_STYLES[row.status]
                              }`}
                            >
                              {row.progressLabel ?? STATUS_LABELS[row.status]}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            {canEditHole(row) && (
                              <button
                                type="button"
                                onClick={() => setEditingRow(row)}
                                disabled={row.status !== "pending"}
                                title={
                                  row.status !== "pending"
                                    ? "Hanya bisa diedit selagi pesanan masih Pending"
                                    : "Atur posisi lubang ring khusus untuk nama ini"
                                }
                                className={`flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                  row.holeOverride
                                    ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                <CircleDot size={12} />
                                Edit Lubang
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {v2Preview && (
        <div className="mt-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Grouped V2 Preview (Dev) — belum disimpan ke database</h2>
            <button
              type="button"
              onClick={() => setV2Preview(null)}
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Tutup preview"
            >
              <X size={18} />
            </button>
          </div>

          {/* Alat validasi engineering — bukan tampilan produksi. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600 sm:grid-cols-4">
            {buildHeaderMetrics(v2Preview).map(({ label, value }) => (
              <span key={label}>
                {label}: {value}
              </span>
            ))}
            <span>PART GAP: {PART_GAP_MM} mm</span>
            <span>ORDER GAP: {ORDER_GAP_MM} mm</span>
            <span>SHEET MARGIN: {SHEET_MARGIN_MM} mm</span>
          </div>

          {v2Preview.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {v2Preview.warnings.map((warning, index) => (
                <li key={index}>⚠ {warning}</li>
              ))}
            </ul>
          )}

          {/* PHASE 2D/2E dev diagnostics — did the gain come from candidate selection or from the outer packing strategy? */}
          {(() => {
            const optimizer = v2Preview.optimizer;
            const formatScore = (score: typeof optimizer.finalScore) =>
              `${score.sheetCount} lembar · ΣH ${score.usedHeight.toFixed(1)} · ${score.boundingArea.toFixed(0)} mm²`;
            const { usedWidth, usedHeight } = v2Preview.metrics;
            const summary = v2Preview.summary;
            const multiSheet = (summary?.sheetCount ?? 1) > 1;
            const sourceLabel = { phase2c: "Phase 2C (lokal)", phase2d: "Phase 2D (global)", phase2e: "Phase 2E (multi-outer)", phase2h: "Phase 2H (best-existing)" }[
              optimizer.candidateSource
            ];
            return (
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-600 sm:grid-cols-3">
                <span className="font-semibold text-slate-700 sm:col-span-3">OBJECTIVE</span>
                <span>
                  Media: {SHEET_WIDTH_MM} × {SHEET_HEIGHT_MM} mm
                </span>
                <span>Optimization Goal: {multiSheet ? "MIN SHEETS, then MIN SUM USED HEIGHT" : "MIN USED HEIGHT"}</span>
                <span>Reason: preserve reusable full-width remainder</span>
                {multiSheet && summary ? (
                  <>
                    <span className="font-semibold text-slate-700">Sheet Count: {summary.sheetCount}</span>
                    <span>
                      Orders: {summary.totalOrders} · Items: {summary.totalItems} · Unfit: {summary.totalUnfitItems}
                    </span>
                    <span>Total Item Area: {summary.totalItemArea.toFixed(0)} mm²</span>
                    <span>Sum Used Height: {summary.sumUsedHeight.toFixed(1)} mm</span>
                    <span>Total Remaining Full-Width: {summary.totalRemainingFullWidthHeight.toFixed(1)} mm</span>
                    <span>Total Side Fragment: {summary.totalSideFragmentWidth.toFixed(1)} mm</span>
                    <span>
                      Avg / Max / Min Used Height: {summary.averageUsedHeight.toFixed(1)} / {summary.maxUsedHeight.toFixed(1)} /{" "}
                      {summary.minUsedHeight.toFixed(1)} mm
                    </span>
                    <span>Total Sheet Area: {summary.totalSheetArea.toFixed(0)} mm²</span>
                    <span>Overall Material Utilization: {summary.overallMaterialUtilizationPercent.toFixed(1)}%</span>
                  </>
                ) : (
                  <>
                    <span>Used Width: {usedWidth.toFixed(1)} mm</span>
                    <span>Used Height: {usedHeight.toFixed(1)} mm</span>
                    <span />
                    <span>Remaining Full-Width Height: {(SHEET_HEIGHT_MM - usedHeight).toFixed(1)} mm</span>
                    <span>Side Fragment Width: {(SHEET_WIDTH_MM - usedWidth).toFixed(1)} mm</span>
                    <span />
                  </>
                )}
                <span className="mt-2 font-semibold text-slate-700 sm:col-span-3">OUTER PACKING</span>
                <span>Selected Strategy: {optimizer.selectedHeuristic}</span>
                <span>Selected Sort: {optimizer.selectedSort}</span>
                <span>Global Candidate State: {sourceLabel}</span>
                <span>
                  Strategies Tried: {optimizer.attemptsPerState}/{optimizer.strategiesTried} per state
                </span>
                <span>
                  Outer Attempts: {optimizer.outerPackAttempts}
                  {optimizer.limitReached ? " (limit)" : ""}
                </span>
                <span>
                  States Evaluated: {optimizer.candidateStatesEvaluated}
                  {optimizer.elapsedMs !== undefined ? ` · ${optimizer.elapsedMs.toFixed(0)} ms` : ""}
                </span>
                <span>Baseline 2C: {formatScore(optimizer.phase2cScore)}</span>
                <span>Phase 2D: {formatScore(optimizer.phase2dScore)}</span>
                <span>Final: {formatScore(optimizer.finalScore)}</span>
                <span>Height Improvement vs 2C: {optimizer.improvementVsPhase2CPercent.toFixed(1)}%</span>
                <span>Height Improvement vs 2D: {optimizer.improvementVsPhase2DPercent.toFixed(1)}%</span>
                {/* PHASE 2H — "before" is the Phase 2G LAST_ONLY result. */}
                <span className="mt-2 font-semibold text-slate-700 sm:col-span-3">MULTI-SHEET PACKING</span>
                <span>
                  Strategy: {optimizer.multiSheet.mode}
                  {optimizer.multiSheet.bestExistingEvaluated && optimizer.multiSheet.mode === "LAST_ONLY" ? " (fallback — 2G tetap terbaik)" : ""}
                  {!optimizer.multiSheet.bestExistingEvaluated ? " (1 lembar — BEST_EXISTING tidak diperlukan)" : ""}
                </span>
                <span>
                  Sheets Before → After: {optimizer.multiSheet.sheetsBefore} → {optimizer.multiSheet.sheetsAfter}
                </span>
                <span>
                  Sum Used Height Before → After: {optimizer.multiSheet.sumUsedHeightBefore.toFixed(1)} → {optimizer.multiSheet.sumUsedHeightAfter.toFixed(1)} mm
                </span>
                <span>
                  Height Saved: {optimizer.multiSheet.heightSavedMm.toFixed(1)} mm / {optimizer.multiSheet.heightSavedPercent.toFixed(1)}%
                </span>
                <span>Existing-Sheet Attempts: {optimizer.multiSheet.existingSheetAttempts}</span>
                <span>Successful Backfills: {optimizer.multiSheet.successfulBackfills}</span>
                <span>New Sheets Avoided: {optimizer.multiSheet.newSheetsAvoided}</span>
                <span>Relocation Pass: {optimizer.multiSheet.relocationPass}</span>
                <span>
                  BEST_EXISTING Stage: {optimizer.multiSheet.statesEvaluated} states · {optimizer.multiSheet.packEvaluations} packs
                </span>
              </div>
            );
          })()}

          {/* PHASE 2C dev diagnostics — which group wastes the most of its own box. */}
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs text-slate-600">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="py-1 pr-4 font-medium">Order/Resi</th>
                  <th className="py-1 pr-4 font-medium">Candidates</th>
                  <th className="py-1 pr-4 font-medium">Local (2C)</th>
                  <th className="py-1 pr-4 font-medium">Global (2D)</th>
                  <th className="py-1 pr-4 font-medium">Group W×H</th>
                  <th className="py-1 pr-4 font-medium">Item Area</th>
                  <th className="py-1 font-medium">Internal Util</th>
                </tr>
              </thead>
              <tbody>
                {v2Preview.groups.map((group, index) => (
                  <tr key={index} className="border-t border-slate-100">
                    <td className="py-1 pr-4">{group.label}</td>
                    <td className="py-1 pr-4">{group.candidateCount}</td>
                    <td className="py-1 pr-4">{group.localStrategy}</td>
                    <td className="py-1 pr-4">
                      {group.selectedStrategy}
                      {group.selectedStrategy !== group.localStrategy ? " *" : ""}
                    </td>
                    <td className="py-1 pr-4">
                      {group.width.toFixed(1)} × {group.height.toFixed(1)} mm
                    </td>
                    <td className="py-1 pr-4">{group.itemArea.toFixed(0)} mm²</td>
                    <td className="py-1">{group.internalUtilizationPercent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {v2Preview.benchmark && <SpacingBenchmarkPanel sheet={v2Preview} benchmark={v2Preview.benchmark} />}

          {v2Preview.slotReflow && <SlotReflowPanel diagnostics={v2Preview.slotReflow} />}

          <MultiSheetPreview
            items={v2Preview.items}
            groups={v2Preview.groups}
            sheets={v2Preview.sheets}
            slots={slotOverlaysOf(v2Preview.slotReflow)}
          />
        </div>
      )}

      {editingRow &&
        (() => {
          const template = templates.get(editingRow.templateId);
          if (!template) return null;
          return (
            <HoleOverrideModal
              template={template}
              name={editingRow.customText}
              initialOverride={editingRow.holeOverride}
              onSave={(override) => handleSaveHoleOverride(editingRow, override)}
              onClose={() => setEditingRow(null)}
            />
          );
        })()}

      {confirmDeleteGroup && (
        <ConfirmDialog
          title="Hapus Resi?"
          description={`Apakah Anda yakin ingin menghapus seluruh pesanan pada Resi ${confirmDeleteGroup.receiptCode}? (Terdapat ${confirmDeleteGroup.rows.length} item yang akan dihapus permanen).`}
          isConfirming={isDeletingReceipt}
          onConfirm={handleConfirmDeleteReceipt}
          onCancel={() => setConfirmDeleteGroup(null)}
        />
      )}
    </div>
  );
}
