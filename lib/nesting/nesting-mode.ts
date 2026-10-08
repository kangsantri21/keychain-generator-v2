/**
 * Which nesting engine a `POST /api/staging/nest` request asked for.
 * Extracted as its own pure function (rather than an inline `body?.mode ===
 * "grouped-v2"` check) specifically so "default stays legacy" is something
 * a test can assert directly, without needing to invoke the Next.js route
 * handler itself (this project has no HTTP-route test infrastructure).
 */
export type NestingMode = "legacy" | "grouped-v2";

/**
 * Resolves the requested mode from a parsed JSON request body. Anything
 * other than the literal string `"grouped-v2"` — missing field, `null`
 * body, a typo, an old caller that has never heard of this field at all —
 * resolves to `"legacy"`. This is what guarantees every pre-Phase-2A caller
 * (Order Queue's own fetch never sends `mode`) keeps its exact original
 * behavior with zero code changes on its end.
 */
export function resolveNestingMode(body: unknown): NestingMode {
  const mode = (body as { mode?: unknown } | null)?.mode;
  return mode === "grouped-v2" ? "grouped-v2" : "legacy";
}
