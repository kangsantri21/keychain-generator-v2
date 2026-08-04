import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { DEFAULT_CHAR_TARGET_HEIGHT_MM, DEFAULT_TEXT_TARGET_HEIGHT_MM } from "@/lib/keychain-geometry";

/**
 * A named placement zone inside a "fixed" layoutMode template's own master
 * SVG (which already carries its own final, paten cut-line) — x/y/width/
 * height are in mm, in that source SVG's own coordinate space. `type`
 * determines whether the fixed-shape renderer (lib/keychain-render-fixed.ts)
 * auto-shrinks a name's text into the zone, or fits/masks an uploaded photo
 * into it. Only meaningful when the owning Template's layoutMode is "fixed".
 */
export interface CustomZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "text" | "image";
}

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
  // "dynamic" (default, existing behavior): lib/keychain-render.ts's
  // clipper/font auto-layout engine computes the cut-line at render time —
  // untouched by the Fixed-Shape Template product line below. "fixed": the
  // template's own master SVG already carries its final cut-line; the
  // renderer only fits text/images into customZones, never recomputing the
  // outline. Defaults to "dynamic" so every pre-existing row keeps working
  // unchanged with no migration backfill needed.
  layoutMode: text("layout_mode").$type<"dynamic" | "fixed">().notNull().default("dynamic"),
  // Only populated (and only meaningful) when layoutMode is "fixed" — see
  // the CustomZone doc comment above.
  customZones: text("custom_zones", { mode: "json" }).$type<CustomZone[] | null>(),
  // Manual layout tweaks (mm, real-world scale) for character templates whose
  // irregular silhouette makes the static auto-layout imperfect — nudges the
  // ring hole and name text away from the auto-computed position. Zero means
  // "use the auto layout as-is".
  holeOffsetX: real("hole_offset_x").notNull().default(0),
  holeOffsetY: real("hole_offset_y").notNull().default(0),
  textOffsetX: real("text_offset_x").notNull().default(0),
  textOffsetY: real("text_offset_y").notNull().default(0),
  // "dynamic"-only production spec: the *finished* (post-clipper) cutting
  // height, in mm, each node is independently scaled to hit — see
  // lib/keychain-render.ts. Replaces the old single shared TEXT_CUT_HEIGHT_MM
  // constant now that character artwork and name text scale independently
  // instead of together under one uniformScale.
  charTargetHeight: real("char_target_height").notNull().default(DEFAULT_CHAR_TARGET_HEIGHT_MM),
  textTargetHeight: real("text_target_height").notNull().default(DEFAULT_TEXT_TARGET_HEIGHT_MM),
  // Optional admin-uploaded cover image for the Master Template catalog grid
  // (components/master-template/TemplateGallery.tsx) — a plain flat photo,
  // distinct from thumbnailPath (which for character templates is a
  // generated composite SVG of the character + colored name text, prone to
  // looking cluttered at small grid sizes). Null falls back to thumbnailPath.
  thumbnailUrl: text("thumbnail_url"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

// Header: one row per receipt. Line items (template + names) live in orderItems.
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptCode: text("receipt_code").notNull().unique(),
  manualCode: text("manual_code"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

// Detail: a receipt can bundle several templates, each with its own names.
export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  templateId: integer("template_id")
    .notNull()
    .references(() => templates.id),
  quantity: integer("quantity").notNull().default(1),
  customerNames: text("customer_names", { mode: "json" }).$type<string[]>().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

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
  // True if the packer rotated this item 90deg to fit a tight gap. width/height
  // above stay the item's own (pre-rotation) size — renderers must swap them
  // and rotate the drawn content to match the packer's actual footprint.
  rotated: integer("rotated", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("staged"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export type StagingItem = typeof stagingItems.$inferSelect;
export type NewStagingItem = typeof stagingItems.$inferInsert;
