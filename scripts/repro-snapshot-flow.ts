/**
 * Local check against Rofiq's snapshot. The database is NOT in git.
 *
 *   npx tsx scripts/repro-snapshot-flow.ts /tmp/lembar5/sqlite.db
 *
 * Copies the file, migrates it, times GET /api/staging, dismantles sheets
 * 2, 4 and 5, then nests every pending receipt. Prints counts and times only.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { NextRequest } from "next/server";

const source = process.argv[2] ?? "/tmp/lembar5/sqlite.db";
const dir = mkdtempSync(path.join(tmpdir(), "repro-snapshot-"));
const dbPath = path.join(dir, "sqlite.db");
copyFileSync(source, dbPath);

const sqlite = new Database(dbPath);
migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });

// The snapshot does not include template files. Point the COPY at a system
// font and drop missing artwork so this machine can still time a real nest.
// Rofiq's computer already has the real files; this substitution is local.
const standIn = "/uploads/fonts/repro-stand-in.ttf";
const standInAbs = path.join(process.cwd(), "public", standIn);
if (!existsSync(standInAbs)) {
  mkdirSync(path.dirname(standInAbs), { recursive: true });
  copyFileSync("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", standInAbs);
}
const templates = sqlite.prepare("SELECT id, file_path, character_image_path FROM templates").all() as {
  id: number;
  file_path: string;
  character_image_path: string | null;
}[];
for (const template of templates) {
  const fontAbs = path.join(process.cwd(), "public", template.file_path);
  if (!existsSync(fontAbs)) sqlite.prepare("UPDATE templates SET file_path = ? WHERE id = ?").run(standIn, template.id);
  if (template.character_image_path) {
    const artAbs = path.join(process.cwd(), "public", template.character_image_path);
    if (!existsSync(artAbs)) sqlite.prepare("UPDATE templates SET character_image_path = NULL WHERE id = ?").run(template.id);
  }
}

function counts(label: string) {
  const orders = sqlite.prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status").all() as { status: string; n: number }[];
  const sheets = sqlite
    .prepare("SELECT sheet_id, status, COUNT(*) n FROM staging_items GROUP BY sheet_id, status ORDER BY sheet_id")
    .all() as { sheet_id: number; status: string; n: number }[];
  const staging = sqlite.prepare("SELECT COUNT(*) n FROM staging_items").get() as { n: number };
  console.log(label, JSON.stringify({ orders, stagingRows: staging.n, sheets }));
}

counts("sebelum");
sqlite.close();

async function main(): Promise<void> {
rmSync(path.join(process.cwd(), ".cache", "keychain-render"), { recursive: true, force: true });
process.env.DATABASE_URL = dbPath;
const { GET } = await import("../app/api/staging/route");
const { DELETE } = await import("../app/api/staging/sheets/[sheetId]/route");
const { POST } = await import("../app/api/staging/nest/route");

async function timeGet(label: string) {
  const started = Date.now();
  const response = await GET(new NextRequest("http://localhost/api/staging"));
  const body = await response.json();
  const sheets = (body.sheets ?? []) as { items: unknown[] }[];
  const items = sheets.reduce((sum, sheet) => sum + sheet.items.length, 0);
  console.log(label, response.status, `${Date.now() - started} ms`, `${sheets.length} lembar`, `${items} keping`);
}

await timeGet("GET dingin");
await timeGet("GET hangat");

for (const sheetId of ["2", "4", "5"]) {
  const started = Date.now();
  const response = await DELETE(new NextRequest(`http://localhost/api/staging/sheets/${sheetId}`), {
    params: Promise.resolve({ sheetId }),
  });
  console.log(`bongkar #${sheetId}`, response.status, `${Date.now() - started} ms`);
}

const after = new Database(dbPath, { readonly: true });
const orders = after.prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status").all();
const sheets = after.prepare("SELECT sheet_id, status, COUNT(*) n FROM staging_items GROUP BY sheet_id, status ORDER BY sheet_id").all();
const staging = after.prepare("SELECT COUNT(*) n FROM staging_items").get();
console.log("sesudah bongkar", JSON.stringify({ orders, stagingRows: (staging as { n: number }).n, sheets }));
after.close();

const nestStarted = Date.now();
const nest = await POST(
  new NextRequest("http://localhost/api/staging/nest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ allPending: true, mode: "production-v3" }),
  })
);
const nestBody = await nest.json();
const failed = Array.isArray(nestBody.failed) ? nestBody.failed.length : 0;
const detail = Array.isArray(nestBody.details) ? nestBody.details.map((line: string) => line.replace(/[A-Za-z0-9]{5,}/g, "…")).slice(0, 8) : [];
console.log(
  "nest",
  nest.status,
  `${Date.now() - nestStarted} ms`,
  `keping ${nestBody.items ?? 0}`,
  `lembar ${nestBody.sheets ?? 0}`,
  `resi dilewati ${failed}`,
  JSON.stringify(detail)
);

const done = new Database(dbPath, { readonly: true });
console.log(
  "sesudah nest",
  JSON.stringify({
    orders: done.prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status").all(),
    stagingRows: (done.prepare("SELECT COUNT(*) n FROM staging_items").get() as { n: number }).n,
    sheets: done.prepare("SELECT sheet_id, COUNT(*) n FROM staging_items GROUP BY sheet_id").all(),
  })
);
done.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
