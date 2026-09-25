import type { Template, HoleOverride } from "@/lib/db/schema";
import { renderKeychainText, type TemplateAssets } from "@/lib/keychain-render";
import { renderFixedShapeTemplate } from "@/lib/keychain-render-fixed";
import type { KeychainRender } from "@/lib/render-types";

/**
 * Single entry point the nesting engine (app/api/staging/nest/route.ts) and
 * the staging list (app/api/staging/route.ts) call instead of a specific
 * renderer directly — routes each item to the right engine by
 * `template.layoutMode`, so one sheet can freely mix "dynamic" and "fixed"
 * items without either call site needing to know which is which, and
 * without the nesting/packing logic itself changing at all.
 *
 * - JALUR A "dynamic": lib/keychain-render.ts's `renderKeychainText`,
 *   completely unchanged — the existing clipper/MAX_ITEM_WIDTH_MM/
 *   text-height production pipeline. Zero regression risk.
 * - JALUR B "fixed": lib/keychain-render-fixed.ts's
 *   `renderFixedShapeTemplate` (the Fixed-Shape Template product line;
 *   scaffolded, not yet implemented).
 *
 * Both paths return the same `KeychainRender` shape (lib/render-types.ts),
 * so every downstream consumer — the packer, StagingCanvas, export-dxf,
 * export-print-svg — stays engine-agnostic.
 */
export function renderTemplateItem(
  assets: TemplateAssets,
  template: Template,
  text: string,
  holeOverride: HoleOverride | null = null
): KeychainRender {
  switch (template.layoutMode) {
    case "fixed":
      return renderFixedShapeTemplate(assets, template, text, holeOverride);
    case "dynamic":
    default:
      return renderKeychainText(assets, template, text, holeOverride);
  }
}
