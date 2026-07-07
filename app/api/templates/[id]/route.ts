import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { slugify } from "@/lib/utils";
import { generateCharacterPreviewSvg } from "@/lib/font-preview";
import {
  CHARACTER_EXTENSIONS,
  FONT_EXTENSIONS,
  THUMBNAIL_EXTENSIONS,
  MIN_COLORS,
  MAX_COLORS,
  badRequest,
  isUniqueConstraintError,
  parseColors,
  isValidColorPalette,
  saveUploadedFile,
  readPublicFile,
  removePublicFile,
  toArrayBuffer,
} from "@/lib/template-files";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const templateId = Number(id);

  if (!Number.isInteger(templateId)) {
    return badRequest("ID template tidak valid");
  }

  const [existing] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, templateId));

  if (!existing) {
    return badRequest("Template tidak ditemukan", 404);
  }

  await db.delete(templates).where(eq(templates.id, templateId));

  const relativePaths = new Set(
    [existing.filePath, existing.thumbnailPath, existing.characterImagePath].filter(
      (p): p is string => Boolean(p)
    )
  );
  await Promise.all(Array.from(relativePaths).map((relativePath) => removePublicFile(relativePath)));

  return NextResponse.json({ success: true });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const templateId = Number(id);

  if (!Number.isInteger(templateId)) {
    return badRequest("ID template tidak valid");
  }

  const [existing] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!existing) {
    return badRequest("Template tidak ditemukan", 404);
  }

  const formData = await request.formData();
  const code = (formData.get("code") as string | null)?.trim() ?? "";
  const fontFile = formData.get("file") as File | null;
  const characterImageFile = formData.get("characterImage") as File | null;
  const thumbnailImageFile = formData.get("thumbnailImage") as File | null;
  const colorsRaw = formData.get("colors") as string | null;
  const defaultTextRaw = (formData.get("defaultText") as string | null)?.trim();

  if (!code) {
    return badRequest("Kode template harus diisi");
  }

  const parsedColors = parseColors(colorsRaw);
  const colors = parsedColors ?? existing.colors;
  if (!isValidColorPalette(colors)) {
    return badRequest(`Jumlah warna harus antara ${MIN_COLORS} - ${MAX_COLORS}`);
  }

  const hasNewFont = Boolean(fontFile && fontFile.size > 0);
  const hasNewCharacterImage = existing.isCharacter && Boolean(characterImageFile && characterImageFile.size > 0);
  const hasNewThumbnail = !existing.isCharacter && Boolean(thumbnailImageFile && thumbnailImageFile.size > 0);

  if (hasNewFont) {
    const ext = path.extname(fontFile!.name).toLowerCase();
    if (!FONT_EXTENSIONS.includes(ext)) {
      return badRequest("File font harus berformat TTF atau OTF");
    }
  }
  if (hasNewCharacterImage) {
    const ext = path.extname(characterImageFile!.name).toLowerCase();
    if (!CHARACTER_EXTENSIONS.includes(ext)) {
      return badRequest("File karakter harus berformat SVG atau PNG");
    }
  }
  if (hasNewThumbnail) {
    const ext = path.extname(thumbnailImageFile!.name).toLowerCase();
    if (!THUMBNAIL_EXTENSIONS.includes(ext)) {
      return badRequest("File thumbnail harus berformat PNG atau JPG");
    }
  }

  const defaultText = existing.isCharacter ? defaultTextRaw || existing.defaultText : existing.defaultText;
  const uniqueId = `${slugify(code)}-${Date.now()}`;

  // Old files to remove once the DB update succeeds; new files to roll back if it doesn't.
  const staleFiles: (string | null)[] = [];
  const newFiles: string[] = [];

  try {
    let filePath = existing.filePath;
    let type = existing.type;
    let fontArrayBuffer: ArrayBuffer;

    if (hasNewFont) {
      const saved = await saveUploadedFile(fontFile!, "fonts", uniqueId);
      staleFiles.push(filePath);
      newFiles.push(saved.publicPath);
      filePath = saved.publicPath;
      type = path.extname(fontFile!.name).toLowerCase().slice(1);
      fontArrayBuffer = toArrayBuffer(saved.buffer);
    } else {
      fontArrayBuffer = toArrayBuffer(await readPublicFile(filePath));
    }

    let characterImagePath = existing.characterImagePath;
    let characterImageBuffer: Buffer | null = null;
    let characterExt = characterImagePath ? path.extname(characterImagePath).toLowerCase() : "";

    if (existing.isCharacter) {
      if (hasNewCharacterImage) {
        const saved = await saveUploadedFile(characterImageFile!, "characters", uniqueId);
        if (characterImagePath) staleFiles.push(characterImagePath);
        newFiles.push(saved.publicPath);
        characterImagePath = saved.publicPath;
        characterImageBuffer = saved.buffer;
        characterExt = path.extname(characterImageFile!.name).toLowerCase();
      } else if (characterImagePath) {
        characterImageBuffer = await readPublicFile(characterImagePath);
      }
    }

    let thumbnailPath = existing.thumbnailPath;

    if (existing.isCharacter && characterImageBuffer) {
      // Thumbnail is derived data — regenerate it so it stays in sync with the
      // (possibly changed) character image, font, colors, or default text.
      const svgMarkup = generateCharacterPreviewSvg(
        characterImageBuffer,
        characterExt,
        fontArrayBuffer,
        defaultText,
        colors
      );
      const thumbsDir = path.join(process.cwd(), "public", "uploads", "thumbnails");
      await fs.mkdir(thumbsDir, { recursive: true });
      const thumbFileName = `${uniqueId}.svg`;
      await fs.writeFile(path.join(thumbsDir, thumbFileName), svgMarkup);
      staleFiles.push(thumbnailPath);
      newFiles.push(`/uploads/thumbnails/${thumbFileName}`);
      thumbnailPath = `/uploads/thumbnails/${thumbFileName}`;
    } else if (hasNewThumbnail) {
      const saved = await saveUploadedFile(thumbnailImageFile!, "thumbnails", uniqueId);
      staleFiles.push(thumbnailPath);
      newFiles.push(saved.publicPath);
      thumbnailPath = saved.publicPath;
    }

    const [updated] = await db
      .update(templates)
      .set({ code, type, filePath, characterImagePath, thumbnailPath, colors, defaultText })
      .where(eq(templates.id, templateId))
      .returning();

    await Promise.all(staleFiles.map((p) => removePublicFile(p)));

    return NextResponse.json({ template: updated });
  } catch (error) {
    await Promise.all(newFiles.map((p) => removePublicFile(p)));

    if (isUniqueConstraintError(error)) {
      return badRequest("Kode template sudah digunakan", 409);
    }

    return badRequest("Gagal memperbarui template", 500);
  }
}
