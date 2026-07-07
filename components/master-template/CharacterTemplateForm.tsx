"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as opentype from "opentype.js";
import { renderColoredGlyphs, type ColoredTextRender } from "@/lib/font-preview";
import { computeLaserOutline, translatePathData } from "@/lib/laser-outline";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import type { Template } from "@/lib/db/schema";
import { ColorPaletteEditor, DEFAULT_COLOR, MAX_COLORS, MIN_COLORS } from "./ColorPaletteEditor";

const PREVIEW_FONT_SIZE = 56;

// Live-preview canvas geometry (px), approximating the laser-cut scale.
const CHAR_BOX_SIZE = 96;
const TEXT_GAP = 18; // ~5mm
const CANVAS_MARGIN = 24;
const RING_HOLE_OFFSET = 11; // ~3mm from the character box's top-left corner
const RING_HOLE_DIAMETER = 7; // ~0.19mm spec, scaled up for preview visibility
const OUTLINE_DEBOUNCE_MS = 300;

/**
 * The parent keys this component by `editingTemplate?.id ?? "create"`, so a
 * switch between templates (or between edit/create) remounts it — that's
 * what resets these fields, rather than an effect syncing state from props.
 */
export function CharacterTemplateForm({
  editingTemplate,
  onCancelEdit,
}: {
  editingTemplate: Template | null;
  onCancelEdit: () => void;
}) {
  const [code, setCode] = useState(editingTemplate?.code ?? "");
  const [defaultText, setDefaultText] = useState(editingTemplate?.defaultText ?? "Nama");
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [fontFile, setFontFile] = useState<File | null>(null);
  const [colors, setColors] = useState<string[]>(
    editingTemplate && editingTemplate.colors.length > 0 ? editingTemplate.colors : [DEFAULT_COLOR]
  );
  const [characterPreviewUrl, setCharacterPreviewUrl] = useState<string | null>(
    editingTemplate?.characterImagePath ?? null
  );
  const [parsedFont, setParsedFont] = useState<opentype.Font | null>(null);
  const [outlinePath, setOutlinePath] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const addTemplate = useTemplateStore((state) => state.addTemplate);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);

  const isEditing = Boolean(editingTemplate);

  useEffect(() => {
    return () => {
      if (characterPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(characterPreviewUrl);
    };
  }, [characterPreviewUrl]);

  // Fetch the existing font once (for an accurate live preview) when opened in edit mode.
  useEffect(() => {
    if (!editingTemplate) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(editingTemplate.filePath);
        const arrayBuffer = await res.arrayBuffer();
        if (!cancelled) setParsedFont(opentype.parse(arrayBuffer));
      } catch {
        if (!cancelled) toast.error("Gagal memuat font template untuk pratinjau");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editingTemplate]);

  function handleCharacterFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setCharacterFile(selected);
    if (selected) {
      setCharacterPreviewUrl(URL.createObjectURL(selected));
    } else {
      setCharacterPreviewUrl(editingTemplate?.characterImagePath ?? null);
    }
  }

  async function handleFontFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFontFile(selected);

    if (!selected) {
      setParsedFont(null);
      return;
    }

    try {
      const arrayBuffer = await selected.arrayBuffer();
      setParsedFont(opentype.parse(arrayBuffer));
    } catch {
      setParsedFont(null);
      toast.error("File font tidak dapat dibaca");
    }
  }

  const textPreview: ColoredTextRender | null = useMemo(() => {
    if (!parsedFont || !defaultText.trim()) return null;
    try {
      return renderColoredGlyphs(parsedFont, defaultText.trim(), PREVIEW_FONT_SIZE, colors);
    } catch {
      return null;
    }
  }, [parsedFont, defaultText, colors]);

  // Text starts right after the character box, leaving only a small (~5mm) gap.
  const textOriginX = CANVAS_MARGIN + CHAR_BOX_SIZE + TEXT_GAP;
  const textOriginY = CANVAS_MARGIN;

  const textTranslateX = textPreview ? textOriginX - textPreview.bbox.x1 : textOriginX;
  const textTranslateY = textPreview
    ? textOriginY + CHAR_BOX_SIZE / 2 - (textPreview.bbox.y1 + textPreview.bbox.y2) / 2
    : textOriginY;
  const textWidth = textPreview ? Math.max(textPreview.bbox.x2 - textPreview.bbox.x1, 1) : 80;

  const canvasWidth = textOriginX + textWidth + CANVAS_MARGIN;
  const canvasHeight = CHAR_BOX_SIZE + CANVAS_MARGIN * 2;

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!characterPreviewUrl || !textPreview || textPreview.segments.length === 0) {
        setOutlinePath(null);
        return;
      }

      const charBoxD = `M ${CANVAS_MARGIN} ${CANVAS_MARGIN} L ${CANVAS_MARGIN + CHAR_BOX_SIZE} ${CANVAS_MARGIN} L ${CANVAS_MARGIN + CHAR_BOX_SIZE} ${CANVAS_MARGIN + CHAR_BOX_SIZE} L ${CANVAS_MARGIN} ${CANVAS_MARGIN + CHAR_BOX_SIZE} Z`;
      const glyphShapes = textPreview.segments.map((segment) =>
        translatePathData(segment.d, textTranslateX, textTranslateY)
      );
      setOutlinePath(computeLaserOutline([charBoxD, ...glyphShapes]));
    }, OUTLINE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [characterPreviewUrl, textPreview, textTranslateX, textTranslateY]);

  function resetForm() {
    setCode("");
    setDefaultText("Nama");
    setCharacterFile(null);
    setCharacterPreviewUrl(null);
    setFontFile(null);
    setParsedFont(null);
    setOutlinePath(null);
    setColors([DEFAULT_COLOR]);
    if (characterInputRef.current) characterInputRef.current.value = "";
    if (fontInputRef.current) fontInputRef.current.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!code.trim()) {
      toast.error("Kode template harus diisi");
      return;
    }
    if (!isEditing && !characterFile) {
      toast.error("Pilih file karakter terlebih dahulu");
      return;
    }
    if (!isEditing && !fontFile) {
      toast.error("Pilih file font terlebih dahulu");
      return;
    }
    if (colors.length < MIN_COLORS || colors.length > MAX_COLORS) {
      toast.error(`Jumlah warna harus antara ${MIN_COLORS} - ${MAX_COLORS}`);
      return;
    }

    const formData = new FormData();
    formData.set("code", code.trim());
    formData.set("category", "character");
    if (fontFile) formData.set("file", fontFile);
    if (characterFile) formData.set("characterImage", characterFile);
    formData.set("colors", JSON.stringify(colors));
    formData.set("defaultText", defaultText.trim() || "Nama");

    setIsSubmitting(true);
    try {
      const url = editingTemplate ? `/api/templates/${editingTemplate.id}` : "/api/templates";
      const method = editingTemplate ? "PUT" : "POST";
      const res = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan template");

      if (editingTemplate) {
        updateTemplate(data.template as Template);
        toast.success("Template karakter berhasil diperbarui");
        onCancelEdit();
      } else {
        addTemplate(data.template as Template);
        toast.success("Template karakter berhasil disimpan");
        resetForm();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan template");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Kode Template
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="mis. CHAR-001"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Teks Default
          <input
            type="text"
            value={defaultText}
            onChange={(event) => setDefaultText(event.target.value)}
            placeholder="Nama"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          File Karakter (SVG/PNG)
          <input
            ref={characterInputRef}
            type="file"
            accept=".svg,.png,image/svg+xml,image/png"
            onChange={handleCharacterFileChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
          {isEditing && (
            <span className="text-xs text-slate-400">
              (Biarkan kosong jika tidak ingin mengubah file)
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          File Font (TTF/OTF)
          <input
            ref={fontInputRef}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            onChange={handleFontFileChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
          {isEditing && (
            <span className="text-xs text-slate-400">
              (Biarkan kosong jika tidak ingin mengubah file)
            </span>
          )}
        </label>

        <div className="sm:col-span-2">
          <ColorPaletteEditor colors={colors} onChange={setColors} />
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? isEditing
                ? "Memperbarui..."
                : "Menyimpan..."
              : isEditing
                ? "Update Template"
                : "Simpan Template Karakter"}
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="w-fit rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Batal Edit
            </button>
          )}
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-slate-700">Live Preview</span>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
          <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} className="h-40 w-full max-w-full">
            {characterPreviewUrl ? (
              <image
                href={characterPreviewUrl}
                x={CANVAS_MARGIN}
                y={CANVAS_MARGIN}
                width={CHAR_BOX_SIZE}
                height={CHAR_BOX_SIZE}
                preserveAspectRatio="xMidYMid meet"
              />
            ) : (
              <rect
                x={CANVAS_MARGIN}
                y={CANVAS_MARGIN}
                width={CHAR_BOX_SIZE}
                height={CHAR_BOX_SIZE}
                rx={12}
                fill="#f8fafc"
                stroke="#cbd5e1"
                strokeDasharray="4 4"
              />
            )}

            <circle
              cx={CANVAS_MARGIN + RING_HOLE_OFFSET}
              cy={CANVAS_MARGIN + RING_HOLE_OFFSET}
              r={RING_HOLE_DIAMETER / 2}
              stroke="red"
              strokeWidth={1}
              fill="none"
            />

            {textPreview && textPreview.segments.length > 0 ? (
              <g transform={`translate(${textTranslateX}, ${textTranslateY})`}>
                {textPreview.segments.map((segment, index) => (
                  <path key={index} d={segment.d} fill={segment.color} />
                ))}
              </g>
            ) : (
              <text
                x={textOriginX}
                y={CANVAS_MARGIN + CHAR_BOX_SIZE / 2}
                dominantBaseline="middle"
                fontSize={14}
                fill="#94a3b8"
              >
                Unggah font untuk pratinjau teks
              </text>
            )}

            {outlinePath && (
              <path d={outlinePath} stroke="red" strokeWidth={1.5} fill="none" />
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
