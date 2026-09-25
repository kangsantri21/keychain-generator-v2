"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Destructive-action confirmation dialog — a hand-rolled equivalent of
 * shadcn/ui's AlertDialog (this project has no shadcn/ui installed; see
 * conversation notes), following the same shape: a title, a description,
 * and Cancel/Confirm actions, with the confirm action styled destructive
 * (red) by default. Used wherever a click must not delete/discard anything
 * immediately — e.g. "Hapus Resi" on the Order Queue table.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Hapus",
  cancelLabel = "Batal",
  isConfirming = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <div>
            <h2 id="confirm-dialog-title" className="text-sm font-semibold text-slate-800">
              {title}
            </h2>
            <p id="confirm-dialog-description" className="mt-1 text-sm text-slate-500">
              {description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isConfirming}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConfirming ? "Menghapus..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
