/**
 * Screen-only receipt overlay for the Staging canvas (never exported).
 * Production sheets: a dashed outline per receipt, PRODUCTION_GROUP_GAP_X / 2 outside
 * its box so side-by-side outlines touch. The external receipt code above
 * the outline is a debug aid only — in normal view the receipt is identified
 * by its internal label (lib/receipt-labels.ts), and a receipt without one
 * (NO_SAFE_INTERNAL_LABEL) gets no external fallback. Legacy sheets get no
 * overlay (they keep their per-item labels, unchanged).
 */
import { receiptBoxes } from "@/lib/production-gate";
import { PRODUCTION_GROUP_GAP_X_MM } from "@/lib/nesting/grouped-nesting-config";
import { compactRigidRects, PRODUCTION_COMPACTION_BOUNDS, type CompactionStatus } from "@/lib/nesting/group-compaction";

export const GROUP_OUTLINE_PAD_MM = PRODUCTION_GROUP_GAP_X_MM / 2;

export interface GroupOverlay {
  outlines: { orderId: number; x: number; y: number; w: number; h: number }[];
  /** External receipt codes above the outlines — only when `debug`. */
  externalLabels: { orderId: number; x: number; y: number; text: string }[];
}

export function productionGroupOverlay(
  sheet: {
    summary?: { profile: string } | null;
    items: { orderId: number; posX: number; posY: number; width: number; height: number; order: { receiptCode: string } | null }[];
  } | null,
  debug: boolean
): GroupOverlay {
  if (!sheet || sheet.summary?.profile !== "production") return { outlines: [], externalLabels: [] };
  const pad = GROUP_OUTLINE_PAD_MM;
  const boxes = receiptBoxes(sheet.items);
  const codeOf = new Map(sheet.items.map((item) => [item.orderId, item.order?.receiptCode ?? `#${item.orderId}`]));
  return {
    outlines: boxes.map(({ orderId, rect }) => ({ orderId, x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad })),
    externalLabels: debug ? boxes.map(({ orderId, rect }) => ({ orderId, x: rect.x - pad, y: rect.y - pad - 1, text: codeOf.get(orderId)! })) : [],
  };
}

/** Per-receipt compaction record from the last Production Nesting run (debug view only). */
export interface RememberedCompaction {
  orderId: number | null;
  dx: number;
  dy: number;
  status: CompactionStatus[];
}

const COMPACTION_KEY = "production-compaction-debug";

/** Keeps the last run's compaction moves for the Staging debug view (per browser; best effort). */
export function rememberCompaction(moves: RememberedCompaction[]) {
  try {
    sessionStorage.setItem(COMPACTION_KEY, JSON.stringify(moves));
  } catch {
    // Debug aid only.
  }
}

export function readRememberedCompaction(): RememberedCompaction[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(COMPACTION_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface CompactionTag {
  orderId: number;
  x: number;
  y: number;
  text: string;
  /** True when the receipt could still move left/up — the layout is not compacted (e.g. staged before compaction). */
  slack: boolean;
}

/**
 * Debug tags per receipt: what the last run did (COMPACTED_X/Y with the
 * distance, from `remembered`) or BLOCKED, plus what blocks it now on the
 * left / top ("tepi" = sheet frame). The current layout is re-checked with
 * the same compaction rule: any receipt that could still slide is flagged
 * "BISA DIRAPATKAN" instead — whitespace left by the packer never hides.
 */
export function compactionTags(
  sheet: { summary?: { profile: string } | null; items: { orderId: number; posX: number; posY: number; width: number; height: number }[] } | null,
  remembered: RememberedCompaction[]
): CompactionTag[] {
  if (!sheet || sheet.summary?.profile !== "production") return [];
  const boxes = receiptBoxes(sheet.items);
  const check = compactRigidRects(
    boxes.map((b) => ({ key: b.orderId, sheet: 0, x: b.rect.x, y: b.rect.y, w: b.rect.w, h: b.rect.h })),
    PRODUCTION_COMPACTION_BOUNDS
  );
  const byOrder = new Map(remembered.map((m) => [m.orderId, m]));
  const who = (by: number | "edge" | "fiducial") => (by === "edge" ? "tepi" : by === "fiducial" ? "marker" : `#${by}`);
  return boxes.map((b, i) => {
    const now = check.moves[i];
    const slack = now.status[0] !== "BLOCKED";
    const last = byOrder.get(b.orderId);
    const done = last && last.status[0] !== "BLOCKED"
      ? last.status.map((s) => (s === "COMPACTED_X" ? `COMPACTED_X ←${(-last.dx).toFixed(1)}` : `COMPACTED_Y ↑${(-last.dy).toFixed(1)}`)).join(" ")
      : "BLOCKED";
    const text = slack
      ? `BISA DIRAPATKAN ←${(-now.dx).toFixed(1)} ↑${(-now.dy).toFixed(1)}`
      : `${done} · ◀${who(now.blockedLeftBy)} ▲${who(now.blockedUpBy)}`;
    return { orderId: b.orderId, x: b.rect.x + 0.5, y: b.rect.y + b.rect.h - 0.8, text, slack };
  });
}
