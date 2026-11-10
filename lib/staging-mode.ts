/**
 * Explicit nesting-mode identity of staged units — no schema change.
 *
 * `staging_items.status` (existing free-text column) carries the mode:
 *   "staged"            — staged by Legacy Flat (and the legacy append), unchanged
 *   "staged-production" — staged by the older box packer (Production Nesting V3)
 *   "staged-shape"      — staged by shape-block nesting (one framed receipt, cut-line gaps)
 *   "completed"         — sheet marked done (history; mode no longer recorded)
 * Every reader that only distinguishes "completed" from "not completed"
 * (GET /api/staging, the append/complete/lock routes) keeps working as is.
 * The same status travels into a locked batch's layoutData, so archived
 * production batches stay identifiable too.
 *
 * Geometry (lib/production-gate.ts classifySheetProfile) is only the
 * compatibility fallback for rows without an explicit marker (completed
 * history).
 */
import { classifySheetProfile, type LayoutProfile } from "@/lib/production-gate";

export const STAGED_LEGACY = "staged";
export const STAGED_PRODUCTION = "staged-production";
export const STAGED_SHAPE = "staged-shape";
export const STAGING_COMPLETED = "completed";

export function isProductionStatus(status: string): boolean {
  return status === STAGED_PRODUCTION || status === STAGED_SHAPE;
}

export type SheetMode = LayoutProfile | "mixed";

export interface SheetModeInfo {
  mode: SheetMode;
  /** "explicit" = from the status marker; "geometry" = fallback inference (history only). */
  source: "explicit" | "geometry";
}

export function sheetModeOf(items: { status: string; posX: number; posY: number }[]): SheetModeInfo {
  const active = items.filter((item) => item.status !== STAGING_COMPLETED);
  if (active.length === 0) return { mode: classifySheetProfile(items), source: "geometry" };
  const production = active.filter((item) => isProductionStatus(item.status)).length;
  if (production === active.length) return { mode: "production", source: "explicit" };
  if (production === 0) return { mode: "legacy", source: "explicit" };
  return { mode: "mixed", source: "explicit" };
}

/** Why units must not be appended with the legacy append packer, or null when it is allowed (legacy sheets only). */
export function appendBlockReason(items: { status: string; posX: number; posY: number }[]): string | null {
  const { mode } = sheetModeOf(items);
  if (mode === "production") {
    return "Lembar Kerja ini hasil Production Nesting — tidak bisa ditambah dengan append. Bongkar lembar kerja ini, lalu kirim ulang semua pesanannya bersama pesanan baru dengan Production Nesting dari Antrean Pesanan.";
  }
  if (mode === "mixed") return "Lembar Kerja ini berisi campuran mode nesting — tidak bisa ditambah. Bongkar lalu susun ulang dengan Production Nesting.";
  return null;
}

/** Error to report for a sheet whose units mix modes (never produced by the app itself). */
export const MIXED_MODE_ERROR = "Lembar kerja berisi campuran item Production Nesting dan Legacy — tidak boleh dikunci. Bongkar lalu susun ulang dengan Production Nesting.";
