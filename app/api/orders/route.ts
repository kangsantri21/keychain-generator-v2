import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, templates } from "@/lib/db/schema";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const rows = await db
    .select({
      id: orders.id,
      receiptCode: orders.receiptCode,
      manualCode: orders.manualCode,
      templateId: orders.templateId,
      quantity: orders.quantity,
      customerNames: orders.customerNames,
      status: orders.status,
      createdAt: orders.createdAt,
      template: templates,
    })
    .from(orders)
    .leftJoin(templates, eq(orders.templateId, templates.id))
    .orderBy(desc(orders.createdAt));

  return NextResponse.json({ orders: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return badRequest("Data pesanan tidak valid");
  }

  const receiptCode = typeof body.receiptCode === "string" ? body.receiptCode.trim() : "";
  const manualCode = typeof body.manualCode === "string" ? body.manualCode.trim() : "";
  const templateId = Number(body.templateId);
  const quantity = Number(body.quantity);
  const customerNames = Array.isArray(body.customerNames)
    ? body.customerNames
        .map((name: unknown) => (typeof name === "string" ? name.trim() : ""))
        .filter((name: string) => name.length > 0)
    : [];

  if (!receiptCode) {
    return badRequest("Kode resi harus diisi");
  }
  if (!manualCode) {
    return badRequest("Kode manual harus diisi");
  }
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return badRequest("Pilih template terlebih dahulu");
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return badRequest("Jumlah pesanan minimal 1");
  }
  if (customerNames.length === 0) {
    return badRequest("Daftar nama tidak boleh kosong");
  }

  const [template] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!template) {
    return badRequest("Template tidak ditemukan", 404);
  }

  const [created] = await db
    .insert(orders)
    .values({
      receiptCode,
      manualCode,
      templateId,
      quantity,
      customerNames,
      status: "pending",
    })
    .returning();

  return NextResponse.json({ order: { ...created, template } }, { status: 201 });
}
