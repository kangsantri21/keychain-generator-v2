import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
