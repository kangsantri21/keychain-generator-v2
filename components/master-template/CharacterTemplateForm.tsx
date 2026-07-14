"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as opentype from "opentype.js";
import { renderColoredGlyphsAtHeight, type ColoredTextRender } from "@/lib/font-preview";
import {
  DILATE_PX,
  ERODE_PX,
  translatePathData,
  scaleAndTranslatePathData,
  getPathBounds,
  findHoleCenterInside,
  type PathBounds,
} from "@/lib/laser-outline";
import { computeLaserOutlineClipper, unionOutlines } from "@/lib/clipper-outline";
import { parseCharacterSvg, type CharacterVector } from "@/lib/character-svg";
import { useTemplateStore } from "@/lib/store/useTemplateStore";
import type { Template } from "@/lib/db/schema";
import { CHAR_BOX_MM, MAX_LAYOUT_OFFSET_MM, WELD_CLEARANCE_MM, TEXT_RAW_HEIGHT_MM } from "@/lib/keychain-geometry";
import { ColorPaletteEditor, DEFAULT_COLOR, MAX_COLORS, MIN_COLORS } from "./ColorPaletteEditor";

// Live-preview canvas geometry (px), approximating the laser-cut scale.
const CHAR_BOX_SIZE = 96;
const TEXT_GAP = 18; // ~5mm
const CANVAS_MARGIN = 24;
const RING_HOLE_OFFSET = 11; // ~3mm from the character box's top-left corner
const RING_HOLE_DIAMETER = 7; // ~0.19mm spec, scaled up for preview visibility
const OUTLINE_DEBOUNCE_MS = 300;
// Manual layout offsets are stored/submitted in real-world mm (matching the
// production renderer); this converts them to the preview's px scale.
const PX_PER_MM = CHAR_BOX_SIZE / CHAR_BOX_MM;
// Raw (pre-dilation) glyph height target in px, mirroring the production
// spec (TEXT_RAW_HEIGHT_MM) so the preview's finished cut line matches the
// real 25-27mm production height exactly, regardless of the uploaded font.
const TEXT_RAW_HEIGHT_PX = TEXT_RAW_HEIGHT_MM * PX_PER_MM;

function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

const OFFSET_SLIDER_STEP = 0.5;

function OffsetSlider({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-slate-500">{value.toFixed(1)} mm</span>
      </div>
      <input
        type="range"
        min={-MAX_LAYOUT_OFFSET_MM}
        max={MAX_LAYOUT_OFFSET_MM}
        step={OFFSET_SLIDER_STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-blue-600"
      />
      <span className="text-[11px] font-normal text-slate-400">{hint}</span>
    </label>
  );
}

function unionBounds(a: PathBounds, b: PathBounds): PathBounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Candidate ring-hole centers within `bounds`, closest to the preferred
 * (nominal top-left) position first — used to find a spot that actually
 * lands on solid material for non-square/non-convex character silhouettes.
 */
function holeCandidates(
  preferred: { x: number; y: number },
  bounds: PathBounds,
  radius: number,
  step: number
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let y = bounds.y + radius; y <= bounds.y + bounds.height - radius; y += step) {
    for (let x = bounds.x + radius; x <= bounds.x + bounds.width - radius; x += step) {
      points.push({ x, y });
    }
  }
  points.sort((a, b) => {
    const da = (a.x - preferred.x) ** 2 + (a.y - preferred.y) ** 2;
    const db = (b.x - preferred.x) ** 2 + (b.y - preferred.y) ** 2;
    return da - db;
  });
  return points;
}

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
  // The designer's own cut-line + cleaned artwork, parsed from an SVG
  // upload — null means "no cut-line found, fall back to the plain box".
  const [characterVector, setCharacterVector] = useState<CharacterVector | null>(null);
  const [parsedFont, setParsedFont] = useState<opentype.Font | null>(null);
  const [outlinePath, setOutlinePath] = useState<string | null>(null);
  // Manual layout tweak (mm), persisted on the template so production
  // rendering matches whatever the user dialed in here. Text position is
  // always auto-computed (see textOriginX/textTranslateY below) — letting
  // it be manually offset let letters overlap the character artwork.
  const [holeOffsetX, setHoleOffsetX] = useState(editingTemplate?.holeOffsetX ?? 0);
  const [holeOffsetY, setHoleOffsetY] = useState(editingTemplate?.holeOffsetY ?? 0);
  const [holeCenter, setHoleCenter] = useState({
    x: CANVAS_MARGIN + RING_HOLE_OFFSET + (editingTemplate?.holeOffsetX ?? 0) * PX_PER_MM,
    y: CANVAS_MARGIN + RING_HOLE_OFFSET + (editingTemplate?.holeOffsetY ?? 0) * PX_PER_MM,
  });
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

  // Fetch the existing font (and, if it's an SVG, the character cut-line)
  // once, for an accurate live preview when opened in edit mode.
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

    if (editingTemplate.characterImagePath?.toLowerCase().endsWith(".svg")) {
      (async () => {
        try {
          const res = await fetch(editingTemplate.characterImagePath!);
          const text = await res.text();
          const vector = parseCharacterSvg(text);
          if (!cancelled && vector) {
            setCharacterVector(vector);
            setCharacterPreviewUrl(vector.artworkDataUri);
          }
        } catch {
          // Keep the raw image preview if parsing fails — not fatal.
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [editingTemplate]);

  async function handleCharacterFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;

    if (selected && !isSvgFile(selected)) {
      toast.error("Gagal: Mesin laser butuh garis vektor. File karakter WAJIB berformat .svg!");
      event.target.value = "";
      setCharacterFile(null);
      setCharacterVector(null);
      setCharacterPreviewUrl(editingTemplate?.characterImagePath ?? null);
      return;
    }

    setCharacterFile(selected);

    if (!selected) {
      setCharacterVector(null);
      setCharacterPreviewUrl(editingTemplate?.characterImagePath ?? null);
      return;
    }

    try {
      const text = await selected.text();
      const vector = parseCharacterSvg(text);
      setCharacterVector(vector);
      setCharacterPreviewUrl(vector ? vector.artworkDataUri : URL.createObjectURL(selected));
    } catch {
      toast.error("Gagal membaca kontur SVG, menampilkan gambar apa adanya");
      setCharacterVector(null);
      setCharacterPreviewUrl(URL.createObjectURL(selected));
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
      return renderColoredGlyphsAtHeight(parsedFont, defaultText.trim(), TEXT_RAW_HEIGHT_PX, colors);
    } catch {
      return null;
    }
  }, [parsedFont, defaultText, colors]);

  // Fit the designer's own cut-line into the character box the same way the
  // production renderer does — computed once here (not just inside the
  // outline effect) so both the text's X origin and the outline computation
  // can be measured against the character's *actual* silhouette bounds.
  const characterFit = useMemo(() => {
    if (!characterVector || characterVector.cutLinePaths.length === 0) return null;
    const { bounds: srcBounds } = characterVector;
    const fitScale = Math.min(CHAR_BOX_SIZE / srcBounds.width, CHAR_BOX_SIZE / srcBounds.height);
    const cutTx = CANVAS_MARGIN + (CHAR_BOX_SIZE - srcBounds.width * fitScale) / 2 - srcBounds.x * fitScale;
    const cutTy = CANVAS_MARGIN + (CHAR_BOX_SIZE - srcBounds.height * fitScale) / 2 - srcBounds.y * fitScale;
    const positionedCutLines = characterVector.cutLinePaths.map((d) =>
      scaleAndTranslatePathData(d, fitScale, cutTx, cutTy)
    );
    let bounds: PathBounds | null = null;
    for (const d of positionedCutLines) {
      const b = getPathBounds(d);
      if (b) bounds = bounds ? unionBounds(bounds, b) : b;
    }
    return bounds ? { positionedCutLines, bounds } : null;
  }, [characterVector]);

  // Position the text just clear of the character's *actual* cut-line
  // silhouette (not the nominal CHAR_BOX_SIZE square, which real artwork
  // rarely fills) — a small positive clearance gap keeps the raw glyphs from
  // ever visually overlapping the character artwork, while staying under
  // the text's net dilation growth so the *dilated* cutting outline still
  // reaches the character and Clipper welds them into one contour.
  const WELD_CLEARANCE_PX = WELD_CLEARANCE_MM * PX_PER_MM;
  const nominalTextOriginX = CANVAS_MARGIN + CHAR_BOX_SIZE + TEXT_GAP;
  const textOriginX = characterFit
    ? characterFit.bounds.x + characterFit.bounds.width + WELD_CLEARANCE_PX
    : nominalTextOriginX;
  const textOriginY = CANVAS_MARGIN;

  // Center vertically against the character's *actual* silhouette height
  // when one is known, not the nominal box — an off-center cut-line would
  // otherwise leave the text looking misaligned next to the artwork.
  const charCenterY = characterFit
    ? characterFit.bounds.y + characterFit.bounds.height / 2
    : CANVAS_MARGIN + CHAR_BOX_SIZE / 2;

  const textTranslateX = textPreview ? textOriginX - textPreview.bbox.x1 : textOriginX;
  const textTranslateY = textPreview ? charCenterY - (textPreview.bbox.y1 + textPreview.bbox.y2) / 2 : textOriginY;
  const textWidth = textPreview ? Math.max(textPreview.bbox.x2 - textPreview.bbox.x1, 1) : 80;

  const canvasWidth = textOriginX + textWidth + CANVAS_MARGIN;
  const canvasHeight = CHAR_BOX_SIZE + CANVAS_MARGIN * 2;

  useEffect(() => {
    const timeout = setTimeout(() => {
      const nominalHoleCenter = {
        x: CANVAS_MARGIN + RING_HOLE_OFFSET + holeOffsetX * PX_PER_MM,
        y: CANVAS_MARGIN + RING_HOLE_OFFSET + holeOffsetY * PX_PER_MM,
      };

      if (!characterPreviewUrl || !textPreview || textPreview.segments.length === 0) {
        setOutlinePath(null);
        setHoleCenter(nominalHoleCenter);
        return;
      }

      const glyphShapes = textPreview.segments.map((segment) =>
        translatePathData(segment.d, textTranslateX, textTranslateY)
      );

      if (characterFit) {
        // Union the designer's cut-line with the text outline as-is — no
        // re-dilating a contour that's already the final intended shape.
        const textOutline = computeLaserOutlineClipper(glyphShapes, { dilateMm: DILATE_PX, erodeMm: ERODE_PX });
        const combined = unionOutlines(
          textOutline ? [textOutline, ...characterFit.positionedCutLines] : characterFit.positionedCutLines
        );
        setOutlinePath(combined);

        // The ring hole's offset (nominal + manual nudge) is safe for a plain
        // square box but can miss a non-square/non-convex character
        // silhouette — find the nearest spot that's actually inside the
        // welded outline, preferring the position closest to what the user
        // dialed in.
        let nextHoleCenter = nominalHoleCenter;
        if (combined) {
          const searchBounds = unionBounds(characterFit.bounds, {
            x: nominalHoleCenter.x - RING_HOLE_DIAMETER,
            y: nominalHoleCenter.y - RING_HOLE_DIAMETER,
            width: RING_HOLE_DIAMETER * 2,
            height: RING_HOLE_DIAMETER * 2,
          });
          const found = findHoleCenterInside(
            combined,
            holeCandidates(nominalHoleCenter, searchBounds, RING_HOLE_DIAMETER / 2, 3),
            RING_HOLE_DIAMETER / 2
          );
          if (found) nextHoleCenter = found;
        }
        setHoleCenter(nextHoleCenter);
      } else {
        const charBoxD = `M ${CANVAS_MARGIN} ${CANVAS_MARGIN} L ${CANVAS_MARGIN + CHAR_BOX_SIZE} ${CANVAS_MARGIN} L ${CANVAS_MARGIN + CHAR_BOX_SIZE} ${CANVAS_MARGIN + CHAR_BOX_SIZE} L ${CANVAS_MARGIN} ${CANVAS_MARGIN + CHAR_BOX_SIZE} Z`;
        setOutlinePath(
          computeLaserOutlineClipper([charBoxD, ...glyphShapes], { dilateMm: DILATE_PX, erodeMm: ERODE_PX })
        );
        setHoleCenter(nominalHoleCenter);
      }
    }, OUTLINE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [characterPreviewUrl, textPreview, textTranslateX, textTranslateY, characterFit, holeOffsetX, holeOffsetY]);

  function resetForm() {
    setCode("");
    setDefaultText("Nama");
    setCharacterFile(null);
    setCharacterPreviewUrl(null);
    setCharacterVector(null);
    setFontFile(null);
    setParsedFont(null);
    setOutlinePath(null);
    setHoleOffsetX(0);
    setHoleOffsetY(0);
    setHoleCenter({ x: CANVAS_MARGIN + RING_HOLE_OFFSET, y: CANVAS_MARGIN + RING_HOLE_OFFSET });
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
    formData.set("holeOffsetX", String(holeOffsetX));
    formData.set("holeOffsetY", String(holeOffsetY));

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
          File Karakter (SVG)
          <input
            ref={characterInputRef}
            type="file"
            accept=".svg, image/svg+xml"
            onChange={handleCharacterFileChange}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
          <span className="text-xs text-slate-400">
            SVG dengan path <code>id=&quot;cut-line&quot;</code> atau <code>stroke=&quot;#FF0000&quot;</code>{" "}
            akan dipakai sebagai kontur potong asli.
          </span>
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

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">
            Penyesuaian Lubang Ganci <span className="font-normal text-slate-400">(opsional, mm)</span>
          </span>
          <div className="grid gap-3 sm:grid-cols-2">
            <OffsetSlider
              label="Lubang Ganci — Geser X"
              value={holeOffsetX}
              onChange={setHoleOffsetX}
              hint="Kiri / kanan"
            />
            <OffsetSlider
              label="Lubang Ganci — Geser Y"
              value={holeOffsetY}
              onChange={setHoleOffsetY}
              hint="Atas / bawah"
            />
          </div>
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Live Preview</span>
          {characterVector && characterVector.cutLinePaths.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Kontur SVG terdeteksi
            </span>
          )}
        </div>
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
              cx={holeCenter.x}
              cy={holeCenter.y}
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
