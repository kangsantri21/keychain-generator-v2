/**
 * Client-side snapshot of the active Staging Area (GET /api/staging) —
 * cache-first rendering + background revalidation, display only.
 *
 * GET /api/staging re-renders every item's artwork server-side, so a full
 * load takes seconds and tens of MB. The last good response is kept here, in
 * module memory: it survives client-side navigation (Sidebar uses next/link)
 * and is dropped on a full page reload. sessionStorage is not an option — the
 * payload is far above its ~5 MB quota.
 *
 * Never a source of truth for production actions: the batch lock posts the
 * sheet and the server re-reads the DB rows and rejects any mismatch
 * (app/api/print-batches/route.ts), and export reads the locked batch from
 * the DB. Every client mutation that changes staging calls
 * invalidateStagingCache(); a generation counter keeps a fetch started before
 * an invalidation from writing its (stale) result back.
 */
import type { StagingSheet } from "@/lib/staging-types";

export interface StagingSnapshot {
  sheets: StagingSheet[];
  /** SHA-256 of the raw response body — equal signature = identical data. */
  signature: string;
  /** Sheet the operator last looked at, restored on revisit. */
  activeSheetId: number | null;
}

let snapshot: StagingSnapshot | null = null;
let generation = 0;

export function readStagingCache(): StagingSnapshot | null {
  return snapshot;
}

/** Token to pass to writeStagingCache — take it before starting the fetch. */
export function stagingCacheGeneration(): number {
  return generation;
}

/** Stores a fetched snapshot unless the cache was invalidated since `fetchGeneration` was taken. */
export function writeStagingCache(fresh: { sheets: StagingSheet[]; signature: string }, fetchGeneration: number): boolean {
  if (fetchGeneration !== generation) return false;
  const activeSheetId = snapshot?.activeSheetId ?? null;
  snapshot = { sheets: fresh.sheets, signature: fresh.signature, activeSheetId };
  return true;
}

export function rememberActiveSheet(sheetId: number | null) {
  if (snapshot) snapshot = { ...snapshot, activeSheetId: sheetId };
}

/** Call after any mutation that changes staged layout (nest, append, delete/complete sheet, lock, order delete). */
export function invalidateStagingCache() {
  snapshot = null;
  generation++;
}

export async function signatureOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Fetches the active staging sheets from the server (the only source of the data) with a content signature. */
export async function fetchStagingSnapshot(
  fetchImpl: typeof fetch = fetch
): Promise<{ sheets: StagingSheet[]; signature: string }> {
  const res = await fetchImpl("/api/staging", { cache: "no-store" });
  const text = await res.text();
  let data: { sheets?: StagingSheet[]; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Gagal memuat staging area");
  }
  if (!res.ok || !Array.isArray(data.sheets)) throw new Error(data.error ?? "Gagal memuat staging area");
  return { sheets: data.sheets, signature: await signatureOf(text) };
}

/** Whether revalidated data must replace what is on screen (false = identical, keep the current render untouched). */
export function isStagingChanged(current: Pick<StagingSnapshot, "signature"> | null, fresh: { signature: string }): boolean {
  return current?.signature !== fresh.signature;
}
