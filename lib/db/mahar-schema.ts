import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { MaharLayoutItem } from "@/lib/mahar-types";

/**
 * "Bahan Mahar" (wedding dowry display plaque) module — completely separate
 * from the Gantungan Kunci (keychain) module: its own tables, own schema
 * file, own API routes (app/api/mahar/*), own pages (/mahar-generator,
 * /mahar-nesting), no shared references to templates/orders/orderItems/
 * stagingItems/printBatches anywhere. Both modules share the same physical
 * sqlite.db (see lib/db/index.ts) and Next.js app shell, since neither the
 * feature request nor the existing project structure calls for a second
 * database/server — "terpisah 100%" is honored at the schema/module/UI
 * level, not by standing up an entirely separate backend.
 */

/**
 * One order for a single mahar piece. Unlike the keychain module's
 * orders/orderItems split (one receipt, many named line items), a mahar
 * order IS the unit: one bride/groom pair, one physical plaque. No staging
 * table exists on purpose - nesting (app/mahar-nesting/page.tsx) recomputes
 * a layout on demand from whichever "pending" rows are selected (the same
 * packMaxRects call, given the same input, always produces the same
 * layout - see lib/nesting.ts), and only a locked result is ever persisted,
 * into maharBatches below.
 */
export const maharOrders = sqliteTable("mahar_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  brideName: text("bride_name").notNull(),
  groomName: text("groom_name").notNull(),
  // Stored as plain text (not a real date column) to accept whatever format
  // the admin's HTML date input hands back (yyyy-mm-dd) without a parsing
  // round-trip - mirrors how every other timestamp-ish column in this
  // project (e.g. orders.createdAt) is also plain text.
  weddingDate: text("wedding_date").notNull(),
  // Free-form nominal/mahar text (e.g. "Rp 5.000.000" or "Lima Juta
  // Rupiah") - this is engraved/printed text, never a real computed amount.
  nominal: text("nominal").notNull(),
  // Cut-line shape for the plaque itself - see lib/mahar-geometry.ts's
  // MAHAR_FRAME_SHAPES for the fixed set of options the UI offers.
  frameShape: text("frame_shape").$type<"rectangle" | "oval" | "circle" | "hexagon">().notNull(),
  // One of lib/mahar-geometry.ts's MAHAR_SIZE_PRESETS labels (e.g.
  // "20x30 cm") - kept as the single free-text column the spec calls for,
  // with that preset table as the (admin-facing) source of the actual
  // width/height in mm nesting needs; see resolveMaharSizeMm.
  size: text("size").notNull(),
  status: text("status").$type<"pending" | "processing" | "completed">().notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type MaharOrder = typeof maharOrders.$inferSelect;
export type NewMaharOrder = typeof maharOrders.$inferInsert;

/**
 * A locked, permanent production record - mirrors the keychain module's own
 * printBatches (a frozen snapshot an operator can re-download forever,
 * regardless of what happens to the source maharOrders rows afterward).
 */
export const maharBatches = sqliteTable("mahar_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchCode: text("batch_code").notNull().unique(),
  layoutData: text("layout_data", { mode: "json" }).$type<MaharLayoutItem[]>().notNull(),
  canvasWidth: integer("canvas_width").notNull(),
  canvasHeight: integer("canvas_height").notNull(),
  status: text("status").$type<"pending" | "printed" | "archived">().notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

export type MaharBatch = typeof maharBatches.$inferSelect;
export type NewMaharBatch = typeof maharBatches.$inferInsert;
