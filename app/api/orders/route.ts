import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, templates, type NewOrderItem, type Template } from "@/lib/db/schema";
import { isUniqueConstraintError } from "@/lib/template-files";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface OrderItemPayload {
  id: number;
  templateId: number;
  templateCode: string | null;
  quantity: number;
  names: string[];
  thumbnailPath: string | null;
}

interface OrderPayload {
  id: number;
  receiptCode: string;
  manualCode: string | null;
  status: string;
  createdAt: string;
  items: OrderItemPayload[];
}

export async function GET() {
  const rows = await db
    .select({
      id: orders.id,
      receiptCode: orders.receiptCode,
      manualCode: orders.manualCode,
      status: orders.status,
      createdAt: orders.createdAt,
      itemId: orderItems.id,
      templateId: orderItems.templateId,
      quantity: orderItems.quantity,
      customerNames: orderItems.customerNames,
      templateCode: templates.code,
      thumbnailPath: templates.thumbnailPath,
    })
    .from(orders)
    .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
    .leftJoin(templates, eq(orderItems.templateId, templates.id))
    // Completed orders (a whole staging sheet marked done) are done for
    // good — they no longer belong in the active Input Pesanan queue.
    .where(ne(orders.status, "completed"))
    .orderBy(desc(orders.createdAt), orders.id, orderItems.id);

  const orderMap = new Map<number, OrderPayload>();

  for (const row of rows) {
    let order = orderMap.get(row.id);
    if (!order) {
      order = {
        id: row.id,
        receiptCode: row.receiptCode,
        manualCode: row.manualCode,
        status: row.status,
        createdAt: row.createdAt,
        items: [],
      };
      orderMap.set(row.id, order);
    }

    if (row.itemId !== null) {
      order.items.push({
        id: row.itemId,
        templateId: row.templateId!,
        templateCode: row.templateCode,
        quantity: row.quantity!,
        names: row.customerNames ?? [],
        thumbnailPath: row.thumbnailPath,
      });
    }
  }

  return NextResponse.json({ orders: [...orderMap.values()] });
}

interface IncomingItem {
  templateId: number;
  quantity: number;
  customerNames: string[];
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return badRequest("Data pesanan tidak valid");
  }

  const receiptCode = typeof body.receiptCode === "string" ? body.receiptCode.trim() : "";
  const manualCode = typeof body.manualCode === "string" ? body.manualCode.trim() : "";
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!receiptCode) {
    return badRequest("Kode resi harus diisi");
  }
  if (rawItems.length === 0) {
    return badRequest("Minimal satu item pesanan harus diisi");
  }

  const items: IncomingItem[] = [];
  for (const raw of rawItems) {
    const templateId = Number(raw?.templateId);
    const quantity = Number(raw?.quantity ?? 1);
    const customerNames = Array.isArray(raw?.customerNames)
      ? raw.customerNames
          .map((name: unknown) => (typeof name === "string" ? name.trim() : ""))
          .filter((name: string) => name.length > 0)
      : [];

    if (!Number.isInteger(templateId) || templateId <= 0) {
      return badRequest("Pilih template terlebih dahulu untuk setiap item");
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return badRequest("Jumlah pesanan minimal 1 untuk setiap item");
    }
    if (customerNames.length === 0) {
      return badRequest("Daftar nama tidak boleh kosong untuk setiap item");
    }

    items.push({ templateId, quantity, customerNames });
  }

  const templateIds = [...new Set(items.map((item) => item.templateId))];
  const templateRows = await db.select().from(templates).where(inArray(templates.id, templateIds));
  const templateMap = new Map<number, Template>(templateRows.map((t) => [t.id, t]));

  for (const item of items) {
    if (!templateMap.has(item.templateId)) {
      return badRequest(`Template dengan ID ${item.templateId} tidak ditemukan`, 404);
    }
  }

  try {
    const { order, insertedItems } = db.transaction((tx) => {
      const [insertedOrder] = tx
        .insert(orders)
        .values({
          receiptCode,
          manualCode: manualCode || null,
          status: "pending",
        })
        .returning()
        .all();

      const newItemRows: NewOrderItem[] = items.map((item) => ({
        orderId: insertedOrder.id,
        templateId: item.templateId,
        quantity: item.quantity,
        customerNames: item.customerNames,
      }));

      const insertedOrderItems = tx.insert(orderItems).values(newItemRows).returning().all();

      return { order: insertedOrder, insertedItems: insertedOrderItems };
    });

    const responseItems = insertedItems.map((item) => ({
      ...item,
      template: templateMap.get(item.templateId) ?? null,
    }));

    return NextResponse.json({ order: { ...order, items: responseItems } }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return badRequest("Kode resi sudah digunakan", 409);
    }
    return badRequest("Gagal menyimpan pesanan", 500);
  }
}
