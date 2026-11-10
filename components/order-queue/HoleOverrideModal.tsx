"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import * as opentype from "opentype.js";
import { X } from "lucide-react";
import { renderColoredGlyphsAtHeight, type ColoredTextRender } from "@/lib/font-preview";
import { computeProductionOutline } from "@/lib/clipper-outline";
import {
  PX_PER_MM,
  RING_HOLE_DIAMETER_PX,
  OUTLINE_GROWTH_MM,
  toGlyphShapes,
  computeRingHoleAnchor,
  weldRingHoleWasher,
} from "@/lib/text-ring-hole-preview";
import type { Template } from "@/lib/db/schema";
import { DEFAULT_TEXT_TARGET_HEIGHT_MM, MAX_LAYOUT_OFFSET_MM } from "@/lib/keychain-geometry";
import { OffsetSlider } from "@/components/master-template/OffsetSlider";

const CANVAS_MARGIN = 24;
const OUTLINE_DEBOUNCE_MS = 300;
const TEXT_RAW_HEIGHT_PX = Math.max((DEFAULT_TEXT_TARGET_HEIGHT_MM - OUTLINE_GROWTH_MM) * PX_PER_MM, 1);

/**
 * Per-name manual ring-hole nudge — "Edit Lubang" on an Order Queue row. Only
 * offered for a text-only ("Custom Nama") template's names, since that's the
 * one case lib/keychain-render.ts's automatic dynamic-anchor pipeline (see
 * lib/text-ring-hole-preview.ts's own doc comment) can still occasionally
 * need a manual nudge for — e.g. a font whose particular glyph shapes leave
 * even the contour-anchored placement somewhere visually awkward.
 *
 * The slider values here are ADDITIVE on top of that automatic placement
 * (mirrors lib/keychain-render.ts's `holeOverride?.x/y` handling exactly),
 * not a replacement for it — 0/0 means "use the fully automatic position".
 */
export function HoleOverrideModal({
  template,
  name,
  initialOverride,
  onSave,
  onClose,
}: {
  template: Template;
  name: string;
  initialOverride: { x: number; y: number } | null;
  onSave: (override: { x: number; y: number } | null) => Promise<void>;
  onClose: () => void;
}) {
  const [parsedFont, setParsedFont] = useState<opentype.Font | null>(null);
  const [overrideX, setOverrideX] = useState(initialOverride?.x ?? 0);
  const [overrideY, setOverrideY] = useState(initialOverride?.y ?? 0);
  const [finalOutlinePath, setFinalOutlinePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(template.filePath);
        const arrayBuffer = await res.arrayBuffer();
        if (!cancelled) setParsedFont(opentype.parse(arrayBuffer));
      } catch {
        if (!cancelled) toast.error("Gagal memuat font template untuk pratinjau");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [template.filePath]);

  const textPreview: ColoredTextRender | null = useMemo(() => {
    if (!parsedFont) return null;
    try {
      return renderColoredGlyphsAtHeight(parsedFont, name, TEXT_RAW_HEIGHT_PX, template.colors);
    } catch {
      return null;
    }
  }, [parsedFont, name, template.colors]);

  const textTranslateX = textPreview ? CANVAS_MARGIN - textPreview.bbox.x1 : CANVAS_MARGIN;
  const textTranslateY = textPreview ? CANVAS_MARGIN - textPreview.bbox.y1 : CANVAS_MARGIN;
  const textWidth = textPreview ? Math.max(textPreview.bbox.x2 - textPreview.bbox.x1, 1) : 120;
  const textHeight = textPreview ? Math.max(textPreview.bbox.y2 - textPreview.bbox.y1, 1) : TEXT_RAW_HEIGHT_PX;
  const canvasWidth = textWidth + CANVAS_MARGIN * 2;
  const canvasHeight = textHeight + CANVAS_MARGIN * 2;

  const glyphShapes = useMemo(
    () => toGlyphShapes(textPreview, textTranslateX, textTranslateY),
    [textPreview, textTranslateX, textTranslateY]
  );
  const textContour = useMemo(
    () => (glyphShapes.length > 0 ? computeProductionOutline(glyphShapes, { unitPerMm: PX_PER_MM }) : null),
    [glyphShapes]
  );
  const anchor = useMemo(
    () => computeRingHoleAnchor(glyphShapes, textContour, CANVAS_MARGIN + TEXT_RAW_HEIGHT_PX / 2),
    [glyphShapes, textContour]
  );

  // Same additive formula as lib/keychain-render.ts: automatic (minX, midY)
  // position, template "Jarak Lubang", this template's per-letter A-Z
  // correction for THIS name's own first letter (Template.letterOffsets —
  // see FontTemplateForm.tsx's "Kustomisasi Lubang A-Z"), then this name's
  // own manual nudge on top — 0/0 reproduces the fully automatic placement
  // (including any A-Z correction already baked in) exactly.
  const letterOffset = template.letterOffsets?.[name.trim().charAt(0).toUpperCase()];
  const holeCenter = {
    x: anchor.minX - template.holeOffsetX * PX_PER_MM + (letterOffset?.x ?? 0) * PX_PER_MM + overrideX * PX_PER_MM,
    y: anchor.midY + (letterOffset?.y ?? 0) * PX_PER_MM + overrideY * PX_PER_MM,
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFinalOutlinePath(weldRingHoleWasher(textContour, holeCenter));
    }, OUTLINE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textContour, holeCenter.x, holeCenter.y]);

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave({ x: overrideX, y: overrideY });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReset() {
    setIsSaving(true);
    try {
      await onSave(null);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Edit Lubang Ring — &quot;{name}&quot;</h2>
            <p className="mt-1 text-xs text-slate-400">
              Nudge manual di atas posisi otomatis, khusus untuk nama ini saja. 0.0/0.0 = pakai posisi
              otomatis sepenuhnya.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
          <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} className="h-40 w-full max-w-full">
            {textPreview && textPreview.segments.length > 0 ? (
              <g transform={`translate(${textTranslateX}, ${textTranslateY})`}>
                {textPreview.segments.map((segment, index) => (
                  <path key={index} d={segment.d} fill={segment.color} />
                ))}
              </g>
            ) : (
              <text x={CANVAS_MARGIN} y={canvasHeight / 2} dominantBaseline="middle" fontSize={14} fill="#94a3b8">
                Memuat pratinjau...
              </text>
            )}

            {finalOutlinePath && <path d={finalOutlinePath} stroke="red" strokeWidth={1.5} fill="none" />}

            <circle cx={holeCenter.x} cy={holeCenter.y} r={RING_HOLE_DIAMETER_PX / 2} stroke="red" strokeWidth={1} fill="none" />
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <OffsetSlider
            label="Nudge X"
            value={overrideX}
            onChange={setOverrideX}
            hint="Tambahan geser kiri/kanan untuk nama ini"
            min={-MAX_LAYOUT_OFFSET_MM}
            max={MAX_LAYOUT_OFFSET_MM}
          />
          <OffsetSlider
            label="Nudge Y"
            value={overrideY}
            onChange={setOverrideY}
            hint="Tambahan geser atas/bawah untuk nama ini"
            min={-MAX_LAYOUT_OFFSET_MM}
            max={MAX_LAYOUT_OFFSET_MM}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reset ke Otomatis
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
