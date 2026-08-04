"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import * as opentype from "opentype.js";
import { Plus, Trash2 } from "lucide-react";
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
import type { Template, CustomZone } from "@/lib/db/schema";
import {
  CHAR_BOX_MM,
  MAX_LAYOUT_OFFSET_MM,
  WELD_CLEARANCE_MM,
  SEAM_CLOSE_MM,
  DILATE_MM,
  ERODE_MM,
  DEFAULT_CHAR_TARGET_HEIGHT_MM,
  DEFAULT_TEXT_TARGET_HEIGHT_MM,
  MAX_ITEM_WIDTH_MM,
} from "@/lib/keychain-geometry";
import { ColorPaletteEditor, DEFAULT_COLOR, MAX_COLORS, MIN_COLORS } from "./ColorPaletteEditor";

// Live-preview canvas geometry (px), approximating the laser-cut scale.
const TEXT_GAP = 18; // ~5mm
const CANVAS_MARGIN = 24;
const RING_HOLE_OFFSET = 11; // ~3mm from the character box's top-left corner
const RING_HOLE_DIAMETER = 7; // ~1.9mm spec, scaled up for preview visibility
const OUTLINE_DEBOUNCE_MS = 300;
// Manual layout offsets are stored/submitted in real-world mm (matching the
// production renderer); this converts them to the preview's px scale. Kept
// as a fixed reference scale (production itself no longer ties the
// character's size to CHAR_BOX_MM — see charTargetHeight below).
const PX_PER_MM = 96 / CHAR_BOX_MM;
// Net outward growth a dilate+erode closing pass adds to a dimension (both
// edges combined) — mirrors production's CLOSING_GROWTH_MM
// (lib/keychain-render.ts) so the preview's raw glyph/box size, rendered
// this much smaller than its target, nets out to the real finished target
// height after the preview's own dilate/erode pass below.
const CLOSING_GROWTH_MM = 2 * (DILATE_MM - ERODE_MM);
// Extra closing pass (mirrors the production SEAM_CLOSE_MM) applied to the
// final character+text union so the preview's seam matches the real welded
// bridge shape instead of showing a fragile-looking notch that isn't there.
const SEAM_CLOSE_PX = SEAM_CLOSE_MM * PX_PER_MM;

function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
}

function isRasterImageFile(file: File): boolean {
  return /\.(png|jpe?g)$/i.test(file.name) || file.type === "image/png" || file.type === "image/jpeg";
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
  const [coverThumbnailFile, setCoverThumbnailFile] = useState<File | null>(null);
  // Optional admin-uploaded cover image for the Master Template catalog grid
  // (components/master-template/TemplateGallery.tsx) — a plain flat photo,
  // separate from the auto-generated character+text composite thumbnail,
  // which can look cluttered at small grid sizes.
  const [coverThumbnailPreviewUrl, setCoverThumbnailPreviewUrl] = useState<string | null>(
    editingTemplate?.thumbnailUrl ?? null
  );
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
  // Fixed-Shape Template product line (MVP simple-numbers form): "dynamic"
  // (default) keeps every existing behavior below untouched; "fixed" reuses
  // the character image slot as a master SVG that already has its own final
  // cut-line, with customZones marking where a name/photo gets placed —
  // see lib/keychain-render-fixed.ts for how production actually renders it.
  const [layoutMode, setLayoutMode] = useState<"dynamic" | "fixed">(editingTemplate?.layoutMode ?? "dynamic");
  const [customZones, setCustomZones] = useState<CustomZone[]>(editingTemplate?.customZones ?? []);
  // "dynamic"-only production spec (lib/db/schema.ts): the character and
  // text nodes each scale independently to their own finished (post-clipper)
  // cutting height — see lib/keychain-render.ts. Drives both the submitted
  // form data and this preview's own box/glyph sizing below.
  const [charTargetHeight, setCharTargetHeight] = useState(
    editingTemplate?.charTargetHeight ?? DEFAULT_CHAR_TARGET_HEIGHT_MM
  );
  const [textTargetHeight, setTextTargetHeight] = useState(
    editingTemplate?.textTargetHeight ?? DEFAULT_TEXT_TARGET_HEIGHT_MM
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const coverThumbnailInputRef = useRef<HTMLInputElement>(null);
  const addTemplate = useTemplateStore((state) => state.addTemplate);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);

  const isEditing = Boolean(editingTemplate);

  useEffect(() => {
    return () => {
      if (characterPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(characterPreviewUrl);
    };
  }, [characterPreviewUrl]);

  useEffect(() => {
    return () => {
      if (coverThumbnailPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(coverThumbnailPreviewUrl);
    };
  }, [coverThumbnailPreviewUrl]);

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
            // "Fixed" mode never shows the cut-line-stripped artwork (see
            // handleCharacterFileChange's matching comment below) — the
            // initial state already points characterPreviewUrl at the raw
            // file (editingTemplate.characterImagePath), so leave it as-is.
            if (layoutMode !== "fixed") setCharacterPreviewUrl(vector.artworkDataUri);
          }
        } catch {
          // Keep the raw image preview if parsing fails — not fatal.
        }
      })();
    }

    return () => {
      cancelled = true;
    };
    // layoutMode is intentionally read only at its initial (mount-time)
    // value here, matching editingTemplate's own remount-per-template
    // lifecycle (see this component's top-level doc comment) — it must not
    // re-run this fetch just because the admin toggles the Mode Layout radio
    // afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // "Fixed" master SVGs are multi-layer designer files where the
      // cut-line-detection heuristic (tuned for single-character dynamic
      // uploads) unreliably mis-tags an inner design layer as the cut-line
      // and strips it out of vector.artworkDataUri — always show the raw,
      // untouched file instead so nothing silently vanishes from the
      // preview (production applies the same rule, see
      // lib/keychain-render.ts's loadTemplateAssets).
      setCharacterPreviewUrl(
        layoutMode === "fixed" || !vector ? URL.createObjectURL(selected) : vector.artworkDataUri
      );
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

  function handleCoverThumbnailChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;

    if (selected && !isRasterImageFile(selected)) {
      toast.error("File cover/thumbnail harus berformat PNG atau JPG");
      event.target.value = "";
      setCoverThumbnailFile(null);
      setCoverThumbnailPreviewUrl(editingTemplate?.thumbnailUrl ?? null);
      return;
    }

    setCoverThumbnailFile(selected);
    setCoverThumbnailPreviewUrl(selected ? URL.createObjectURL(selected) : (editingTemplate?.thumbnailUrl ?? null));
  }

  function handleAddZone() {
    setCustomZones((zones) => [
      ...zones,
      { id: crypto.randomUUID(), type: "text", x: 0, y: 0, width: 20, height: 10 },
    ]);
  }

  function handleRemoveZone(id: string) {
    setCustomZones((zones) => zones.filter((zone) => zone.id !== id));
  }

  function handleZoneChange(id: string, patch: Partial<CustomZone>) {
    setCustomZones((zones) => zones.map((zone) => (zone.id === id ? { ...zone, ...patch } : zone)));
  }

  // Raw (pre-dilation) glyph height target in px, mirroring production's
  // CLOSING_GROWTH_MM compensation (lib/keychain-render.ts) so the preview's
  // finished cut line matches textTargetHeight exactly, regardless of font.
  const textRawHeightPx = Math.max((textTargetHeight - CLOSING_GROWTH_MM) * PX_PER_MM, 1);
  // Side length of the plain (no designer cut-line) character placeholder
  // box — this box IS dilated in production, so it needs the same
  // compensation as the text; a designer's own cut-line does not (see
  // characterFit below).
  const charBoxRawPx = Math.max((charTargetHeight - CLOSING_GROWTH_MM) * PX_PER_MM, 1);
  // A designer's own cut-line is unioned verbatim (never itself dilated),
  // so it scales directly to the *finished* target height with no
  // compensation — see characterFit below.
  const charFinishedPx = charTargetHeight * PX_PER_MM;

  const textPreview: ColoredTextRender | null = useMemo(() => {
    if (!parsedFont || !defaultText.trim()) return null;
    try {
      return renderColoredGlyphsAtHeight(parsedFont, defaultText.trim(), textRawHeightPx, colors);
    } catch {
      return null;
    }
  }, [parsedFont, defaultText, colors, textRawHeightPx]);

  // Fit the designer's own cut-line into the character box the same way the
  // production renderer does — computed once here (not just inside the
  // outline effect) so both the text's X origin and the outline computation
  // can be measured against the character's *actual* silhouette bounds.
  // Height-only scale (matching production): the artwork's own proportions,
  // not a fixed square, determine its width.
  const characterFit = useMemo(() => {
    if (!characterVector || characterVector.cutLinePaths.length === 0) return null;
    const { bounds: srcBounds } = characterVector;
    const fitScale = charFinishedPx / srcBounds.height;
    const cutTx = CANVAS_MARGIN - srcBounds.x * fitScale;
    const cutTy = CANVAS_MARGIN - srcBounds.y * fitScale;
    const positionedCutLines = characterVector.cutLinePaths.map((d) =>
      scaleAndTranslatePathData(d, fitScale, cutTx, cutTy)
    );
    let bounds: PathBounds | null = null;
    for (const d of positionedCutLines) {
      const b = getPathBounds(d);
      if (b) bounds = bounds ? unionBounds(bounds, b) : b;
    }
    return bounds ? { positionedCutLines, bounds } : null;
  }, [characterVector, charFinishedPx]);

  // --- "fixed" layoutMode preview: customZones live inside the master SVG's
  // own coordinate space (mm) — see the "Zona Kustomisasi" editor's own
  // helper text below — so the preview canvas here is anchored to that same
  // space (mirroring lib/keychain-render-fixed.ts) instead of the
  // character-box-plus-gap layout the "dynamic" preview above uses. Kept
  // entirely separate so neither mode's math can leak into the other.
  const masterSvgBounds = characterVector?.bounds ?? null;

  // Base auto-scale: mirrors lib/keychain-render-fixed.ts exactly — some
  // designer master SVGs are exported at an oversized native viewBox
  // (hundreds of mm), which would otherwise nest as a giant item and
  // corrupt the cut-line in production. Scale the whole master (artwork,
  // cut-line, and every customZone's admin-entered coordinates alike) down
  // uniformly so its width never exceeds MAX_ITEM_WIDTH_MM, BEFORE any
  // preview geometry below is computed — so what the admin sees here always
  // matches the actual calibrated production output 1:1. A no-op
  // (fixedBaseScale = 1) for any master already within spec.
  const fixedBaseScale =
    masterSvgBounds && masterSvgBounds.width > MAX_ITEM_WIDTH_MM ? MAX_ITEM_WIDTH_MM / masterSvgBounds.width : 1;
  const scaledMasterSvgBounds = useMemo(
    () =>
      masterSvgBounds
        ? {
            x: masterSvgBounds.x * fixedBaseScale,
            y: masterSvgBounds.y * fixedBaseScale,
            width: masterSvgBounds.width * fixedBaseScale,
            height: masterSvgBounds.height * fixedBaseScale,
          }
        : null,
    [masterSvgBounds, fixedBaseScale]
  );

  const fixedCanvasBounds = useMemo(() => {
    if (layoutMode !== "fixed") return null;
    let bounds: PathBounds | null = scaledMasterSvgBounds;
    for (const zone of customZones) {
      const zoneBounds: PathBounds = {
        x: zone.x * fixedBaseScale,
        y: zone.y * fixedBaseScale,
        width: Math.max(zone.width, 0) * fixedBaseScale,
        height: Math.max(zone.height, 0) * fixedBaseScale,
      };
      bounds = bounds ? unionBounds(bounds, zoneBounds) : zoneBounds;
    }
    return bounds;
  }, [layoutMode, scaledMasterSvgBounds, customZones, fixedBaseScale]);

  // Where the master SVG's own (mm, base-auto-scaled) origin lands in
  // preview px — every zone and the master artwork itself are positioned
  // relative to this so they always stay visually in sync with each other,
  // even if a zone's coordinates fall outside the artwork's own bounds.
  const fixedOriginX = fixedCanvasBounds?.x ?? 0;
  const fixedOriginY = fixedCanvasBounds?.y ?? 0;
  const fixedCanvasWidth = fixedCanvasBounds ? fixedCanvasBounds.width * PX_PER_MM + CANVAS_MARGIN * 2 : 240;
  const fixedCanvasHeight = fixedCanvasBounds ? fixedCanvasBounds.height * PX_PER_MM + CANVAS_MARGIN * 2 : 160;

  // Live-fits the sample name into each "text" customZone exactly like
  // production (lib/keychain-render-fixed.ts): the zone's admin-entered
  // coordinates are calibrated by fixedBaseScale first, then the text is
  // rendered calibrated to the (scaled) zone's own height, shrunk (never
  // upscaled) only as needed to fit its width too, and centered inside it —
  // so dragging the X/Y/Lebar/Tinggi inputs moves and resizes this preview's
  // text live, the same way it will move in the actual laser-cut output.
  const zoneTextPreviews = useMemo(() => {
    if (layoutMode !== "fixed" || !parsedFont) return [];
    const sampleText = defaultText.trim() || "Nama";
    const results: { zone: CustomZone; segments: { d: string; color: string }[] }[] = [];

    for (const zone of customZones) {
      if (zone.type !== "text" || zone.width <= 0 || zone.height <= 0) continue;

      const zoneXScaled = zone.x * fixedBaseScale;
      const zoneYScaled = zone.y * fixedBaseScale;
      const zoneWidthScaled = zone.width * fixedBaseScale;
      const zoneHeightScaled = zone.height * fixedBaseScale;
      const zoneHeightPx = zoneHeightScaled * PX_PER_MM;

      let rendered: ColoredTextRender;
      try {
        rendered = renderColoredGlyphsAtHeight(parsedFont, sampleText, zoneHeightPx, colors);
      } catch {
        continue;
      }
      const { segments, bbox } = rendered;
      const rawWidthPx = Math.max(bbox.x2 - bbox.x1, 1e-6);
      const rawHeightPx = Math.max(bbox.y2 - bbox.y1, 1e-6);
      const zoneWidthPx = zoneWidthScaled * PX_PER_MM;

      // Shrink-to-fit only (never upscale past the zone-calibrated default),
      // matching production's `Math.min(..., 1)` cap.
      const scale = Math.min(zoneWidthPx / rawWidthPx, zoneHeightPx / rawHeightPx, 1);

      const zoneCenterX = CANVAS_MARGIN + (zoneXScaled + zoneWidthScaled / 2 - fixedOriginX) * PX_PER_MM;
      const zoneCenterY = CANVAS_MARGIN + (zoneYScaled + zoneHeightScaled / 2 - fixedOriginY) * PX_PER_MM;
      const translateX = zoneCenterX - (scale * (bbox.x1 + bbox.x2)) / 2;
      const translateY = zoneCenterY - (scale * (bbox.y1 + bbox.y2)) / 2;

      results.push({
        zone,
        segments: segments.map((segment) => ({
          d: scaleAndTranslatePathData(segment.d, scale, translateX, translateY),
          color: segment.color,
        })),
      });
    }

    return results;
  }, [layoutMode, parsedFont, defaultText, colors, customZones, fixedBaseScale, fixedOriginX, fixedOriginY]);

  // Auto-computed cut-line preview: mirrors lib/keychain-render-fixed.ts's
  // plain Clipper union (zero offset — no dilate/erode padding) over EVERY
  // shape in the master SVG exactly — a fixed-mode master already has its
  // own finished white border and outer line drawn into the artwork, so
  // (unlike the dynamic-mode preview above, which deliberately grows its
  // outline via DILATE_PX/ERODE_PX) this stays tight against the file's own
  // outer edge with zero added padding. What the admin sees here is the
  // same silhouette that will actually get cut, never a "trust the file's
  // own tagged cut-line" guess a multi-layer designer export routinely got
  // wrong.
  const fixedOutlinePath = useMemo(() => {
    if (layoutMode !== "fixed" || !characterVector) return null;
    const scale = fixedBaseScale * PX_PER_MM;
    const tx = CANVAS_MARGIN - fixedOriginX * PX_PER_MM;
    const ty = CANVAS_MARGIN - fixedOriginY * PX_PER_MM;
    const scaledShapes = characterVector.allShapePaths.map((d) => scaleAndTranslatePathData(d, scale, tx, ty));
    return unionOutlines(scaledShapes);
  }, [layoutMode, characterVector, fixedBaseScale, fixedOriginX, fixedOriginY]);
  // --- end "fixed" layoutMode preview ---

  // Position the text just clear of the character's *actual* cut-line
  // silhouette (not a nominal box edge, which real artwork rarely fills) —
  // a small positive clearance gap keeps the raw glyphs from ever visually
  // overlapping the character artwork, while staying under the text's net
  // dilation growth so the *dilated* cutting outline still reaches the
  // character and Clipper welds them into one contour.
  const WELD_CLEARANCE_PX = WELD_CLEARANCE_MM * PX_PER_MM;
  const nominalTextOriginX = CANVAS_MARGIN + charBoxRawPx + TEXT_GAP;
  const textOriginX = characterFit
    ? characterFit.bounds.x + characterFit.bounds.width + WELD_CLEARANCE_PX
    : nominalTextOriginX;
  const textOriginY = CANVAS_MARGIN;

  // Center vertically against the character's *actual* silhouette height
  // when one is known, not a nominal box — an off-center cut-line would
  // otherwise leave the text looking misaligned next to the artwork.
  const charCenterY = characterFit
    ? characterFit.bounds.y + characterFit.bounds.height / 2
    : CANVAS_MARGIN + charBoxRawPx / 2;

  const textTranslateX = textPreview ? textOriginX - textPreview.bbox.x1 : textOriginX;
  const textTranslateY = textPreview ? charCenterY - (textPreview.bbox.y1 + textPreview.bbox.y2) / 2 : textOriginY;
  const textWidth = textPreview ? Math.max(textPreview.bbox.x2 - textPreview.bbox.x1, 1) : 80;

  const canvasWidth = textOriginX + textWidth + CANVAS_MARGIN;
  const canvasHeight = (characterFit ? characterFit.bounds.height : charBoxRawPx) + CANVAS_MARGIN * 2;

  useEffect(() => {
    const timeout = setTimeout(() => {
      const nominalHoleCenter = {
        x: CANVAS_MARGIN + RING_HOLE_OFFSET + holeOffsetX * PX_PER_MM,
        y: CANVAS_MARGIN + RING_HOLE_OFFSET + holeOffsetY * PX_PER_MM,
      };

      // "Fixed" templates never run THIS particular clipper pipeline (it's
      // the dynamic engine's character+text union) — their own auto-computed
      // outline is a separate memo, `fixedOutlinePath` below, mirroring
      // lib/keychain-render-fixed.ts's whole-master-SVG union instead.
      if (layoutMode === "fixed") {
        setOutlinePath(null);
        setHoleCenter(nominalHoleCenter);
        return;
      }

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
        const welded = unionOutlines(
          textOutline ? [textOutline, ...characterFit.positionedCutLines] : characterFit.positionedCutLines
        );
        // A plain union of two shapes that only just touch leaves a sharp,
        // narrow concave notch at the seam — a fragile neck once laser-cut.
        // An extra closing pass fills it into a smooth, rounded bridge
        // without changing the overall outer size.
        const combined = welded
          ? (computeLaserOutlineClipper([welded], { dilateMm: SEAM_CLOSE_PX, erodeMm: SEAM_CLOSE_PX }) ?? welded)
          : null;
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
        const charBoxD = `M ${CANVAS_MARGIN} ${CANVAS_MARGIN} L ${CANVAS_MARGIN + charBoxRawPx} ${CANVAS_MARGIN} L ${CANVAS_MARGIN + charBoxRawPx} ${CANVAS_MARGIN + charBoxRawPx} L ${CANVAS_MARGIN} ${CANVAS_MARGIN + charBoxRawPx} Z`;
        setOutlinePath(
          computeLaserOutlineClipper([charBoxD, ...glyphShapes], { dilateMm: DILATE_PX, erodeMm: ERODE_PX })
        );
        setHoleCenter(nominalHoleCenter);
      }
    }, OUTLINE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [
    characterPreviewUrl,
    textPreview,
    textTranslateX,
    textTranslateY,
    characterFit,
    holeOffsetX,
    holeOffsetY,
    layoutMode,
    charBoxRawPx,
  ]);

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
    setLayoutMode("dynamic");
    setCustomZones([]);
    setCharTargetHeight(DEFAULT_CHAR_TARGET_HEIGHT_MM);
    setTextTargetHeight(DEFAULT_TEXT_TARGET_HEIGHT_MM);
    setCoverThumbnailFile(null);
    setCoverThumbnailPreviewUrl(null);
    if (characterInputRef.current) characterInputRef.current.value = "";
    if (fontInputRef.current) fontInputRef.current.value = "";
    if (coverThumbnailInputRef.current) coverThumbnailInputRef.current.value = "";
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
    if (layoutMode === "fixed" && customZones.some((zone) => zone.width <= 0 || zone.height <= 0)) {
      toast.error("Lebar dan tinggi setiap zona harus lebih dari 0");
      return;
    }

    const formData = new FormData();
    formData.set("code", code.trim());
    formData.set("category", "character");
    if (fontFile) formData.set("file", fontFile);
    if (characterFile) formData.set("characterImage", characterFile);
    if (coverThumbnailFile) formData.set("coverThumbnail", coverThumbnailFile);
    formData.set("colors", JSON.stringify(colors));
    formData.set("defaultText", defaultText.trim() || "Nama");
    formData.set("holeOffsetX", String(holeOffsetX));
    formData.set("holeOffsetY", String(holeOffsetY));
    formData.set("layoutMode", layoutMode);
    formData.set("customZones", JSON.stringify(customZones));
    formData.set("charTargetHeight", String(charTargetHeight));
    formData.set("textTargetHeight", String(textTargetHeight));

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

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
          Gambar Cover / Thumbnail <span className="font-normal text-slate-400">(opsional)</span>
          <div className="flex items-center gap-3">
            <input
              ref={coverThumbnailInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              onChange={handleCoverThumbnailChange}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
            />
            {coverThumbnailPreviewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverThumbnailPreviewUrl}
                alt="Pratinjau cover"
                className="h-14 w-14 flex-shrink-0 border border-slate-200 object-cover"
              />
            )}
          </div>
          <span className="text-xs text-slate-400">
            Foto rapi khusus untuk kartu katalog di halaman Master Template. Jika kosong, katalog memakai
            pratinjau kontur otomatis seperti biasa.
          </span>
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

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
          <span className="text-sm font-medium text-slate-700">Mode Layout</span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="layoutMode"
                value="dynamic"
                checked={layoutMode === "dynamic"}
                onChange={() => setLayoutMode("dynamic")}
                className="accent-blue-600"
              />
              Dynamic (kontur otomatis, seperti sekarang)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="layoutMode"
                value="fixed"
                checked={layoutMode === "fixed"}
                onChange={() => setLayoutMode("fixed")}
                className="accent-blue-600"
              />
              Fixed (bentuk terkunci dari file SVG)
            </label>
          </div>

          {layoutMode === "dynamic" && (
            <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Tinggi Target Karakter (mm)
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={0.5}
                  value={charTargetHeight}
                  onChange={(event) => setCharTargetHeight(Number(event.target.value))}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                <span className="text-[11px] font-normal text-slate-400">
                  Tinggi potong akhir karakter, independen dari teks.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Tinggi Target Teks (mm)
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={0.5}
                  value={textTargetHeight}
                  onChange={(event) => setTextTargetHeight(Number(event.target.value))}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                />
                <span className="text-[11px] font-normal text-slate-400">
                  Tinggi potong akhir teks nama, independen dari karakter. Teks akan mengecil ke samping
                  (gepeng) jika total lebar item melebihi 80mm.
                </span>
              </label>
            </div>
          )}

          {layoutMode === "fixed" && (
            <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Zona Kustomisasi (Custom Zones)</span>
                <button
                  type="button"
                  onClick={handleAddZone}
                  className="flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <Plus size={14} />
                  Tambah Zona
                </button>
              </div>

              {customZones.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Belum ada zona. Klik &quot;Tambah Zona&quot; untuk menandai area teks/gambar di file SVG.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {customZones.map((zone, index) => (
                    <div
                      key={zone.id}
                      className="grid grid-cols-2 items-end gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-6"
                    >
                      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-1">
                        Zona #{index + 1} — Tipe
                        <select
                          value={zone.type}
                          onChange={(event) =>
                            handleZoneChange(zone.id, { type: event.target.value as "text" | "image" })
                          }
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        >
                          <option value="text">Text</option>
                          <option value="image">Image</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                        X (mm)
                        <input
                          type="number"
                          value={zone.x}
                          onChange={(event) => handleZoneChange(zone.id, { x: Number(event.target.value) })}
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                        Y (mm)
                        <input
                          type="number"
                          value={zone.y}
                          onChange={(event) => handleZoneChange(zone.id, { y: Number(event.target.value) })}
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                        Lebar (mm)
                        <input
                          type="number"
                          value={zone.width}
                          onChange={(event) => handleZoneChange(zone.id, { width: Number(event.target.value) })}
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                        Tinggi (mm)
                        <input
                          type="number"
                          value={zone.height}
                          onChange={(event) => handleZoneChange(zone.id, { height: Number(event.target.value) })}
                          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveZone(zone.id)}
                        aria-label="Hapus zona ini"
                        className="flex h-fit items-center justify-center rounded-md p-2 text-red-600 transition-colors hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400">
                Koordinat X/Y/Lebar/Tinggi mengikuti ukuran asli file SVG (mm). Kotak merah putus-putus dan
                teks di Live Preview di bawah bergerak mengikuti zona ini secara langsung — garis potong
                merah tetap diambil langsung dari file SVG (tidak dihitung ulang) untuk mode Fixed.
              </p>
            </div>
          )}
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
          {layoutMode === "fixed" && fixedBaseScale < 1 && masterSvgBounds && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Auto-scale: {masterSvgBounds.width.toFixed(0)}mm → {MAX_ITEM_WIDTH_MM}mm
            </span>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
          {layoutMode === "fixed" ? (
            <svg viewBox={`0 0 ${fixedCanvasWidth} ${fixedCanvasHeight}`} className="h-40 w-full max-w-full">
              {characterPreviewUrl && scaledMasterSvgBounds ? (
                <image
                  href={characterPreviewUrl}
                  x={CANVAS_MARGIN + (scaledMasterSvgBounds.x - fixedOriginX) * PX_PER_MM}
                  y={CANVAS_MARGIN + (scaledMasterSvgBounds.y - fixedOriginY) * PX_PER_MM}
                  width={scaledMasterSvgBounds.width * PX_PER_MM}
                  height={scaledMasterSvgBounds.height * PX_PER_MM}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : (
                <text x={CANVAS_MARGIN} y={CANVAS_MARGIN + 20} fontSize={14} fill="#94a3b8">
                  Unggah file SVG untuk pratinjau
                </text>
              )}

              {/* Auto-computed cut-line: same Clipper union+dilate/erode algorithm as
                  lib/keychain-render-fixed.ts, over every shape in the master SVG. */}
              {fixedOutlinePath && <path d={fixedOutlinePath} stroke="red" strokeWidth={1.5} fill="none" />}

              {/* Visual helper: a dashed red box per customZone (calibrated by the same
                  base auto-scale as the master artwork), live-synced to its X/Y/Lebar/Tinggi inputs. */}
              {customZones.map((zone) => (
                <rect
                  key={zone.id}
                  x={CANVAS_MARGIN + (zone.x * fixedBaseScale - fixedOriginX) * PX_PER_MM}
                  y={CANVAS_MARGIN + (zone.y * fixedBaseScale - fixedOriginY) * PX_PER_MM}
                  width={Math.max(zone.width, 0) * fixedBaseScale * PX_PER_MM}
                  height={Math.max(zone.height, 0) * fixedBaseScale * PX_PER_MM}
                  fill="none"
                  stroke="red"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              ))}

              {zoneTextPreviews.map(({ zone, segments }) =>
                segments.map((segment, index) => (
                  <path key={`${zone.id}-${index}`} d={segment.d} fill={segment.color} />
                ))
              )}

              {!parsedFont && customZones.some((zone) => zone.type === "text") && (
                <text
                  x={CANVAS_MARGIN}
                  y={fixedCanvasHeight - CANVAS_MARGIN / 2}
                  fontSize={12}
                  fill="#94a3b8"
                >
                  Unggah font untuk pratinjau teks di dalam zona
                </text>
              )}
            </svg>
          ) : (
            <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} className="h-40 w-full max-w-full">
              {characterPreviewUrl ? (
                <image
                  href={characterPreviewUrl}
                  x={CANVAS_MARGIN}
                  y={CANVAS_MARGIN}
                  width={characterFit ? characterFit.bounds.width : charBoxRawPx}
                  height={characterFit ? characterFit.bounds.height : charBoxRawPx}
                  preserveAspectRatio="xMidYMid meet"
                />
              ) : (
                <rect
                  x={CANVAS_MARGIN}
                  y={CANVAS_MARGIN}
                  width={charBoxRawPx}
                  height={charBoxRawPx}
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
                  y={CANVAS_MARGIN + charBoxRawPx / 2}
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
          )}
        </div>
      </div>
    </div>
  );
}
