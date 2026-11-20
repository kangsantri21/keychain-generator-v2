/**
 * Staging Area → lembar kerja.
 *
 * The button used to POST /api/staging/nest with no name list, so the route
 * always answered 400 and wrote nothing. The button now sends
 * STAGING_START_REQUEST; the route loads pending receipts and stages them
 * with Production Nesting.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { isStagingStartRequest, selectionsForPendingItems, STAGING_START_REQUEST } from "../staging-start";

const work = mkdtempSync(path.join(tmpdir(), "staging-start-"));
const dbPath = path.join(work, "test.sqlite");
process.env.DATABASE_URL = dbPath;

const fontPublic = `/uploads/staging-start-${process.pid}`;
const fontDir = path.join(process.cwd(), "public", fontPublic);

test("pending name list keeps indexes and skips blank names", () => {
  assert.deepEqual(
    selectionsForPendingItems([
      { itemId: 4, names: ["", "Sari", "  "] },
      { itemId: 9, names: ["Ani"] },
    ]),
    ["4:1", "9:0"]
  );
  assert.equal(isStagingStartRequest(STAGING_START_REQUEST), true);
  assert.equal(isStagingStartRequest({ selections: ["1:0"] }), false);
  assert.equal(isStagingStartRequest(null), false);
  assert.equal(STAGING_START_REQUEST.mode, "production-v3");
});

test("the Staging button posts the pending-receipt request, not an empty POST", () => {
  const page = readFileSync("app/staging-area/page.tsx", "utf8");
  const panel = readFileSync("components/staging-area/ControlPanel.tsx", "utf8");
  assert.match(page, /STAGING_START_REQUEST/);
  assert.match(page, /\/api\/staging\/nest/);
  assert.doesNotMatch(page, /fetch\("\/api\/staging\/nest", \{ method: "POST" \}\)/);
  assert.match(panel, /Mulai Susun Lembar Kerja/);
});

let db: typeof import("../db").db;
let schema: typeof import("../db/schema");
let POST: typeof import("../../app/api/staging/nest/route").POST;

before(async () => {
  mkdirSync(fontDir, { recursive: true });
  copyFileSync("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", path.join(fontDir, "font.ttf"));
  const sqlite = new Database(dbPath);
  migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  sqlite.close();
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ POST } = await import("../../app/api/staging/nest/route"));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(fontDir, { recursive: true, force: true });
});

function nestRequest(body?: unknown) {
  if (body === undefined) {
    return new NextRequest("http://localhost/api/staging/nest", { method: "POST" });
  }
  return new NextRequest("http://localhost/api/staging/nest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Staging start turns sample pending receipts into a worksheet", async () => {
  const [template] = await db
    .insert(schema.templates)
    .values({
      code: "FONT-STAGING",
      type: "ttf",
      filePath: `${fontPublic}/font.ttf`,
      thumbnailPath: `${fontPublic}/font.ttf`,
      colors: ["#111111"],
      isCharacter: false,
    })
    .returning();

  async function addOrder(receiptCode: string, status: string, names: string[]) {
    const [order] = await db.insert(schema.orders).values({ receiptCode, status }).returning();
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      templateId: template.id,
      quantity: names.length,
      customerNames: names,
      variant: "keychain",
    });
    return order;
  }

  const pendingA = await addOrder("RESI-A", "pending", ["Ani", "Budi"]);
  const pendingB = await addOrder("RESI-B", "pending", ["Citra"]);
  const pendingC = await addOrder("RESI-C", "pending", ["Dedi", "Eka"]);
  const pendingD = await addOrder("RESI-D", "pending", ["", "Sari"]);
  const pendingBlank = await addOrder("RESI-E", "pending", ["", "  "]);
  const alreadyProcessing = await addOrder("RESI-F", "processing", ["Jangan"]);
  const alreadyDone = await addOrder("RESI-G", "completed", ["Selesai"]);

  const empty = await POST(nestRequest());
  const emptyBody = await empty.json();
  assert.equal(empty.status, 400);
  assert.match(emptyBody.error, /Pilih minimal satu pesanan/);
  assert.equal((await db.select().from(schema.stagingItems)).length, 0);

  // The button asks for every pending receipt and does not send a name list.
  // Mode is omitted here on purpose: the server must still use Production Nesting.
  const started = await POST(nestRequest({ allPending: true }));
  const startedBody = await started.json();
  assert.equal(started.status, 200, JSON.stringify(startedBody));
  assert.equal(startedBody.engine, "production-v3");
  assert.equal(startedBody.packer, "SHAPE");
  assert.equal(startedBody.items, 6);
  assert.equal(startedBody.ordersProcessed, 4);
  assert.ok(startedBody.sheets >= 1);

  const staged = await db.select().from(schema.stagingItems);
  assert.equal(staged.length, 6);
  assert.deepEqual(
    staged.map((row) => row.customerName).sort(),
    ["Ani", "Budi", "Citra", "Dedi", "Eka", "Sari"]
  );
  assert.ok(staged.every((row) => row.status === "staged-shape"));
  assert.ok(staged.every((row) => row.rotationDeg === 0 || row.rotationDeg === 90 || row.rotationDeg === 180 || row.rotationDeg === 270));

  const sheetsByOrder = new Map<number, Set<number>>();
  for (const row of staged) {
    const sheets = sheetsByOrder.get(row.orderId) ?? new Set<number>();
    sheets.add(row.sheetId);
    sheetsByOrder.set(row.orderId, sheets);
  }
  for (const sheets of sheetsByOrder.values()) assert.equal(sheets.size, 1);

  const statusOf = async (id: number) => {
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    return row.status;
  };
  assert.equal(await statusOf(pendingA.id), "processing");
  assert.equal(await statusOf(pendingB.id), "processing");
  assert.equal(await statusOf(pendingC.id), "processing");
  assert.equal(await statusOf(pendingD.id), "processing");
  assert.equal(await statusOf(pendingBlank.id), "pending");
  assert.equal(await statusOf(alreadyProcessing.id), "processing");
  assert.equal(await statusOf(alreadyDone.id), "completed");

  const again = await POST(nestRequest(STAGING_START_REQUEST));
  const againBody = await again.json();
  assert.equal(again.status, 400);
  assert.match(againBody.error, /Tidak ada pesanan pending/);
  assert.equal((await db.select().from(schema.stagingItems)).length, 6);
});
