import { create } from "zustand";
import type { Template } from "@/lib/db/schema";

export type OrderStatus = "pending" | "processing" | "completed";

export type PageKey =
  | "dashboard"
  | "master-template"
  | "input-pesanan"
  | "order-queue"
  | "staging-area"
  | "file-siap-cetak"
  | "mahar-generator"
  | "mahar-nesting";

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  "master-template": "Master Template",
  "input-pesanan": "Input Pesanan",
  "order-queue": "Antrean Pesanan",
  "staging-area": "Staging Area",
  "file-siap-cetak": "File Siap Cetak",
  "mahar-generator": "Mahar Generator",
  "mahar-nesting": "Mahar Nesting",
};

export const PAGE_ROUTES: Record<PageKey, string> = {
  dashboard: "/",
  "master-template": "/master-template",
  "input-pesanan": "/input-pesanan",
  "order-queue": "/order-queue",
  "staging-area": "/staging-area",
  "file-siap-cetak": "/file-siap-cetak",
  "mahar-generator": "/mahar-generator",
  "mahar-nesting": "/mahar-nesting",
};

/** One template+names line within a receipt (mirrors an order_items row). */
export type OrderItemVariant = "keychain" | "pin";

/** Manual ring-hole nudge (mm), on top of the automatic placement — see lib/keychain-render.ts. */
export interface HoleOverride {
  x: number;
  y: number;
}

export interface OrderQueueLineItem {
  id: number;
  templateId: number;
  templateCode: string | null;
  quantity: number;
  names: string[];
  variant: OrderItemVariant;
  thumbnailPath: string | null;
  /** Keyed by index into `names` — see app/api/order-items/[itemId]/hole-override/route.ts. */
  holeOverrides: Record<number, HoleOverride> | null;
}

/** One receipt (order header) with its nested template line items. */
export interface OrderQueueEntry {
  id: number;
  receiptCode: string;
  manualCode: string | null;
  status: OrderStatus;
  createdAt: string;
  items: OrderQueueLineItem[];
}

interface TemplateStoreState {
  activePage: PageKey;
  setActivePage: (page: PageKey) => void;

  templates: Template[];
  setTemplates: (templates: Template[]) => void;
  addTemplate: (template: Template) => void;
  updateTemplate: (template: Template) => void;
  removeTemplate: (id: number) => void;

  orderQueue: OrderQueueEntry[];
  activeOrderId: number | null;
  setOrderQueue: (orders: OrderQueueEntry[]) => void;
  addToQueue: (order: OrderQueueEntry) => void;
  updateQueueItem: (id: number, updates: Partial<OrderQueueEntry>) => void;
  removeFromQueue: (id: number) => void;
  setActiveOrderId: (id: number | null) => void;
}

export const useTemplateStore = create<TemplateStoreState>((set) => ({
  activePage: "dashboard",
  setActivePage: (page) => set({ activePage: page }),

  templates: [],
  setTemplates: (templates) => set({ templates }),
  addTemplate: (template) =>
    set((state) => ({ templates: [...state.templates, template] })),
  updateTemplate: (template) =>
    set((state) => ({
      templates: state.templates.map((t) => (t.id === template.id ? template : t)),
    })),
  removeTemplate: (id) =>
    set((state) => ({ templates: state.templates.filter((t) => t.id !== id) })),

  orderQueue: [],
  activeOrderId: null,
  setOrderQueue: (orderQueue) => set({ orderQueue }),
  addToQueue: (order) =>
    set((state) => ({ orderQueue: [order, ...state.orderQueue] })),
  updateQueueItem: (id, updates) =>
    set((state) => ({
      orderQueue: state.orderQueue.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
    })),
  removeFromQueue: (id) =>
    set((state) => ({
      orderQueue: state.orderQueue.filter((o) => o.id !== id),
      activeOrderId: state.activeOrderId === id ? null : state.activeOrderId,
    })),
  setActiveOrderId: (activeOrderId) => set({ activeOrderId }),
}));
