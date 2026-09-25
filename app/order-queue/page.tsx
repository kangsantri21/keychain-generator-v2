"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Search, CircleDot, Trash2 } from "lucide-react";
import type { OrderItemVariant, OrderQueueEntry, OrderStatus, HoleOverride } from "@/lib/store/useTemplateStore";
import type { StagingSheet } from "@/lib/staging-types";
import type { Template } from "@/lib/db/schema";
import { HoleOverrideModal } from "@/components/order-queue/HoleOverrideModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

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
    setTargetSheetId((current) => {
      if (current !== "" && sheets.some((sheet) => sheet.sheetId === current)) return current;
      return sheets[0]?.sheetId ?? "";
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

    setSending(true);
    try {
      const res = await fetch("/api/staging/nest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: selectedRows.map((row) => row.rowId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengirim ke mesin nesting");

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
      toast.error("Belum ada Lembar Kerja aktif — jalankan Nesting terlebih dahulu untuk membuatnya");
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
            <select
              value={targetSheetId}
              onChange={(event) => setTargetSheetId(event.target.value ? Number(event.target.value) : "")}
              disabled={activeSheets.length === 0}
              className="rounded-md border border-slate-300 px-2.5 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeSheets.length === 0 ? (
                <option value="">Belum ada Lembar Kerja aktif</option>
              ) : (
                activeSheets.map((sheet) => (
                  <option key={sheet.sheetId} value={sheet.sheetId}>
                    Lembar Kerja #{sheet.sheetId} ({sheet.items.length} item)
                  </option>
                ))
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
              {sending ? "Memproses..." : "Kirim ke Mesin Nesting"}
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
                              className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                            >
                              {STATUS_LABELS[row.status]}
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
