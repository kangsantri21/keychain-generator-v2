import type { KeychainRenderPayload } from "@/lib/staging-types";

/** GET /api/order-items/[itemId]/preview's response shape — shared by the route handler and the "Preview Pesanan" modal (components/input-pesanan/RecentOrdersList.tsx) that consumes it. */
export interface OrderItemPreviewPayload {
  itemId: number;
  names: string[];
  template: {
    id: number;
    code: string;
    isCharacter: boolean;
    layoutMode: "dynamic" | "fixed";
    colors: string[];
    fontFileName: string;
  } | null;
  /** Rendered for `names[0]` only — a representative sample, not one per name. */
  render: KeychainRenderPayload | null;
}
