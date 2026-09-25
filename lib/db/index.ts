import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as keychainSchema from "./schema";
import * as maharSchema from "./mahar-schema";

const sqlite = new Database(process.env.DATABASE_URL ?? "sqlite.db");
sqlite.pragma("journal_mode = WAL");

// One physical database/connection shared by both modules (keychain and
// "Bahan Mahar") — see mahar-schema.ts's own doc comment for why that's
// the right scope for "terpisah 100%" here (separate tables/schema/API/UI,
// not a separate server).
export const db = drizzle(sqlite, { schema: { ...keychainSchema, ...maharSchema } });
