import type { MaharFrameShape } from "@/lib/mahar-types";

/**
 * "Bahan Mahar" sheet/layout constants — independent of the keychain
 * module's own SHEET_WIDTH_MM/HEIGHT_MM (lib/keychain-geometry.ts): mahar
 * plaques are a physically different, generally larger product than an
 * acrylic keychain, cut from a separate stock sheet. Chosen as a reasonable
 * default for a common large laser-bed size — adjust here if the actual
 * acrylic stock used for mahar differs.
 */
export const MAHAR_SHEET_WIDTH_MM = 600;
export const MAHAR_SHEET_HEIGHT_MM = 900;

/** Gap the packer keeps between neighboring mahar pieces (and around the sheet's own edges) — mirrors ITEM_PADDING_RIGHT_MM/BOTTOM_MM's role for keychains (passed as both, since mahar has no receipt-label asymmetry need), sized up for a bigger physical product. */
export const MAHAR_ITEM_PADDING_MM = 10;

export interface MaharSizePreset {
  label: string;
  widthMm: number;
  heightMm: number;
}

/**
 * Fixed set of preset plaque sizes offered in the generator form's "Ukuran"
 * dropdown — common Indonesian mahar/wedding-plaque sizes. The DB column
 * (maharOrders.size) stores the preset's own `label` text (per the given
 * schema spec: one free-text column), and `resolveMaharSizeMm` below is
 * the single place that turns that label back into real mm for nesting/DXF.
 */
export const MAHAR_SIZE_PRESETS: MaharSizePreset[] = [
  { label: "20x30 cm", widthMm: 200, heightMm: 300 },
  { label: "25x35 cm", widthMm: 250, heightMm: 350 },
  { label: "30x40 cm", widthMm: 300, heightMm: 400 },
  { label: "40x50 cm", widthMm: 400, heightMm: 500 },
];

const CUSTOM_SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i;

/**
 * Resolves a maharOrders.size text value (a preset label, or a raw
 * "WIDTHxHEIGHT" mm string for a custom size) into real mm dimensions for
 * nesting/DXF. Falls back to the smallest preset for anything unparseable
 * (a legacy or malformed value) rather than crashing the nesting page.
 */
export function resolveMaharSizeMm(size: string): { widthMm: number; heightMm: number } {
  const preset = MAHAR_SIZE_PRESETS.find((p) => p.label === size);
  if (preset) return { widthMm: preset.widthMm, heightMm: preset.heightMm };

  const match = size.trim().match(CUSTOM_SIZE_PATTERN);
  if (match) return { widthMm: Number(match[1]), heightMm: Number(match[2]) };

  return { widthMm: MAHAR_SIZE_PRESETS[0].widthMm, heightMm: MAHAR_SIZE_PRESETS[0].heightMm };
}

export const MAHAR_FRAME_SHAPES: { value: MaharFrameShape; label: string }[] = [
  { value: "rectangle", label: "Persegi Panjang" },
  { value: "oval", label: "Oval" },
  { value: "circle", label: "Lingkaran" },
  { value: "hexagon", label: "Hexagon" },
];
