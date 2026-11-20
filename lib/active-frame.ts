/**
 * Active Production Frame V1 — adaptive HEIGHT only. The single source of the
 * physical frame that the Staging preview, the print JPG and the laser DXF
 * all use.
 *
 * Runs on a FINAL layout (after nesting, compaction, validation and the
 * internal receipt labels). It never moves, scales or crops content: the
 * logical sheet stays 310 x 470 for the solver, the origin and every x/y stay
 * where they are, the top fiducials stay put. Only the frame's bottom edge
 * and the two bottom fiducials move up to the shortest height that still
 * holds every production output element: artwork / cut footprints and
 * placed internal receipt labels at least SHEET_MARGIN_MM above the bottom
 * edge (the production margin) and at least FIDUCIAL_CLEARANCE_MM from every
 * fiducial. The height is rounded up to whole mm; never more than the 470 mm
 * media (needing more is INVALID — the layout is never changed to make it
 * fit).
 *
 * The batch code printed on the JPG is NOT part of the frame: once the frame
 * is final, placeBatchLabel() looks for existing safe whitespace inside it;
 * with none, the code is simply not printed (NO_SAFE_POSITION) — the frame
 * never grows for it and the export stays valid.
 *
 * Legacy sheets keep the full 310 x 470 frame, exactly as before.
 */
import { FIDUCIAL_RADIUS_MM, SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { FIDUCIAL_CLEARANCE_MM, SHEET_MARGIN_MM } from "@/lib/nesting/grouped-nesting-config";
import { internalLabelsOf, LABEL_CLEARANCE_MM, labelTextWidth } from "@/lib/receipt-labels";
import { sheetModeOf } from "@/lib/staging-mode";

/** Batch-code label of the print JPG (lib/export-print-svg.ts): the legacy size first, then smaller readable sizes. */
export const SHEET_LABEL_FONT_SIZE_MM = 6;
export const SHEET_LABEL_BASELINE_FROM_BOTTOM_MM = 4;
export const BATCH_LABEL_FONT_SIZES_MM = [SHEET_LABEL_FONT_SIZE_MM, 4.5, 3] as const;
/** Text box model shared with the internal receipt labels: ascent 0.8 em, box height 1 em. */
const LABEL_ASCENT_EM = 0.8;

/** Active height resolution (mm). */
const HEIGHT_STEP_MM = 1;
const EPS = 1e-6;

export interface FrameFiducial {
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  x: number;
  y: number;
  r: number;
}

export interface ActiveProductionFrame {
  widthMm: number;
  heightMm: number;
  /** True for a Production sheet (adaptive height); false = legacy/mixed/empty: full media, unchanged behavior. */
  adaptive: boolean;
  fiducials: FrameFiducial[];
  /** Lowest point of any production content (artwork footprint or placed receipt label), sheet mm. */
  contentBottomMm: number;
  /** 470 - heightMm. */
  savedMm: number;
  /** Non-empty = the frame cannot hold this layout (export must be refused). */
  errors: string[];
}

type Rect = { x: number; y: number; w: number; h: number };
type FrameItem = { orderId: number; posX: number; posY: number; width: number; height: number; status: string; order: { receiptCode: string } | null };

export function frameFiducials(heightMm: number, widthMm = SHEET_WIDTH_MM): FrameFiducial[] {
  const r = FIDUCIAL_RADIUS_MM;
  return [
    { corner: "top-left", x: r, y: r, r },
    { corner: "top-right", x: widthMm - r, y: r, r },
    { corner: "bottom-left", x: r, y: heightMm - r, r },
    { corner: "bottom-right", x: widthMm - r, y: heightMm - r, r },
  ];
}

/** Clear distance from a rect to a fiducial circle's edge. */
export function rectToFiducial(rect: Rect, f: FrameFiducial): number {
  const dx = Math.max(rect.x - f.x, 0, f.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - f.y, 0, f.y - (rect.y + rect.h));
  return Math.hypot(dx, dy) - f.r;
}

/** Every production output element the frame must hold: artwork/cut footprints + placed internal receipt labels. */
export function productionContentRects(items: FrameItem[]): Rect[] {
  const rects: Rect[] = items.map((i) => ({ x: i.posX, y: i.posY, w: i.width, h: i.height }));
  for (const label of internalLabelsOf({ items }) ?? []) if (label.rect) rects.push(label.rect);
  return rects;
}

/** Violations of `content` against a frame of `heightMm` (empty = it fits). */
export function frameViolations(content: Rect[], heightMm: number, widthMm = SHEET_WIDTH_MM): string[] {
  const errors: string[] = [];
  const fiducials = frameFiducials(heightMm, widthMm);
  const outside = content.filter((r) => r.x < -EPS || r.y < -EPS || r.x + r.w > widthMm + EPS || r.y + r.h > heightMm - SHEET_MARGIN_MM + EPS);
  if (outside.length) errors.push(`${outside.length} elemen produksi melewati frame aktif ${widthMm}x${heightMm} mm (margin bawah ${SHEET_MARGIN_MM} mm)`);
  const nearFiducial = content.filter((r) => fiducials.some((f) => rectToFiducial(r, f) < FIDUCIAL_CLEARANCE_MM - EPS));
  if (nearFiducial.length) errors.push(`${nearFiducial.length} elemen produksi < ${FIDUCIAL_CLEARANCE_MM} mm dari marker kamera pada frame aktif`);
  for (const f of fiducials) {
    if (f.x - f.r < -EPS || f.y - f.r < -EPS || f.x + f.r > widthMm + EPS || f.y + f.r > heightMm + EPS) errors.push(`marker ${f.corner} di luar frame aktif`);
  }
  if (heightMm > SHEET_HEIGHT_MM + EPS) errors.push(`frame aktif ${heightMm} mm melebihi media ${SHEET_HEIGHT_MM} mm`);
  return errors;
}

/**
 * The frame for a staged/locked sheet. Deterministic: same items -> same
 * frame. Production sheets get the shortest valid whole-mm height (capped at
 * 470); legacy, mixed and empty sheets get the full media.
 */
export function activeProductionFrame(sheet: { items: FrameItem[] }): ActiveProductionFrame {
  const full = (contentBottomMm: number, errors: string[] = [], adaptive = false): ActiveProductionFrame => ({
    widthMm: SHEET_WIDTH_MM,
    heightMm: SHEET_HEIGHT_MM,
    adaptive,
    fiducials: frameFiducials(SHEET_HEIGHT_MM),
    contentBottomMm,
    savedMm: 0,
    errors,
  });
  if (sheet.items.length === 0 || sheetModeOf(sheet.items).mode !== "production") {
    return full(sheet.items.length ? Math.max(...sheet.items.map((i) => i.posY + i.height)) : 0);
  }

  const content = productionContentRects(sheet.items);
  const contentBottomMm = Math.max(...content.map((r) => r.y + r.h));
  // Lower bound from the bottom production margin, then the first whole mm that fits every rule (fiducial clearance).
  const lowerBound = contentBottomMm + SHEET_MARGIN_MM;
  let heightMm = Math.ceil(lowerBound / HEIGHT_STEP_MM - EPS) * HEIGHT_STEP_MM;
  while (heightMm < SHEET_HEIGHT_MM && frameViolations(content, heightMm).length > 0) heightMm += HEIGHT_STEP_MM;
  heightMm = Math.min(heightMm, SHEET_HEIGHT_MM);

  const errors = frameViolations(content, heightMm);
  if (errors.length > 0) return full(contentBottomMm, [`Frame produksi aktif tidak bisa memuat layout: ${errors.join("; ")}`], true);
  return {
    widthMm: SHEET_WIDTH_MM,
    heightMm,
    adaptive: true,
    fiducials: frameFiducials(heightMm),
    contentBottomMm,
    savedMm: SHEET_HEIGHT_MM - heightMm,
    errors: [],
  };
}

export type BatchLabelStatus = "PLACED_INTERNAL" | "NO_SAFE_POSITION";

export interface BatchLabelPlacement {
  status: BatchLabelStatus;
  text: string;
  /** Present when PLACED_INTERNAL: footprint in sheet mm, size, rotation and the SVG transform for `<text x=0 y=0>`. */
  rect?: Rect;
  fontSize?: number;
  rotation?: 0 | 90;
  transform?: string;
  textLength?: number;
  /** Why it could not be placed (NO_SAFE_POSITION). */
  reason?: string;
}

/**
 * Batch code on an adaptive Production frame — placed AFTER the frame is
 * final, only in whitespace that already exists inside it: clear of every
 * production content rect by LABEL_CLEARANCE_MM, of every fiducial by
 * FIDUCIAL_CLEARANCE_MM, and of the frame's cut border by PART_GAP (2 mm).
 * Never grows the frame or moves anything. Deterministic ranking: largest
 * size first, horizontal before vertical, then the lowest spot (bottom
 * whitespace), then closest to the horizontal center.
 */
export function placeBatchLabel(sheet: { items: FrameItem[] }, frame: ActiveProductionFrame, text: string): BatchLabelPlacement {
  const content = productionContentRects(sheet.items);
  const edge = FIDUCIAL_CLEARANCE_MM; // = PART_GAP: clearance to the frame's cut border
  const c = LABEL_CLEARANCE_MM;
  for (const fontSize of BATCH_LABEL_FONT_SIZES_MM) {
    for (const rotation of [0, 90] as const) {
      const along = labelTextWidth(text, fontSize);
      const across = fontSize;
      const [w, h] = rotation === 0 ? [along, across] : [across, along];
      const xs = new Set<number>([edge, frame.widthMm - edge - w, (frame.widthMm - w) / 2]);
      const ys = new Set<number>([edge, frame.heightMm - edge - h]);
      for (const r of content) {
        xs.add(r.x + r.w + c);
        xs.add(r.x - c - w);
        ys.add(r.y + r.h + c);
        ys.add(r.y - c - h);
      }
      let best: { x: number; y: number } | null = null;
      for (const y of [...ys].sort((a, b) => b - a)) {
        if (y < edge - EPS || y + h > frame.heightMm - edge + EPS) continue;
        for (const x of [...xs].sort((a, b) => Math.abs(a + w / 2 - frame.widthMm / 2) - Math.abs(b + w / 2 - frame.widthMm / 2) || a - b)) {
          if (x < edge - EPS || x + w > frame.widthMm - edge + EPS) continue;
          const rect = { x, y, w, h };
          if (content.some((r) => gap(rect, r) < c - EPS)) continue;
          if (frame.fiducials.some((f) => rectToFiducial(rect, f) < FIDUCIAL_CLEARANCE_MM - EPS)) continue;
          best = { x, y };
          break;
        }
        if (best) break;
      }
      if (best) {
        const rect = { x: best.x, y: best.y, w, h };
        const transform =
          rotation === 0
            ? `translate(${round(rect.x)}, ${round(rect.y + LABEL_ASCENT_EM * fontSize)})`
            : `translate(${round(rect.x + (1 - LABEL_ASCENT_EM) * fontSize)}, ${round(rect.y)}) rotate(90)`;
        return { status: "PLACED_INTERNAL", text, rect, fontSize, rotation, transform, textLength: round(along) };
      }
    }
  }
  return { status: "NO_SAFE_POSITION", text, reason: `tidak ada ruang kosong aman di dalam frame ${frame.widthMm}x${frame.heightMm} mm (min ${BATCH_LABEL_FONT_SIZES_MM[BATCH_LABEL_FONT_SIZES_MM.length - 1]} mm)` };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const gap = (a: Rect, b: Rect) =>
  Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
