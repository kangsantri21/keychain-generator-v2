import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import path from "path";
import { db } from "@/lib/db";
import { orderItems, templates } from "@/lib/db/schema";
import { loadTemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import type { OrderItemPreviewPayload } from "@/lib/order-preview-types";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * "Preview Pesanan" modal support — renders the SAME production pipeline
 * (lib/render-dispatcher.ts, already used by GET /api/staging for the
 * Staging Area canvas) for one order item's first customer name, so the
 * modal shows the actual ready-to-cut output (contour, ring hole, colored
 * text) instead of a static admin-uploaded thumbnail.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId: itemIdRaw } = await params;
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(itemId)) {
    return badRequest("ID item pesanan tidak valid");
  }

  const [item] = await db.select().from(orderItems).where(eq(orderItems.id, itemId));
  if (!item) {
    return badRequest("Item pesanan tidak ditemukan", 404);
  }

  const [template] = await db.select().from(templates).where(eq(templates.id, item.templateId));

  const payload: OrderItemPreviewPayload = {
    itemId,
    names: item.customerNames,
    template: template
      ? {
          id: template.id,
          code: template.code,
          isCharacter: template.isCharacter,
          layoutMode: template.layoutMode,
          colors: template.colors,
          fontFileName: path.basename(template.filePath),
        }
      : null,
    render: null,
  };

  const firstName = item.customerNames[0];
  if (template && firstName) {
    try {
      const assets = await loadTemplateAssets(template);
      const holeOverride = item.holeOverrides?.[0] ?? null;
      payload.render = renderTemplateItem(assets, template, firstName, holeOverride);
    } catch {
      // Leave render null — the modal shows a "gagal merender" placeholder
      // instead of failing the whole preview over one bad name/font.
    }
  }

  return NextResponse.json(payload);
}
