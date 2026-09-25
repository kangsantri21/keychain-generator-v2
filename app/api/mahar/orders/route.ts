import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { maharOrders, type NewMaharOrder } from "@/lib/db/mahar-schema";
import { MAHAR_FRAME_SHAPES, MAHAR_SIZE_PRESETS } from "@/lib/mahar-geometry";
import type { MaharFrameShape, MaharStatus } from "@/lib/mahar-types";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const VALID_FRAME_SHAPES = new Set(MAHAR_FRAME_SHAPES.map((s) => s.value));
const VALID_STATUSES = new Set<MaharStatus>(["pending", "processing", "completed"]);
const CUSTOM_SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i;

function isValidSize(size: string): boolean {
  return MAHAR_SIZE_PRESETS.some((p) => p.label === size) || CUSTOM_SIZE_PATTERN.test(size.trim());
}

/**
 * `?status=pending` (used by /mahar-nesting's queue) returns only that
 * status exactly; with no filter, returns everything except "completed"
 * (used by /mahar-generator's recent-orders list) — mirrors the keychain
 * module's GET /api/orders convention.
 */
export async function GET(request: NextRequest) {
  const statusParam = new URL(request.url).searchParams.get("status");
  const status = statusParam && VALID_STATUSES.has(statusParam as MaharStatus) ? (statusParam as MaharStatus) : null;

  const rows = await db
    .select()
    .from(maharOrders)
    .where(status ? eq(maharOrders.status, status) : ne(maharOrders.status, "completed"))
    .orderBy(desc(maharOrders.createdAt));

  return NextResponse.json({ orders: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return badRequest("Data pesanan mahar tidak valid");
  }

  const brideName = typeof body.brideName === "string" ? body.brideName.trim() : "";
  const groomName = typeof body.groomName === "string" ? body.groomName.trim() : "";
  const weddingDate = typeof body.weddingDate === "string" ? body.weddingDate.trim() : "";
  const nominal = typeof body.nominal === "string" ? body.nominal.trim() : "";
  const frameShape = typeof body.frameShape === "string" ? body.frameShape : "";
  const size = typeof body.size === "string" ? body.size.trim() : "";

  if (!brideName) return badRequest("Nama mempelai wanita harus diisi");
  if (!groomName) return badRequest("Nama mempelai pria harus diisi");
  if (!weddingDate) return badRequest("Tanggal pernikahan harus diisi");
  if (!nominal) return badRequest("Nominal/mahar harus diisi");
  if (!VALID_FRAME_SHAPES.has(frameShape as MaharFrameShape)) {
    return badRequest("Bentuk frame tidak valid");
  }
  if (!isValidSize(size)) {
    return badRequest("Ukuran tidak valid — pilih salah satu preset atau format \"LEBARxTINGGI\" (mm)");
  }

  const values: NewMaharOrder = {
    brideName,
    groomName,
    weddingDate,
    nominal,
    frameShape: frameShape as MaharFrameShape,
    size,
    status: "pending",
  };

  const [created] = await db.insert(maharOrders).values(values).returning();
  return NextResponse.json({ order: created }, { status: 201 });
}
