import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { MAX_LAYOUT_OFFSET_MM } from "@/lib/keychain-geometry";

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
