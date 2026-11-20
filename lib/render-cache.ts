/**
 * Remembers a finished keychain drawing so Staging and nesting do not run
 * the cut-line math again for the same template and name.
 *
 * The first request still draws every piece. The next request, including
 * after the server process restarts, reads the saved drawing from
 * `.cache/keychain-render` (that folder is not committed).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { HoleOverride, Template } from "@/lib/db/schema";
import type { TemplateAssets } from "@/lib/keychain-render";
import { renderTemplateItem } from "@/lib/render-dispatcher";
import type { KeychainRender } from "@/lib/render-types";

const memory = new Map<string, KeychainRender>();
const CACHE_DIR = path.join(process.cwd(), ".cache", "keychain-render");

function cacheKey(template: Template, text: string, hole: HoleOverride | null): string {
  return [
    template.id,
    template.filePath,
    template.characterImagePath ?? "",
    template.layoutMode,
    template.isCharacter ? 1 : 0,
    template.hasHole ? 1 : 0,
    template.textTargetHeight,
    template.charTargetHeight,
    template.dynamicGapX,
    template.dynamicOffsetY,
    template.holeOffsetX,
    template.holeOffsetY,
    JSON.stringify(template.colors),
    JSON.stringify(template.letterOffsets),
    text,
    hole?.x ?? "",
    hole?.y ?? "",
  ].join("|");
}

function fileFor(key: string): string {
  return path.join(CACHE_DIR, createHash("sha1").update(key).digest("hex") + ".json");
}

export function renderTemplateItemCached(
  assets: TemplateAssets,
  template: Template,
  text: string,
  hole: HoleOverride | null = null
): KeychainRender {
  const key = cacheKey(template, text, hole);
  const remembered = memory.get(key);
  if (remembered) return remembered;
  try {
    const saved = JSON.parse(readFileSync(fileFor(key), "utf8")) as KeychainRender;
    memory.set(key, saved);
    return saved;
  } catch {
    // No saved drawing yet.
  }
  const render = renderTemplateItem(assets, template, text, hole);
  memory.set(key, render);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(fileFor(key), JSON.stringify(render));
  } catch {
    // The drawing is still in memory for this process.
  }
  return render;
}
