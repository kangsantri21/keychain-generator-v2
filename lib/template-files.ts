import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { MAX_LAYOUT_OFFSET_MM } from "@/lib/keychain-geometry";
import type { CustomZone } from "@/lib/db/schema";

export const CHARACTER_EXTENSIONS = [".svg", ".png"];
export const FONT_EXTENSIONS = [".ttf", ".otf"];
export const THUMBNAIL_EXTENSIONS = [".png", ".jpg", ".jpeg"];
export const MAX_COLORS = 6;
export const MIN_COLORS = 1;
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

/** Parses a JSON-encoded colors field from form data; returns null on missing/invalid JSON. */
export function parseColors(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isValidColorPalette(colors: unknown): colors is string[] {
  return (
    Array.isArray(colors) &&
    colors.length >= MIN_COLORS &&
    colors.length <= MAX_COLORS &&
    colors.every((c) => typeof c === "string" && HEX_COLOR_PATTERN.test(c))
  );
}

/** Parses a manual layout offset field from form data; falls back on missing/invalid input. */
export function parseOffset(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-MAX_LAYOUT_OFFSET_MM, Math.min(MAX_LAYOUT_OFFSET_MM, n));
}

/** Sane bounds (mm) for Template.charTargetHeight/textTargetHeight — guards against a zero/negative/absurd render target. */
export const MIN_TARGET_HEIGHT_MM = 1;
export const MAX_TARGET_HEIGHT_MM = 100;

/** Parses a char/text target height field (mm) from form data; falls back on missing/invalid input. */
export function parseTargetHeight(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_TARGET_HEIGHT_MM, Math.min(MAX_TARGET_HEIGHT_MM, n));
}

/** Slider bounds (mm) for Template.dynamicGapX — matches CharacterTemplateForm.tsx's "Geser Jarak Teks (X)" range. */
export const MIN_DYNAMIC_GAP_X_MM = -20;
export const MAX_DYNAMIC_GAP_X_MM = 50;

/** Parses the dynamic-mode text horizontal gap field (mm) from form data; falls back on missing/invalid input. */
export function parseDynamicGapX(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_DYNAMIC_GAP_X_MM, Math.min(MAX_DYNAMIC_GAP_X_MM, n));
}

/** Slider bounds (mm) for Template.dynamicOffsetY — matches CharacterTemplateForm.tsx's "Geser Posisi Vertikal Teks (Y)" range. */
export const MIN_DYNAMIC_OFFSET_Y_MM = -30;
export const MAX_DYNAMIC_OFFSET_Y_MM = 30;

/** Parses the dynamic-mode text vertical offset field (mm) from form data; falls back on missing/invalid input. */
export function parseDynamicOffsetY(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_DYNAMIC_OFFSET_Y_MM, Math.min(MAX_DYNAMIC_OFFSET_Y_MM, n));
}

/** Parses the layoutMode field from form data; falls back on missing/invalid input. */
export function parseLayoutMode(
  raw: string | null,
  fallback: "dynamic" | "fixed" = "dynamic"
): "dynamic" | "fixed" {
  return raw === "dynamic" || raw === "fixed" ? raw : fallback;
}

/** Parses the hasHole checkbox field ("true"/"false") from form data; falls back on missing/invalid input. */
export function parseHasHole(raw: string | null, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

/** Parses a JSON-encoded customZones field from form data; returns null on missing/invalid JSON. */
export function parseCustomZones(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Parses a JSON-encoded letterOffsets field from form data; returns null on missing/invalid JSON. */
export function parseLetterOffsets(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const LETTER_KEY_PATTERN = /^[A-Z]$/;

export function isValidLetterOffsets(value: unknown): value is Record<string, { x?: number; y?: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return Object.entries(value as Record<string, unknown>).every(([letter, offset]) => {
    if (!LETTER_KEY_PATTERN.test(letter)) return false;
    if (!offset || typeof offset !== "object") return false;
    const o = offset as Record<string, unknown>;
    const validAxis = (n: unknown) =>
      n === undefined || (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_LAYOUT_OFFSET_MM);
    return validAxis(o.x) && validAxis(o.y);
  });
}

export function isValidCustomZones(value: unknown): value is CustomZone[] {
  if (!Array.isArray(value)) return false;
  return value.every((zone) => {
    if (!zone || typeof zone !== "object") return false;
    const z = zone as Record<string, unknown>;
    return (
      typeof z.id === "string" &&
      z.id.trim().length > 0 &&
      (z.type === "text" || z.type === "image") &&
      typeof z.x === "number" &&
      Number.isFinite(z.x) &&
      typeof z.y === "number" &&
      Number.isFinite(z.y) &&
      typeof z.width === "number" &&
      Number.isFinite(z.width) &&
      z.width > 0 &&
      typeof z.height === "number" &&
      Number.isFinite(z.height) &&
      z.height > 0
    );
  });
}

export interface SavedFile {
  absolutePath: string;
  publicPath: string;
  buffer: Buffer;
}

/** Writes an uploaded file under public/uploads/<subdir>/, returning its path and bytes. */
export async function saveUploadedFile(
  file: File,
  subdir: string,
  uniqueId: string
): Promise<SavedFile> {
  const ext = path.extname(file.name).toLowerCase();
  const dir = path.join(process.cwd(), "public", "uploads", subdir);
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${uniqueId}${ext}`;
  const absolutePath = path.join(dir, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absolutePath, buffer);
  return { absolutePath, publicPath: `/uploads/${subdir}/${fileName}`, buffer };
}

export async function readPublicFile(publicPath: string): Promise<Buffer> {
  return fs.readFile(path.join(process.cwd(), "public", publicPath));
}

export async function removePublicFile(publicPath: string | null | undefined): Promise<void> {
  if (!publicPath) return;
  await fs.rm(path.join(process.cwd(), "public", publicPath), { force: true }).catch(() => {});
}

/** A Buffer's `.buffer` may be a larger, pooled ArrayBuffer — slice to the exact view. */
export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
