import { create } from "zustand";
import type { Template } from "@/lib/db/schema";

export type OrderStatus = "pending" | "processing" | "completed";

export type PageKey =
  | "dashboard"
  | "master-template"
  | "input-pesanan"
  | "staging-area"
  | "file-siap-cetak";

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: "Dashboard",
  "master-template": "Master Template",
  "input-pesanan": "Input Pesanan",
  "staging-area": "Staging Area",
  "file-siap-cetak": "File Siap Cetak",
};

export const PAGE_ROUTES: Record<PageKey, string> = {
  dashboard: "/",
  "master-template": "/master-template",
  "input-pesanan": "/input-pesanan",
  "staging-area": "/staging-area",
  "file-siap-cetak": "/file-siap-cetak",
};

export interface OrderQueueItem {
  id: number;
  receiptCode: string;
  manualCode: string;
  templateId: number;
  quantity: number;
  customerNames: string[];
  status: OrderStatus;
  createdAt: string;
  template: Template | null;
}

interface TemplateStoreState {
  activePage: PageKey;
  setActivePage: (page: PageKey) => void;

  templates: Template[];
  setTemplates: (templates: Template[]) => void;
  addTemplate: (template: Template) => void;
  updateTemplate: (template: Template) => void;
  removeTemplate: (id: number) => void;

  orderQueue: OrderQueueItem[];
  activeOrderId: number | null;
  setOrderQueue: (orders: OrderQueueItem[]) => void;
  addToQueue: (order: OrderQueueItem) => void;
  updateQueueItem: (id: number, updates: Partial<OrderQueueItem>) => void;
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
