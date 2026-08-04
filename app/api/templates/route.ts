import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";
import { generateCharacterPreviewSvg } from "@/lib/font-preview";
import {
  parseOffset,
  parseLayoutMode,
  parseCustomZones,
  isValidCustomZones,
  parseTargetHeight,
} from "@/lib/template-files";
import { DEFAULT_CHAR_TARGET_HEIGHT_MM, DEFAULT_TEXT_TARGET_HEIGHT_MM } from "@/lib/keychain-geometry";

const CHARACTER_EXTENSIONS = [".svg", ".png"];
const FONT_EXTENSIONS = [".ttf", ".otf"];
const THUMBNAIL_EXTENSIONS = [".png", ".jpg", ".jpeg"];
const MAX_COLORS = 6;
const MIN_COLORS = 1;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  const rows = await db
    .select()
    .from(templates)
    .orderBy(desc(templates.createdAt));

  return NextResponse.json({ templates: rows });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const code = (formData.get("code") as string | null)?.trim() ?? "";
  const category = formData.get("category") as string | null; // "character" | "font"
  const fontFile = formData.get("file") as File | null;
  const characterImageFile = formData.get("characterImage") as File | null;
  const thumbnailImageFile = formData.get("thumbnailImage") as File | null;
  const coverThumbnailFile = formData.get("coverThumbnail") as File | null;
  const colorsRaw = formData.get("colors") as string | null;
  const defaultTextRaw = (formData.get("defaultText") as string | null)?.trim();
  const holeOffsetX = parseOffset(formData.get("holeOffsetX") as string | null, 0);
  const holeOffsetY = parseOffset(formData.get("holeOffsetY") as string | null, 0);
  const charTargetHeight = parseTargetHeight(
    formData.get("charTargetHeight") as string | null,
    DEFAULT_CHAR_TARGET_HEIGHT_MM
  );
  const textTargetHeight = parseTargetHeight(
    formData.get("textTargetHeight") as string | null,
    DEFAULT_TEXT_TARGET_HEIGHT_MM
  );
  // Manual text offsets were retired (they let letters overlap character
  // artwork) — layout is auto-computed again, so this always saves as 0.
  const textOffsetX = 0;
  const textOffsetY = 0;

  const layoutMode = parseLayoutMode(formData.get("layoutMode") as string | null);
  const customZonesRaw = formData.get("customZones") as string | null;
  let customZones = null;
  if (customZonesRaw) {
    const parsed = parseCustomZones(customZonesRaw);
    if (parsed === null) {
      return badRequest("Data zona kustomisasi tidak valid (bukan JSON yang benar)");
    }
    if (!isValidCustomZones(parsed)) {
      return badRequest("Data zona kustomisasi tidak valid");
    }
    customZones = parsed;
  }

  if (!code) {
    return badRequest("Kode template harus diisi");
  }

  if (category !== "character" && category !== "font") {
    return badRequest("Kategori template tidak valid");
  }

  if (!fontFile || fontFile.size === 0) {
    return badRequest("Pilih file font terlebih dahulu");
  }

  const fontExt = path.extname(fontFile.name).toLowerCase();
  if (!FONT_EXTENSIONS.includes(fontExt)) {
    return badRequest("File font harus berformat TTF atau OTF");
  }

  if (category === "character") {
    if (!characterImageFile || characterImageFile.size === 0) {
      return badRequest("Pilih file karakter terlebih dahulu");
    }
    const characterExt = path.extname(characterImageFile.name).toLowerCase();
    if (!CHARACTER_EXTENSIONS.includes(characterExt)) {
      return badRequest("File karakter harus berformat SVG atau PNG");
    }
  }

  if (category === "font") {
    if (!thumbnailImageFile || thumbnailImageFile.size === 0) {
      return badRequest("Pilih gambar preview/thumbnail terlebih dahulu");
    }
    const thumbnailExt = path.extname(thumbnailImageFile.name).toLowerCase();
    if (!THUMBNAIL_EXTENSIONS.includes(thumbnailExt)) {
      return badRequest("File thumbnail harus berformat PNG atau JPG");
    }
  }

  const hasCoverThumbnail = Boolean(coverThumbnailFile && coverThumbnailFile.size > 0);
  if (hasCoverThumbnail) {
    const coverExt = path.extname(coverThumbnailFile!.name).toLowerCase();
    if (!THUMBNAIL_EXTENSIONS.includes(coverExt)) {
      return badRequest("File cover/thumbnail katalog harus berformat PNG atau JPG");
    }
  }

  let colors: string[];
  try {
    colors = colorsRaw ? JSON.parse(colorsRaw) : [];
  } catch {
    return badRequest("Data warna tidak valid");
  }

  if (
    !Array.isArray(colors) ||
    colors.length < MIN_COLORS ||
    colors.length > MAX_COLORS ||
    colors.some((c) => typeof c !== "string" || !HEX_COLOR_PATTERN.test(c))
  ) {
    return badRequest(`Jumlah warna harus antara ${MIN_COLORS} - ${MAX_COLORS}`);
  }

  const defaultText = category === "character" ? defaultTextRaw || "Nama" : "Nama";

  const slug = slugify(code);
  const uniqueId = `${slug}-${Date.now()}`;

  const fontArrayBuffer = await fontFile.arrayBuffer();
  const fontBuffer = Buffer.from(fontArrayBuffer);
  const fontsDir = path.join(process.cwd(), "public", "uploads", "fonts");
  await fs.mkdir(fontsDir, { recursive: true });
  const fontFileName = `${uniqueId}${fontExt}`;
  const absoluteFontPath = path.join(fontsDir, fontFileName);
  await fs.writeFile(absoluteFontPath, fontBuffer);
  const publicFontPath = `/uploads/fonts/${fontFileName}`;

  let publicCharacterImagePath: string | null = null;
  let absoluteCharacterImagePath: string | null = null;
  let characterExt = "";
  let characterImageBuffer: Buffer | null = null;

  if (category === "character" && characterImageFile) {
    characterExt = path.extname(characterImageFile.name).toLowerCase();
    characterImageBuffer = Buffer.from(await characterImageFile.arrayBuffer());
    const charactersDir = path.join(process.cwd(), "public", "uploads", "characters");
    await fs.mkdir(charactersDir, { recursive: true });
    const characterFileName = `${uniqueId}${characterExt}`;
    absoluteCharacterImagePath = path.join(charactersDir, characterFileName);
    await fs.writeFile(absoluteCharacterImagePath, characterImageBuffer);
    publicCharacterImagePath = `/uploads/characters/${characterFileName}`;
  }

  const thumbsDir = path.join(process.cwd(), "public", "uploads", "thumbnails");
  await fs.mkdir(thumbsDir, { recursive: true });

  let absoluteThumbnailPath: string;
  let publicThumbnailPath: string;

  if (category === "character" && characterImageBuffer) {
    const thumbFileName = `${uniqueId}.svg`;
    absoluteThumbnailPath = path.join(thumbsDir, thumbFileName);
    const svgMarkup = generateCharacterPreviewSvg(
      characterImageBuffer,
      characterExt,
      fontArrayBuffer,
      defaultText,
      colors
    );
    await fs.writeFile(absoluteThumbnailPath, svgMarkup);
    publicThumbnailPath = `/uploads/thumbnails/${thumbFileName}`;
  } else {
    const thumbnailExt = path.extname(thumbnailImageFile!.name).toLowerCase();
    const thumbFileName = `${uniqueId}${thumbnailExt}`;
    absoluteThumbnailPath = path.join(thumbsDir, thumbFileName);
    await fs.writeFile(absoluteThumbnailPath, Buffer.from(await thumbnailImageFile!.arrayBuffer()));
    publicThumbnailPath = `/uploads/thumbnails/${thumbFileName}`;
  }

  let publicCoverThumbnailPath: string | null = null;
  let absoluteCoverThumbnailPath: string | null = null;

  if (hasCoverThumbnail) {
    const coverExt = path.extname(coverThumbnailFile!.name).toLowerCase();
    const coversDir = path.join(process.cwd(), "public", "uploads", "covers");
    await fs.mkdir(coversDir, { recursive: true });
    const coverFileName = `${uniqueId}${coverExt}`;
    absoluteCoverThumbnailPath = path.join(coversDir, coverFileName);
    await fs.writeFile(absoluteCoverThumbnailPath, Buffer.from(await coverThumbnailFile!.arrayBuffer()));
    publicCoverThumbnailPath = `/uploads/covers/${coverFileName}`;
  }

  try {
    const [created] = await db
      .insert(templates)
      .values({
        code,
        type: fontExt.slice(1),
        filePath: publicFontPath,
        characterImagePath: publicCharacterImagePath,
        thumbnailPath: publicThumbnailPath,
        thumbnailUrl: publicCoverThumbnailPath,
        colors,
        defaultText,
        isCharacter: category === "character",
        holeOffsetX,
        holeOffsetY,
        textOffsetX,
        textOffsetY,
        layoutMode,
        customZones,
        charTargetHeight,
        textTargetHeight,
      })
      .returning();

    return NextResponse.json({ template: created }, { status: 201 });
  } catch (error) {
    await fs.rm(absoluteFontPath, { force: true });
    if (absoluteCharacterImagePath) {
      await fs.rm(absoluteCharacterImagePath, { force: true });
    }
    await fs.rm(absoluteThumbnailPath, { force: true });
    if (absoluteCoverThumbnailPath) {
      await fs.rm(absoluteCoverThumbnailPath, { force: true });
    }

    if (isUniqueConstraintError(error)) {
      return badRequest("Kode template sudah digunakan", 409);
    }

    return badRequest("Gagal menyimpan template", 500);
  }
}
