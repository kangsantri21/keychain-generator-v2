import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const templates = sqliteTable("templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  type: text("type").notNull(),
  filePath: text("file_path").notNull(),
  characterImagePath: text("character_image_path"),
  thumbnailPath: text("thumbnail_path").notNull(),
  colors: text("colors", { mode: "json" }).$type<string[]>().notNull(),
  defaultText: text("default_text").notNull().default("Nama"),
  isCharacter: integer("is_character", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptCode: text("receipt_code").notNull(),
  manualCode: text("manual_code").notNull(),
  templateId: integer("template_id")
    .notNull()
    .references(() => templates.id),
  quantity: integer("quantity").notNull().default(1),
  customerNames: text("customer_names", { mode: "json" }).$type<string[]>().notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export const stagingItems = sqliteTable("staging_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),
  templateId: integer("template_id")
    .notNull()
    .references(() => templates.id),
  // One order can hold several names; each nested unit needs to know which
  // name it renders, since that's what makes its cut outline/text unique.
  customerName: text("customer_name").notNull(),
  sheetId: integer("sheet_id").notNull(),
  posX: real("pos_x").notNull(),
  posY: real("pos_y").notNull(),
  width: real("width").notNull(),
  height: real("height").notNull(),
  status: text("status").notNull().default("staged"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type StagingItem = typeof stagingItems.$inferSelect;
export type NewStagingItem = typeof stagingItems.$inferInsert;
