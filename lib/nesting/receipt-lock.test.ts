/**
 * Feature D — lock one part of a receipt.
 *
 * A whole receipt on one sheet finishes when that sheet is locked.
 * A split receipt finishes only after every part is locked; one part shows
 * "1/2 bagian selesai". Dismantling or unlocking one part does not finish
 * the receipt and does not send it back to pending while another part remains.
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
import { openSheetsBlockingLock, receiptLockView, sheetSplitBadge, splitPiecesToRestore } from "@/lib/receipt-lock";

const work = mkdtempSync(path.join(tmpdir(), "receipt-lock-"));
const dbPath = path.join(work, "test.sqlite");
process.env.DATABASE_URL = dbPath;

const fontPublic = `/uploads/receipt-lock-${process.pid}`;
const fontDir = path.join(process.cwd(), "public", fontPublic);

const piece = (
  orderId: number,
  sheetId: number,
  locked: boolean,
  splitPart: number | null = null,
  splitCount: number | null = null
) => ({ orderId, sheetId, splitPart, splitCount, locked });

test("a whole receipt finishes only when its sheet is locked", () => {
  assert.equal(receiptLockView([]).status, "pending");
  assert.equal(receiptLockView([piece(1, 1, false)]).status, "processing");
  assert.equal(receiptLockView([piece(1, 1, false)]).progressLabel, null);
  assert.equal(receiptLockView([piece(1, 1, true)]).status, "completed");
  assert.equal(receiptLockView([piece(1, 1, true), piece(1, 1, false)]).status, "processing");
});

test("a split receipt finishes one part at a time and cannot finish early", () => {
  const partial = receiptLockView([piece(1, 1, true, 1, 2), piece(1, 2, false, 2, 2)]);
  assert.equal(partial.status, "processing");
  assert.equal(partial.progressLabel, "1/2 bagian selesai");
  assert.equal(partial.doneParts, 1);

  const done = receiptLockView([piece(1, 1, true, 1, 2), piece(1, 2, true, 2, 2)]);
  assert.equal(done.status, "completed");
  assert.equal(done.progressLabel, null);

  const missing = receiptLockView([piece(1, 1, true, 1, 2)]);
  assert.equal(missing.status, "processing");
  assert.notEqual(missing.status, "completed");
  assert.equal(missing.progressLabel, "1/2 bagian selesai");

  const dismantled = receiptLockView([piece(1, 2, false, 2, 2)]);
  assert.equal(dismantled.status, "processing");
  assert.equal(dismantled.progressLabel, null);

  const opened = receiptLockView([piece(1, 1, false, 1, 2), piece(1, 2, false, 2, 2)]);
  assert.equal(opened.status, "processing");
  assert.equal(opened.progressLabel, null);
});

test("another open sheet blocks a lock unless the parts are an authorized split", () => {
  const onSheet = [{ orderId: 7, sheetId: 1, splitPart: 1, splitCount: 2 }];
  assert.deepEqual(openSheetsBlockingLock(onSheet, []), []);
  assert.deepEqual(
    openSheetsBlockingLock(onSheet, [{ orderId: 7, sheetId: 2, splitPart: 2, splitCount: 2 }]),
    []
  );
  assert.deepEqual(
    openSheetsBlockingLock(
      [{ orderId: 7, sheetId: 1, splitPart: null, splitCount: null }],
      [{ orderId: 7, sheetId: 2, splitPart: null, splitCount: null }]
    ),
    [7]
  );
  assert.deepEqual(
    openSheetsBlockingLock(onSheet, [{ orderId: 7, sheetId: 2, splitPart: 1, splitCount: 2 }]),
    [7]
  );
});

test("sheet badge and batch restore only apply to a real split", () => {
  assert.equal(sheetSplitBadge([{ splitPart: 1, splitCount: 2 }, { splitPart: 1, splitCount: 2 }]), "1/2");
  assert.equal(sheetSplitBadge([{ splitPart: null, splitCount: null }]), null);
  const restored = splitPiecesToRestore([
    {
      orderId: 3,
      templateId: 4,
      customerName: "Ani",
      sheetId: 8,
      posX: 40,
      posY: 40,
      width: 30,
      height: 20,
      rotated: false,
      splitPart: 2,
      splitCount: 2,
      status: "staged-production",
    },
  ]);
  assert.ok(!("error" in restored));
  if (!("error" in restored)) assert.equal(restored.pieces.length, 1);
  assert.deepEqual(splitPiecesToRestore([{ orderId: 3, templateId: 4, customerName: "Ani", sheetId: 1, posX: 1, posY: 1, width: 1, height: 1 }]), {
    pieces: [],
  });

  const queue = readFileSync("app/order-queue/page.tsx", "utf8");
  const recent = readFileSync("components/input-pesanan/RecentOrdersList.tsx", "utf8");
  const staging = readFileSync("app/staging-area/page.tsx", "utf8");
  const lockRoute = readFileSync("app/api/print-batches/route.ts", "utf8");
  assert.match(queue, /row\.progressLabel \?\? STATUS_LABELS\[row\.status\]/);
  assert.match(recent, /progressLabel \?\? STATUS_LABELS\[status\]/);
  assert.match(staging, /\/api\/staging\/sheets\/\$\{sheetId\}\/reopen/);
  assert.match(lockRoute, /openSheetsBlockingLock/);
  assert.match(lockRoute, /syncOrderStatuses/);
});

let db: typeof import("../db").db;
let schema: typeof import("../db/schema");
let completeSheet: typeof import("../../app/api/staging/sheets/[sheetId]/complete/route").POST;
let reopenSheet: typeof import("../../app/api/staging/sheets/[sheetId]/reopen/route").POST;
let deleteSheet: typeof import("../../app/api/staging/sheets/[sheetId]/route").DELETE;
let lockBatch: typeof import("../../app/api/print-batches/route").POST;
let deleteBatch: typeof import("../../app/api/print-batches/[id]/route").DELETE;
let listOrders: typeof import("../../app/api/orders/route").GET;
let listSheets: typeof import("../../app/api/staging/route").GET;

before(async () => {
  mkdirSync(fontDir, { recursive: true });
  copyFileSync("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", path.join(fontDir, "font.ttf"));
  const sqlite = new Database(dbPath);
  migrate(drizzle(sqlite), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  sqlite.close();
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ POST: completeSheet } = await import("../../app/api/staging/sheets/[sheetId]/complete/route"));
  ({ POST: reopenSheet } = await import("../../app/api/staging/sheets/[sheetId]/reopen/route"));
  ({ DELETE: deleteSheet } = await import("../../app/api/staging/sheets/[sheetId]/route"));
  ({ POST: lockBatch } = await import("../../app/api/print-batches/route"));
  ({ DELETE: deleteBatch } = await import("../../app/api/print-batches/[id]/route"));
  ({ GET: listOrders } = await import("../../app/api/orders/route"));
  ({ GET: listSheets } = await import("../../app/api/staging/route"));
});

after(() => {
  rmSync(work, { recursive: true, force: true });
  rmSync(fontDir, { recursive: true, force: true });
});

function sheetRequest(method: "POST" | "DELETE", sheetId: number) {
  return new NextRequest(`http://localhost/api/staging/sheets/${sheetId}`, { method });
}

function sheetContext(sheetId: number) {
  return { params: Promise.resolve({ sheetId: String(sheetId) }) };
}

test("locking, unlocking, and dismantling update one part at a time", async () => {
  const columns = db.$client.prepare("PRAGMA table_info(staging_items)").all() as { name: string }[];
  assert.ok(columns.some((column) => column.name === "part_done"), "migration 0019 adds part_done");

  const [template] = await db
    .insert(schema.templates)
    .values({
      code: "FONT-LOCK",
      type: "ttf",
      filePath: `${fontPublic}/font.ttf`,
      thumbnailPath: `${fontPublic}/font.ttf`,
      colors: ["#111111"],
      isCharacter: false,
    })
    .returning();

  const { loadTemplateAssets } = await import("@/lib/keychain-render");
  const { renderTemplateItem } = await import("@/lib/render-dispatcher");
  const assets = await loadTemplateAssets(template);
  const rendered = renderTemplateItem(assets, template, "Ani", null);

  async function addOrder(receiptCode: string) {
    const [order] = await db.insert(schema.orders).values({ receiptCode, status: "processing" }).returning();
    await db.insert(schema.orderItems).values({
      orderId: order.id,
      templateId: template.id,
      quantity: 1,
      customerNames: ["Ani"],
    });
    return order;
  }

  async function stage(
    orderId: number,
    sheetId: number,
    split?: { part: number; count: number },
    status = "staged-production"
  ) {
    const [row] = await db
      .insert(schema.stagingItems)
      .values({
        orderId,
        templateId: template.id,
        customerName: "Ani",
        sheetId,
        posX: 40,
        posY: 40,
        width: rendered.width,
        height: rendered.height,
        rotated: false,
        rotationDeg: 0,
        splitPart: split?.part ?? null,
        splitCount: split?.count ?? null,
        status,
      })
      .returning();
    return row;
  }

  async function orderStatus(id: number) {
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    return row.status;
  }

  async function sheetIds(history: boolean) {
    const res = await listSheets(new NextRequest(`http://localhost/api/staging${history ? "?history=1" : ""}`));
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return (body.sheets as { sheetId: number }[]).map((sheet) => sheet.sheetId).sort((a, b) => a - b);
  }

  async function progress(receiptCode: string) {
    const res = await listOrders();
    const body = await res.json();
    return body.orders.find((order: { receiptCode: string }) => order.receiptCode === receiptCode) ?? null;
  }

  const whole = await addOrder("UTUH");
  const wholeRow = await stage(whole.id, 11, undefined, "staged-shape");
  const completed = await completeSheet(sheetRequest("POST", 11), sheetContext(11));
  assert.equal(completed.status, 200, JSON.stringify(await completed.clone().json()));
  assert.equal(await orderStatus(whole.id), "completed");
  const [lockedRow] = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.id, wholeRow.id));
  assert.equal(lockedRow.partDone, true);
  assert.equal(lockedRow.status, "staged-shape");
  assert.equal(await progress("UTUH"), null);
  assert.deepEqual(await sheetIds(true), [11]);
  assert.deepEqual(await sheetIds(false), []);

  const reopened = await reopenSheet(sheetRequest("POST", 11), sheetContext(11));
  assert.equal(reopened.status, 200, JSON.stringify(await reopened.clone().json()));
  assert.equal(await orderStatus(whole.id), "processing");
  const [openRow] = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.id, wholeRow.id));
  assert.equal(openRow.partDone, false);
  assert.equal(openRow.status, "staged-shape");

  const dismantled = await deleteSheet(sheetRequest("DELETE", 11), sheetContext(11));
  assert.equal(dismantled.status, 200);
  assert.equal(await orderStatus(whole.id), "pending");

  const split = await addOrder("PECAH");
  await stage(split.id, 21, { part: 1, count: 2 });
  await stage(split.id, 22, { part: 2, count: 2 });
  const removedOne = await deleteSheet(sheetRequest("DELETE", 21), sheetContext(21));
  assert.equal(removedOne.status, 200);
  assert.equal(await orderStatus(split.id), "processing");
  const stillThere = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, split.id));
  assert.deepEqual(stillThere.map((row) => row.sheetId), [22]);
  await stage(split.id, 21, { part: 1, count: 2 });

  const firstPart = await completeSheet(sheetRequest("POST", 21), sheetContext(21));
  const firstBody = await firstPart.json();
  assert.equal(firstPart.status, 200, JSON.stringify(firstBody));
  assert.equal(await orderStatus(split.id), "processing");
  assert.equal(firstBody.orders[0].progressLabel, "1/2 bagian selesai");
  const queued = await progress("PECAH");
  assert.equal(queued?.status, "processing");
  assert.equal(queued?.progressLabel, "1/2 bagian selesai");
  assert.ok((await sheetIds(false)).includes(22));
  assert.ok(!(await sheetIds(false)).includes(21));
  assert.ok((await sheetIds(true)).includes(21));

  const secondPart = await completeSheet(sheetRequest("POST", 22), sheetContext(22));
  assert.equal(secondPart.status, 200);
  assert.equal(await orderStatus(split.id), "completed");
  assert.equal(await progress("PECAH"), null);

  const unlocked = await reopenSheet(sheetRequest("POST", 22), sheetContext(22));
  const unlockedBody = await unlocked.json();
  assert.equal(unlocked.status, 200);
  assert.equal(await orderStatus(split.id), "processing");
  assert.equal(unlockedBody.orders[0].progressLabel, "1/2 bagian selesai");
  assert.notEqual(await orderStatus(split.id), "completed");

  const missing = await addOrder("SETENGAH");
  await stage(missing.id, 31, { part: 1, count: 2 });
  const onlyOne = await completeSheet(sheetRequest("POST", 31), sheetContext(31));
  assert.equal(onlyOne.status, 200);
  assert.equal(await orderStatus(missing.id), "processing");
  assert.notEqual(await orderStatus(missing.id), "completed");

  const doubled = await addOrder("DOBEL");
  await stage(doubled.id, 41);
  await stage(doubled.id, 42);
  const removedDouble = await deleteSheet(sheetRequest("DELETE", 41), sheetContext(41));
  assert.equal(removedDouble.status, 200);
  assert.equal(await orderStatus(doubled.id), "processing");
  const otherDouble = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, doubled.id));
  assert.equal(otherDouble.length, 1);
  assert.equal(otherDouble[0].sheetId, 42);

  const finished = await addOrder("SUDAH");
  await db.update(schema.orders).set({ status: "completed" }).where(eq(schema.orders.id, finished.id));
  await stage(finished.id, 91);
  await stage(finished.id, 92);
  const removedFinished = await deleteSheet(sheetRequest("DELETE", 91), sheetContext(91));
  assert.equal(removedFinished.status, 200);
  assert.equal(await orderStatus(finished.id), "completed");
  const finishedLeft = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, finished.id));
  assert.deepEqual(finishedLeft.map((row) => row.sheetId), [92]);

  const history = await addOrder("RIWAYAT");
  await stage(history.id, 93);
  await db.insert(schema.stagingItems).values({
    orderId: history.id,
    templateId: template.id,
    customerName: "Ani",
    sheetId: 94,
    posX: 40,
    posY: 40,
    width: rendered.width,
    height: rendered.height,
    rotated: false,
    status: "completed",
    partDone: true,
  });
  const removedHistory = await deleteSheet(sheetRequest("DELETE", 93), sheetContext(93));
  assert.equal(removedHistory.status, 200);
  assert.equal(await orderStatus(history.id), "pending");

  const old = await addOrder("LAMA");
  await db.insert(schema.stagingItems).values({
    orderId: old.id,
    templateId: template.id,
    customerName: "Ani",
    sheetId: 43,
    posX: 2,
    posY: 2,
    width: 30,
    height: 20,
    rotated: false,
    status: "completed",
    partDone: true,
  });
  const oldOpen = await reopenSheet(sheetRequest("POST", 43), sheetContext(43));
  assert.equal(oldOpen.status, 200, JSON.stringify(await oldOpen.clone().json()));
  const [oldRow] = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, old.id));
  assert.equal(oldRow.partDone, false);
  assert.equal(oldRow.status, "staged");

  function lockPayload(row: { id: number; orderId: number; templateId: number; customerName: string; sheetId: number; posX: number; posY: number; width: number; height: number; rotated: boolean; rotationDeg: number | null; splitPart: number | null; splitCount: number | null; status: string }, receiptCode: string, batchCode: string) {
    return new NextRequest("http://localhost/api/print-batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sheetId: row.sheetId,
        batchCode,
        canvasWidth: 310,
        canvasHeight: 470,
        items: [
          {
            ...row,
            order: { id: row.orderId, receiptCode, manualCode: "" },
            template: null,
            render: null,
          },
        ],
      }),
    });
  }

  const batchSplit = await addOrder("BATCH");
  const partA = await stage(batchSplit.id, 51, { part: 1, count: 2 });
  const partB = await stage(batchSplit.id, 52, { part: 2, count: 2 });
  const lockedA = await lockBatch(lockPayload(partA, "BATCH", "LOCK-A"));
  const lockedABody = await lockedA.json();
  assert.equal(lockedA.status, 201, JSON.stringify(lockedABody));
  assert.equal(await orderStatus(batchSplit.id), "processing");
  assert.equal(lockedABody.orders[0].progressLabel, "1/2 bagian selesai");
  const afterA = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, batchSplit.id));
  assert.deepEqual(afterA.map((row) => row.sheetId), [52]);

  const blocked = await addOrder("TERPECAH");
  const blockA = await stage(blocked.id, 71);
  await stage(blocked.id, 72);
  const refused = await lockBatch(lockPayload(blockA, "TERPECAH", "LOCK-NO"));
  const refusedBody = await refused.json();
  assert.equal(refused.status, 422, JSON.stringify(refusedBody));
  assert.match(JSON.stringify(refusedBody.details), /terpecah/);
  assert.equal(await orderStatus(blocked.id), "processing");

  const lockedB = await lockBatch(lockPayload(partB, "BATCH", "LOCK-B"));
  const lockedBBody = await lockedB.json();
  assert.equal(lockedB.status, 201, JSON.stringify(lockedBBody));
  assert.equal(await orderStatus(batchSplit.id), "completed");
  assert.equal(lockedBBody.orders[0].progressLabel, null);

  const batchBId = lockedBBody.batch.id as number;
  const undoneB = await deleteBatch(new NextRequest("http://localhost/api/print-batches/" + batchBId, { method: "DELETE" }), {
    params: Promise.resolve({ id: String(batchBId) }),
  });
  const undoneBBody = await undoneB.json();
  assert.equal(undoneB.status, 200, JSON.stringify(undoneBBody));
  assert.equal(undoneBBody.restored, true);
  assert.equal(await orderStatus(batchSplit.id), "processing");
  assert.equal(undoneBBody.orders[0].progressLabel, "1/2 bagian selesai");
  const backB = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, batchSplit.id));
  assert.equal(backB.length, 1);
  assert.equal(backB[0].splitPart, 2);
  assert.equal(backB[0].partDone, false);

  const batchAId = lockedABody.batch.id as number;
  const undoneA = await deleteBatch(new NextRequest("http://localhost/api/print-batches/" + batchAId, { method: "DELETE" }), {
    params: Promise.resolve({ id: String(batchAId) }),
  });
  assert.equal(undoneA.status, 200);
  assert.equal(await orderStatus(batchSplit.id), "processing");
  const bothBack = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, batchSplit.id));
  assert.equal(bothBack.length, 2);
  assert.ok(bothBack.every((row) => row.partDone === false));
  const listed = await progress("BATCH");
  assert.equal(listed?.progressLabel, null);
  assert.equal(listed?.status, "processing");

  const wholeBatch = await addOrder("ARSIP");
  const wholeSheet = await stage(wholeBatch.id, 61);
  const archived = await lockBatch(lockPayload(wholeSheet, "ARSIP", "LOCK-UTUH"));
  const archivedBody = await archived.json();
  assert.equal(archived.status, 201, JSON.stringify(archivedBody));
  assert.equal(await orderStatus(wholeBatch.id), "completed");
  const archiveId = archivedBody.batch.id as number;
  const removedArchive = await deleteBatch(new NextRequest("http://localhost/api/print-batches/" + archiveId, { method: "DELETE" }), {
    params: Promise.resolve({ id: String(archiveId) }),
  });
  const removedArchiveBody = await removedArchive.json();
  assert.equal(removedArchive.status, 200, JSON.stringify(removedArchiveBody));
  assert.equal(removedArchiveBody.restored, false);
  assert.equal(await orderStatus(wholeBatch.id), "completed");
  const noSheet = await db.select().from(schema.stagingItems).where(eq(schema.stagingItems.orderId, wholeBatch.id));
  assert.equal(noSheet.length, 0);
});
