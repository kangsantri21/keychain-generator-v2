/**
 * PHASE 2B — TEST A: default mode stays legacy.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveNestingMode } from "./nesting-mode";

describe("resolveNestingMode — TEST A: default stays legacy", () => {
  test("null body resolves to legacy", () => {
    assert.equal(resolveNestingMode(null), "legacy");
  });

  test("body with no mode field resolves to legacy (every pre-Phase-2A caller)", () => {
    assert.equal(resolveNestingMode({ selections: ["1:0"] }), "legacy");
  });

  test("an unrecognized mode value falls back to legacy, never crashes", () => {
    assert.equal(resolveNestingMode({ mode: "bogus" }), "legacy");
    assert.equal(resolveNestingMode({ mode: 123 }), "legacy");
    assert.equal(resolveNestingMode({ mode: null }), "legacy");
  });

  test("the exact literal 'grouped-v2' opts in — nothing else does", () => {
    assert.equal(resolveNestingMode({ mode: "grouped-v2" }), "grouped-v2");
    assert.equal(resolveNestingMode({ mode: "GROUPED-V2" }), "legacy");
    assert.equal(resolveNestingMode({ mode: "grouped-v2-preview" }), "legacy");
  });
});
