import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import {
  DEFAULT_CHAR_TARGET_HEIGHT_MM,
  DEFAULT_TEXT_TARGET_HEIGHT_MM,
  WELD_CLEARANCE_MM,
} from "@/lib/keychain-geometry";
import type { StagingItemPayload } from "@/lib/staging-types";

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

/** A single per-letter ring-hole nudge (mm), keyed by uppercase A-Z — see Template.letterOffsets below. */
export interface LetterOffset {
  x?: number;
  y?: number;
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
  // Whether this template gets a keyring ring hole at all — off for
  // products that don't hang from a ring (e.g. flat stick-on acrylic
  // pins). Defaults to true so every pre-existing template (all of which
  // implicitly had a hole) keeps rendering exactly as before with no
  // migration backfill needed.
  hasHole: integer("has_hole", { mode: "boolean" }).notNull().default(true),
  holeOffsetX: real("hole_offset_x").notNull().default(0),
  holeOffsetY: real("hole_offset_y").notNull().default(0),
  textOffsetX: real("text_offset_x").notNull().default(0),
  textOffsetY: real("text_offset_y").notNull().default(0),
  // Text-only ("Custom Nama") ring-hole pipeline only (lib/keychain-
  // render.ts) — a per-letter correction on top of the automatic
  // contour-anchored placement (minX/midY), keyed by the rendered name's
  // own first letter, uppercased. Added because the automatic midY (the
  // first letter's own dilated contour, vertically centered) still landed
  // visually low on bubble/script fonts, whose glyph bounding boxes for
  // letters like "J"/"A"/"V" aren't centered around the letterform's own
  // visual weight (a tail, a diagonal stroke) the way a geometric midpoint
  // assumes. Null/missing letter key = no correction, use the fully
  // automatic (minX, midY) placement as-is.
  letterOffsets: text("letter_offsets", { mode: "json" }).$type<Record<string, LetterOffset> | null>(),
  // "dynamic"-only production spec: the *finished* (post-clipper) cutting
  // height, in mm, each node is independently scaled to hit — see
  // lib/keychain-render.ts. Replaces the old single shared TEXT_CUT_HEIGHT_MM
  // constant now that character artwork and name text scale independently
  // instead of together under one uniformScale.
  charTargetHeight: real("char_target_height").notNull().default(DEFAULT_CHAR_TARGET_HEIGHT_MM),
  textTargetHeight: real("text_target_height").notNull().default(DEFAULT_TEXT_TARGET_HEIGHT_MM),
  // "dynamic"-only, isCharacter-only: per-template manual control over the
  // name text's placement relative to the character's auto-computed outline
  // (lib/keychain-render.ts) — a different, narrower feature than the
  // retired textOffsetX/textOffsetY above (which let text drift freely
  // enough to overlap the character artwork and was disabled for that
  // reason). dynamicGapX is the horizontal gap between the character's
  // bounding box and the text's start (replacing the fixed WELD_CLEARANCE_MM
  // gap for characters with a real computed outline); default matches
  // WELD_CLEARANCE_MM exactly so every pre-existing row keeps the identical
  // weld behavior it already has. dynamicOffsetY nudges the text vertically
  // away from dead-center against the character; default 0 keeps today's
  // exact centering. Both are re-unioned by Clipper live on every change —
  // an admin can visually verify text never overlaps the artwork before
  // saving, unlike the old retired offsets.
  dynamicGapX: real("dynamic_gap_x").notNull().default(WELD_CLEARANCE_MM),
  dynamicOffsetY: real("dynamic_offset_y").notNull().default(0),
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

// A locked, permanent production record — the "Jalur Pabrik" archive a
// Staging Area sheet becomes once "Kunci & Simpan Batch Produksi" is
// submitted. `layoutData` is a frozen array of StagingItemPayload
// (lib/staging-types.ts) — already fully rendered (outline paths, text
// glyph segments, embedded character image data URIs) at lock time, so
// File Siap Cetak can regenerate DXF/print JPGs from it forever without
// re-querying live orders/templates that may since have changed or been
// deleted.
export const printBatches = sqliteTable("print_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchCode: text("batch_code").notNull().unique(),
  layoutData: text("layout_data", { mode: "json" }).$type<StagingItemPayload[]>().notNull(),
  canvasWidth: integer("canvas_width").notNull(),
  canvasHeight: integer("canvas_height").notNull(),
  status: text("status").$type<"pending" | "printed" | "archived">().notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

export type PrintBatch = typeof printBatches.$inferSelect;
export type NewPrintBatch = typeof printBatches.$inferInsert;

/** A single manual ring-hole nudge (mm), on top of whatever the automatic dynamic-anchor placement already computed — see lib/keychain-render.ts. */
export interface HoleOverride {
  x: number;
  y: number;
}

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
  // Product form for this line item — drives which physical output the
  // nesting/print pipeline produces. Defaults to "keychain" so every
  // pre-existing row (all of which were keychains before pins existed)
  // keeps working unchanged with no migration backfill needed.
  variant: text("variant").$type<"keychain" | "pin">().notNull().default("keychain"),
  // Best-effort back-reference to the batch this item's names were archived
  // into (set when a staged unit matching this item's orderId+templateId is
  // locked — see app/api/print-batches/route.ts). Since one order item can
  // in principle have its names split across separate nesting runs/batches,
  // this points at whichever batch locked it MOST RECENTLY — layoutData on
  // printBatches remains the actual source of truth for what's in a batch.
  batchId: integer("batch_id").references(() => printBatches.id),
  // Per-name manual ring-hole nudge, keyed by index into customerNames — set
  // via the Order Queue's "Edit Lubang" modal for one troublesome name whose
  // particular glyph shapes still leave the fully-automatic dynamic-anchor
  // placement (lib/keychain-render.ts) somewhere visually awkward. Missing
  // key (or null) = no override, use the automatic placement as-is. Only
  // editable while the parent order is still "pending" (see
  // app/api/order-items/[itemId]/hole-override/route.ts) — snapshotted onto
  // stagingItems.holeOverrideX/Y at nest/append time so a later edit here
  // can never retroactively perturb a layout already sent to an operator.
  holeOverrides: text("hole_overrides", { mode: "json" }).$type<Record<number, HoleOverride> | null>(),
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
  // True when the on-sheet box is the artwork turned a quarter turn (90° or 270°).
  // width/height above are the ON-SHEET footprint. 180° keeps this false
  // because the box does not change; the real angle is `rotationDeg`.
  rotated: integer("rotated", { mode: "boolean" }).notNull().default(false),
  // 0, 90, 180 or 270. Null on rows staged before shape-block nesting:
  // readers then treat `rotated` as 90° and otherwise 0°.
  rotationDeg: integer("rotation_deg"),
  // Both null on a whole receipt. Set together only when the shape packer
  // split a receipt that did not fit one sheet: part 1..count. Old rows
  // stay null and are still rejected if the same receipt sits on two sheets.
  // Feature D (lock one part) reads these before marking the order completed.
  splitPart: integer("split_part"),
  splitCount: integer("split_count"),
  // 1 = this piece's sheet is locked (Tandai Selesai). The layout status
  // ("staged-shape" and the others) stays, so Buka Kunci can return the
  // sheet to the active list. Kunci batch removes the row instead and
  // keeps the piece in print_batches. Old rows with status "completed"
  // are backfilled to 1 by 0019_part_done.
  partDone: integer("part_done", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("staged"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  // Frozen snapshot of orderItems.holeOverrides[nameIndex] at the moment
  // this unit was nested (app/api/staging/nest/route.ts and .../append/
  // route.ts) — null when no override was set for that name. Read back by
  // GET /api/staging (and therefore DXF/print export) instead of the live
  // orderItems row, so a later edit to the order can never silently move a
  // hole on something already staged.
  holeOverrideX: real("hole_override_x"),
  holeOverrideY: real("hole_override_y"),
});

export type StagingItem = typeof stagingItems.$inferSelect;
export type NewStagingItem = typeof stagingItems.$inferInsert;
