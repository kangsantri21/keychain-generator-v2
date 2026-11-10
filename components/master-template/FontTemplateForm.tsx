"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as opentype from "opentype.js";
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
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import type { Template, LetterOffset } from "@/lib/db/schema";
import { DEFAULT_TEXT_TARGET_HEIGHT_MM, MAX_LAYOUT_OFFSET_MM } from "@/lib/keychain-geometry";
import { ColorPaletteEditor, DEFAULT_COLOR, MAX_COLORS, MIN_COLORS } from "./ColorPaletteEditor";
import { OffsetSlider } from "./OffsetSlider";

// Live-preview canvas geometry (px) — same reference scale as
// CharacterTemplateForm's own preview, so the two forms' sliders feel
// consistent even though a text-only ("Custom Nama") template has no
// character node to size against.
const CANVAS_MARGIN = 24;
const OUTLINE_DEBOUNCE_MS = 300;
// See CharacterTemplateForm's own SLIDER_DEBOUNCE_MS doc comment — same
// instant-slider/debounced-outline-recompute split.
const SLIDER_DEBOUNCE_MS = 400;
// Font-category templates always render at the production default
// (template.textTargetHeight has no UI here, same as production's
// app/api/templates/route.ts which never lets a "font" category row
// customize it) — the preview mirrors that fixed value exactly.
const TEXT_RAW_HEIGHT_PX = Math.max((DEFAULT_TEXT_TARGET_HEIGHT_MM - OUTLINE_GROWTH_MM) * PX_PER_MM, 1);
// Text-only templates always render "Nama" as their sample (app/api/
// templates/route.ts hardcodes defaultText to "Nama" for category "font").
const SAMPLE_TEXT = "Nama";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * The parent keys this component by `editingTemplate?.id ?? "create"`, so a
 * switch between templates (or between edit/create) remounts it — that's
 * what resets these fields, rather than an effect syncing state from props.
 */
export function FontTemplateForm({
  editingTemplate,
  onCancelEdit,
}: {
  editingTemplate: Template | null;
  onCancelEdit: () => void;
}) {
  const [code, setCode] = useState(editingTemplate?.code ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [thumbnailImage, setThumbnailImage] = useState<File | null>(null);
  const [colors, setColors] = useState<string[]>(
    editingTemplate && editingTemplate.colors.length > 0 ? editingTemplate.colors : [DEFAULT_COLOR]
  );
  const [parsedFont, setParsedFont] = useState<opentype.Font | null>(null);
  const [finalOutlinePath, setFinalOutlinePath] = useState<string | null>(null);
  // "Jarak Lubang (mm)" — the ONE surviving manual control for this template
  // type's ring hole (lib/keychain-render.ts's owner-specified pipeline,
  // 2026-09-25): everything else (which letter's contour to anchor against,
  // the vertical position) is now fully automatic, computed from the actual
  // dilated text contour rather than a fixed corner offset — see that
  // pipeline's own doc comment for why a manual X/Y pair per template could
  // never track a name's actual first-letter shape.
  const [holeOffsetX, setHoleOffsetX] = useState(editingTemplate?.holeOffsetX ?? 0);
  const debouncedHoleOffsetX = useDebounce(holeOffsetX, SLIDER_DEBOUNCE_MS);
  // A-Z Letter Mapping (owner spec, 2026-09-25): a per-letter correction on
  // top of the automatic (minX, midY) placement above, keyed by the
  // rendered name's own first letter — for bubble/script fonts whose
  // glyph bounding boxes for letters like "J"/"A"/"V" aren't centered
  // around that letterform's actual visual weight, so the geometric midY
  // alone still lands low. `selectedLetter` only drives which letter this
  // editor (and the shared Live Preview below) is currently showing/tuning
  // — it isn't itself submitted.
  const [letterOffsets, setLetterOffsets] = useState<Record<string, LetterOffset>>(
    editingTemplate?.letterOffsets ?? {}
  );
  const [selectedLetter, setSelectedLetter] = useState("N");
  const debouncedLetterOffsets = useDebounce(letterOffsets, SLIDER_DEBOUNCE_MS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const addTemplate = useTemplateStore((state) => state.addTemplate);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);

  const isEditing = Boolean(editingTemplate);

  // Fetch the existing font once, for an accurate live preview when opened
  // in edit mode (mirrors CharacterTemplateForm's identical effect).
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

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);

    if (!selected) {
      setParsedFont(null);
      return;
    }

    selected
      .arrayBuffer()
      .then((buffer) => setParsedFont(opentype.parse(buffer)))
      .catch(() => {
        setParsedFont(null);
        toast.error("File font tidak dapat dibaca");
      });
  }

  function handleThumbnailChange(event: React.ChangeEvent<HTMLInputElement>) {
    setThumbnailImage(event.target.files?.[0] ?? null);
  }

  function resetForm() {
    setCode("");
    setFile(null);
    setThumbnailImage(null);
    setColors([DEFAULT_COLOR]);
    setParsedFont(null);
    setFinalOutlinePath(null);
    setHoleOffsetX(0);
    setLetterOffsets({});
    setSelectedLetter("N");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
  }

  // Swaps just the sample text's first letter for whichever one is being
  // tuned below, so the SAME preview canvas serves both "Jarak Lubang" and
  // "Kustomisasi Lubang A-Z" — e.g. selecting "J" previews "Jama" instead of
  // "Nama", so the admin sees that specific letter's own contour/hole
  // behavior (which is exactly what needs tuning) without a second canvas.
  const previewText = selectedLetter + SAMPLE_TEXT.slice(1);

  const textPreview: ColoredTextRender | null = useMemo(() => {
    if (!parsedFont) return null;
    try {
      return renderColoredGlyphsAtHeight(parsedFont, previewText, TEXT_RAW_HEIGHT_PX, colors);
    } catch {
      return null;
    }
  }, [parsedFont, previewText, colors]);

  const textTranslateX = textPreview ? CANVAS_MARGIN - textPreview.bbox.x1 : CANVAS_MARGIN;
  const textTranslateY = textPreview ? CANVAS_MARGIN - textPreview.bbox.y1 : CANVAS_MARGIN;
  const textWidth = textPreview ? Math.max(textPreview.bbox.x2 - textPreview.bbox.x1, 1) : 120;
  const textHeight = textPreview ? Math.max(textPreview.bbox.y2 - textPreview.bbox.y1, 1) : TEXT_RAW_HEIGHT_PX;

  const canvasWidth = textWidth + CANVAS_MARGIN * 2;
  const canvasHeight = textHeight + CANVAS_MARGIN * 2;

  // Mirrors lib/keychain-render.ts's text-only ring-hole pipeline exactly
  // (lib/text-ring-hole-preview.ts's own doc comment has the full 5-step
  // breakdown): glyphs -> path, contour = gap close then the 0.25 mm
  // offset (NOT the raw glyph bbox), bounding box read FROM that contour, X
  // anchored to the contour's own leftmost point minus "Jarak Lubang", Y
  // following the vertical midpoint of the FIRST LETTER's own contour.
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

  const currentLetterOffset = debouncedLetterOffsets[selectedLetter];
  const holeCenter = {
    x: anchor.minX - debouncedHoleOffsetX * PX_PER_MM + (currentLetterOffset?.x ?? 0) * PX_PER_MM,
    y: anchor.midY + (currentLetterOffset?.y ?? 0) * PX_PER_MM,
  };

  // Step 5 (Boolean Union), debounced separately from the (already
  // debounced) slider value — this is the expensive Clipper pass, matching
  // CharacterTemplateForm's own two-stage slider/outline debounce split.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setFinalOutlinePath(weldRingHoleWasher(textContour, holeCenter));
    }, OUTLINE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
    // Depends on holeCenter's own x/y (primitives) rather than the object
    // itself, which is a fresh literal every render and would defeat the
    // debounce by re-running this effect every render regardless of whether
    // the actual coordinates changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textContour, holeCenter.x, holeCenter.y]);

  function handleLetterOffsetChange(axis: "x" | "y", value: number) {
    setLetterOffsets((prev) => {
      const next = { ...prev };
      const updated: LetterOffset = { ...next[selectedLetter], [axis]: value };
      // Drop the entry entirely once both axes are back to 0 — keeps the
      // saved JSON containing only letters the admin actually tuned.
      if ((updated.x ?? 0) === 0 && (updated.y ?? 0) === 0) {
        delete next[selectedLetter];
      } else {
        next[selectedLetter] = updated;
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!code.trim()) {
      toast.error("Kode template harus diisi");
      return;
    }
    if (!isEditing && !file) {
      toast.error("Pilih file font terlebih dahulu");
      return;
    }
    if (!isEditing && !thumbnailImage) {
      toast.error("Pilih gambar preview/thumbnail terlebih dahulu");
      return;
    }
    if (colors.length < MIN_COLORS || colors.length > MAX_COLORS) {
      toast.error(`Jumlah warna harus antara ${MIN_COLORS} - ${MAX_COLORS}`);
      return;
    }

    const formData = new FormData();
    formData.set("code", code.trim());
    formData.set("category", "font");
    if (file) formData.set("file", file);
    if (thumbnailImage) formData.set("thumbnailImage", thumbnailImage);
    formData.set("colors", JSON.stringify(colors));
    formData.set("holeOffsetX", String(holeOffsetX));
    // Y is fully automatic now (no manual axis for this template type) —
    // explicitly zeroed so an older row's stale manual Y nudge can never
    // silently resurrect itself.
    formData.set("holeOffsetY", "0");
    formData.set("letterOffsets", JSON.stringify(letterOffsets));

    setIsSubmitting(true);
    try {
      const url = editingTemplate ? `/api/templates/${editingTemplate.id}` : "/api/templates";
      const method = editingTemplate ? "PUT" : "POST";
      const res = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan template");

      if (editingTemplate) {
        updateTemplate(data.template as Template);
        toast.success("Template font berhasil diperbarui");
        onCancelEdit();
      } else {
        addTemplate(data.template as Template);
        toast.success("Template font berhasil disimpan");
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Kode Template
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="mis. FONT-001"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 sm:max-w-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          File Font (TTF/OTF)
          <input
            ref={fileInputRef}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            onChange={handleFileChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 sm:max-w-sm"
          />
          {isEditing && (
            <span className="text-xs text-slate-400">
              (Biarkan kosong jika tidak ingin mengubah file)
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Upload Gambar Preview/Thumbnail (PNG/JPG)
          <input
            ref={thumbnailInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            onChange={handleThumbnailChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 sm:max-w-sm"
          />
          {isEditing && (
            <span className="text-xs text-slate-400">
              (Biarkan kosong jika tidak ingin mengubah file)
            </span>
          )}
        </label>

        <ColorPaletteEditor colors={colors} onChange={setColors} />

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <span className="text-sm font-medium text-slate-700">Posisi Lubang Ring (Otomatis)</span>
          <span className="text-xs font-normal text-slate-400">
            Posisi lubang dihitung otomatis dari kontur potong huruf pertama setiap nama (bukan dari kotak
            teks mentah), jadi tetap presisi walau huruf awalnya berbeda-beda (&quot;B&quot; lurus, &quot;A&quot; miring,
            &quot;J&quot; melengkung, dst). Satu-satunya yang perlu diatur di sini adalah jarak lubang dari ujung
            kiri kontur — geser sampai titik merah di Live Preview di bawah pas.
          </span>
          <OffsetSlider
            label="Jarak Lubang (mm)"
            value={holeOffsetX}
            onChange={setHoleOffsetX}
            hint="Jarak pusat lubang dari ujung paling kiri kontur potong"
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <span className="text-sm font-medium text-slate-700">Kustomisasi Lubang A-Z</span>
          <span className="text-xs font-normal text-slate-400">
            Pada font bubble/script, posisi tengah geometris huruf awal (mis. &quot;J&quot;, &quot;A&quot;, &quot;V&quot;) kadang
            tidak sama dengan pusat visualnya, sehingga lubang otomatis jatuh terlalu ke bawah. Pilih
            hurufnya, lalu geser X/Y sampai pas — Live Preview di bawah otomatis berganti ke contoh nama
            berawalan huruf itu. Huruf dengan titik biru berarti sudah dikustomisasi.
          </span>

          <div className="flex flex-wrap gap-1">
            {ALPHABET.map((letter) => {
              const isSelected = letter === selectedLetter;
              const isCustomized = Boolean(letterOffsets[letter]);
              return (
                <button
                  key={letter}
                  type="button"
                  onClick={() => setSelectedLetter(letter)}
                  className={`relative h-8 w-8 rounded-md border text-xs font-semibold transition-colors ${
                    isSelected
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-300 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {letter}
                  {isCustomized && !isSelected && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-2">
            <OffsetSlider
              label={`Huruf "${selectedLetter}" — Geser X`}
              value={letterOffsets[selectedLetter]?.x ?? 0}
              onChange={(value) => handleLetterOffsetChange("x", value)}
              hint="Tambahan geser kiri/kanan, di atas Jarak Lubang di atas"
              min={-MAX_LAYOUT_OFFSET_MM}
              max={MAX_LAYOUT_OFFSET_MM}
            />
            <OffsetSlider
              label={`Huruf "${selectedLetter}" — Geser Y`}
              value={letterOffsets[selectedLetter]?.y ?? 0}
              onChange={(value) => handleLetterOffsetChange("y", value)}
              hint="Tambahan geser atas/bawah, di atas posisi otomatis"
              min={-MAX_LAYOUT_OFFSET_MM}
              max={MAX_LAYOUT_OFFSET_MM}
            />
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
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
                : "Simpan Template Font"}
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
            {textPreview && textPreview.segments.length > 0 ? (
              <g transform={`translate(${textTranslateX}, ${textTranslateY})`}>
                {textPreview.segments.map((segment, index) => (
                  <path key={index} d={segment.d} fill={segment.color} />
                ))}
              </g>
            ) : (
              <text
                x={CANVAS_MARGIN}
                y={canvasHeight / 2}
                dominantBaseline="middle"
                fontSize={14}
                fill="#94a3b8"
              >
                Unggah font untuk pratinjau teks
              </text>
            )}

            {finalOutlinePath && <path d={finalOutlinePath} stroke="red" strokeWidth={1.5} fill="none" />}

            <circle cx={holeCenter.x} cy={holeCenter.y} r={RING_HOLE_DIAMETER_PX / 2} stroke="red" strokeWidth={1} fill="none" />
          </svg>
        </div>
      </div>
    </div>
  );
}
