import type { OrderQueueEntry, OrderStatus } from "@/lib/store/useTemplateStore";

/**
 * POST /api/orders embeds the full `template` object per item (and names
 * under `customerNames`), while GET /api/orders already returns the flatter
 * `templateCode`/`names`/`thumbnailPath` shape the store expects. This maps
 * either response into the one canonical `OrderQueueEntry` shape.
 */
interface RawOrderItem {
  id: number;
  templateId: number;
  quantity: number;
  customerNames?: string[];
  names?: string[];
  variant?: "keychain" | "pin";
  templateCode?: string | null;
  thumbnailPath?: string | null;
  template?: { code: string; thumbnailPath: string } | null;
}

interface RawOrder {
  id: number;
  receiptCode: string;
  manualCode: string | null;
  status: string;
  createdAt: string;
  items: RawOrderItem[];
}

export function toOrderQueueEntry(raw: RawOrder): OrderQueueEntry {
  return {
    id: raw.id,
    receiptCode: raw.receiptCode,
    manualCode: raw.manualCode,
    status: raw.status as OrderStatus,
    createdAt: raw.createdAt,
    items: raw.items.map((item) => ({
      id: item.id,
      templateId: item.templateId,
      templateCode: item.templateCode ?? item.template?.code ?? null,
      quantity: item.quantity,
      names: item.names ?? item.customerNames ?? [],
      variant: item.variant ?? "keychain",
      thumbnailPath: item.thumbnailPath ?? item.template?.thumbnailPath ?? null,
    })),
  };
}
