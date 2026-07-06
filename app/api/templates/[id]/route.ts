import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const templateId = Number(id);

  if (!Number.isInteger(templateId)) {
    return NextResponse.json({ error: "ID template tidak valid" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, templateId));

  if (!existing) {
    return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
  }

  await db.delete(templates).where(eq(templates.id, templateId));

  const relativePaths = new Set(
    [existing.filePath, existing.thumbnailPath, existing.characterImagePath].filter(
      (p): p is string => Boolean(p)
    )
  );
  await Promise.all(
    Array.from(relativePaths).map((relativePath) =>
      fs.rm(path.join(process.cwd(), "public", relativePath), { force: true }).catch(() => {})
    )
  );

  return NextResponse.json({ success: true });
}
