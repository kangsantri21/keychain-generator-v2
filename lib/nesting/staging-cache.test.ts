/**
 * Staging Area cache-first + background revalidation (lib/staging-cache.ts).
 * `npm test`.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  fetchStagingSnapshot,
  invalidateStagingCache,
  isStagingChanged,
  readStagingCache,
  rememberActiveSheet,
  stagingCacheGeneration,
  writeStagingCache,
} from "@/lib/staging-cache";
import type { StagingSheet } from "@/lib/staging-types";

const sheet = (sheetId: number, posX = 5): StagingSheet =>
  ({
    sheetId,
    items: [{ id: sheetId * 10, orderId: 1, templateId: 1, customerName: "A", sheetId, posX, posY: 5, width: 40, height: 30, rotated: false, status: "staged-production" }],
  }) as unknown as StagingSheet;

const body = (sheets: StagingSheet[]) => JSON.stringify({ sheets });

function mockFetch(responses: string[]) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const text = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { ok: true, text: async () => text } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const src = (path: string) => readFileSync(path, "utf8");
const page = src("app/staging-area/page.tsx");
const queue = src("app/order-queue/page.tsx");

/** Body of a named function/handler in a source file (up to the next top-level-in-component `  async function`/`  function`). */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n  (async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}

beforeEach(() => invalidateStagingCache());

describe("Staging cache — cache-first render", () => {
  test("a cached snapshot is available synchronously, without waiting for a fetch", async () => {
    const { impl } = mockFetch([body([sheet(1), sheet(2)])]);
    const gen = stagingCacheGeneration();
    assert.ok(writeStagingCache(await fetchStagingSnapshot(impl), gen));
    const cached = readStagingCache();
    assert.equal(cached?.sheets.length, 2);
    assert.deepEqual(cached?.sheets.map((s) => s.sheetId), [1, 2]);
  });

  test("the page seeds its state from the cache and only shows the full loading state without one", () => {
    assert.match(page, /useState\(\(\) => readStagingCache\(\)\)/);
    assert.match(page, /useState<StagingSheet\[\]>\(\(\) => initialCache\?\.sheets \?\? \[\]\)/);
    assert.match(page, /const \[isLoading, setIsLoading\] = useState\(\(\) => !initialCache\)/);
    assert.match(page, /Memeriksa data terbaru/);
  });

  test("the remembered active sheet survives revalidation writes", async () => {
    const { impl } = mockFetch([body([sheet(1), sheet(2)])]);
    writeStagingCache(await fetchStagingSnapshot(impl), stagingCacheGeneration());
    rememberActiveSheet(2);
    writeStagingCache(await fetchStagingSnapshot(impl), stagingCacheGeneration());
    assert.equal(readStagingCache()?.activeSheetId, 2);
  });

  test("revisiting never runs nesting — revalidation only reads GET /api/staging", async () => {
    const { impl, calls } = mockFetch([body([sheet(1)])]);
    await fetchStagingSnapshot(impl);
    assert.deepEqual(calls, ["/api/staging"]);
    assert.doesNotMatch(fnBody(page, "refreshActiveSheets"), /\/api\/staging\/nest/);
    assert.doesNotMatch(fnBody(page, "finishRevalidation"), /\/api\/staging\/nest/);
    assert.doesNotMatch(src("lib/staging-cache.ts"), /\/api\/staging\/nest|runProductionNesting|packMaxRects/);
    // The start button is the only nesting call on this page, and it reloads from the server afterwards.
    assert.match(fnBody(page, "handleStartNesting"), /\/api\/staging\/nest/);
    assert.match(fnBody(page, "handleStartNesting"), /await reloadAfterMutation\(\)/);
  });
});

describe("Staging cache — background revalidation", () => {
  test("identical data yields the same signature, so the screen is not updated", async () => {
    const { impl } = mockFetch([body([sheet(1)]), body([sheet(1)])]);
    const first = await fetchStagingSnapshot(impl);
    writeStagingCache(first, stagingCacheGeneration());
    const second = await fetchStagingSnapshot(impl);
    assert.equal(isStagingChanged(readStagingCache(), second), false);
  });

  test("changed data yields a different signature, so the screen is updated", async () => {
    const { impl } = mockFetch([body([sheet(1, 5)]), body([sheet(1, 7)])]);
    writeStagingCache(await fetchStagingSnapshot(impl), stagingCacheGeneration());
    assert.equal(isStagingChanged(readStagingCache(), await fetchStagingSnapshot(impl)), true);
  });

  test("the page applies revalidated data only when the signature changed (no remount/flicker otherwise)", () => {
    const refresh = fnBody(page, "refreshActiveSheets");
    assert.match(refresh, /if \(isStagingChanged\(/);
    const applyAt = refresh.indexOf("applySheets(fresh.sheets)");
    assert.ok(applyAt > refresh.indexOf("if (isStagingChanged("), "applySheets must be inside the changed-branch");
  });

  test("a failed response is an error, never written to the cache", async () => {
    const impl = (async () => ({ ok: false, text: async () => JSON.stringify({ error: "boom" }) }) as Response) as unknown as typeof fetch;
    await assert.rejects(fetchStagingSnapshot(impl), /boom/);
    assert.equal(readStagingCache(), null);
  });
});

describe("Staging cache — invalidation", () => {
  test("a fetch started before an invalidation cannot write stale data back", async () => {
    const { impl } = mockFetch([body([sheet(1)])]);
    const gen = stagingCacheGeneration();
    const fresh = await fetchStagingSnapshot(impl);
    invalidateStagingCache(); // e.g. a nesting / lock / delete finished meanwhile
    assert.equal(writeStagingCache(fresh, gen), false);
    assert.equal(readStagingCache(), null);
  });

  test("invalidated after a new nesting (Kirim ke Mesin Nesting) and after an append", () => {
    const send = queue.slice(queue.indexOf('fetch("/api/staging/nest"'));
    assert.ok(send.indexOf("invalidateStagingCache()") < send.indexOf('router.push("/staging-area")'));
    const append = fnBody(queue, "handleAppendToActiveBatch");
    assert.match(append, /invalidateStagingCache\(\)/);
  });

  test("invalidated after Kunci & Simpan Batch Produksi", () => {
    const lock = fnBody(page, "handleLockBatch");
    assert.ok(lock.indexOf("invalidateStagingCache()") >= 0);
    assert.ok(lock.indexOf("invalidateStagingCache()") < lock.indexOf('router.push("/file-siap-cetak")'));
  });

  test("invalidated after deleting (bongkar) or completing a sheet", () => {
    assert.match(fnBody(page, "reloadAfterMutation"), /invalidateStagingCache\(\)/);
    assert.match(fnBody(page, "handleDeleteSheet"), /await reloadAfterMutation\(\)/);
    assert.match(fnBody(page, "handleCompleteSheet"), /await reloadAfterMutation\(\)/);
  });

  test("invalidated after deleting an order (its staged units are deleted with it)", () => {
    assert.match(fnBody(queue, "handleConfirmDeleteReceipt"), /invalidateStagingCache\(\)/);
    assert.match(fnBody(src("components/input-pesanan/RecentOrdersList.tsx"), "handleDelete"), /invalidateStagingCache\(\)/);
  });
});

describe("Staging cache — never a source of truth", () => {
  const filesUnder = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
    });
  const users = [...filesUnder("app"), ...filesUnder("components"), ...filesUnder("lib")].filter(
    (path) => !path.endsWith(".test.ts") && path !== join("lib", "staging-cache.ts") && /staging-cache/.test(src(path))
  );

  test("only the Staging page and the mutation call sites use the cache", () => {
    assert.deepEqual(users.sort(), ["app/order-queue/page.tsx", "app/staging-area/page.tsx", "components/input-pesanan/RecentOrdersList.tsx"]);
  });

  test("production validation (batch lock gate) re-reads the DB, not the cache", () => {
    const route = src("app/api/print-batches/route.ts");
    assert.doesNotMatch(route, /staging-cache/);
    assert.match(route, /matchSubmittedToStaged\(dbRows, submitted\)/);
    assert.match(route, /validatePlacedSheets\(/);
  });

  test("locking waits until the cached sheets are confirmed by the server", () => {
    assert.match(page, /isVerifying=\{viewMode === "active" && isRevalidating\}/);
    assert.match(src("components/staging-area/ControlPanel.tsx"), /disabled=\{!activeSheet \|\| isLocking \|\| !canLock \|\| isVerifying\}/);
  });

  test("export (DXF/JPG, File Siap Cetak) never reads the cache", () => {
    const exportFiles = [...filesUnder("app/file-siap-cetak"), ...filesUnder("app/api/print-batches"), "lib/export-dxf.ts", "lib/export-print-svg.ts"];
    for (const path of exportFiles) assert.doesNotMatch(src(path), /staging-cache/, path);
  });

  test("Legacy nesting and Mahar do not touch the cache", () => {
    const untouched = ["lib/nesting.ts", ...filesUnder("lib").filter((p) => /mahar/.test(p)), ...filesUnder("app/mahar-generator"), ...filesUnder("app/mahar-nesting")];
    for (const path of untouched) assert.doesNotMatch(src(path), /staging-cache/, path);
  });
});
