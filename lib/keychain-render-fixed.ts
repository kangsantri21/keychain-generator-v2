import type { Template } from "@/lib/db/schema";
import type { TemplateAssets } from "@/lib/keychain-render";
import type { KeychainRender } from "@/lib/render-types";
import { renderColoredGlyphsAtHeight, type GlyphSegment } from "@/lib/font-preview";
import { translatePathData, scaleAndTranslatePathData } from "@/lib/laser-outline";

function rectPathData(x: number, y: number, width: number, height: number): string {
  return `M ${x},${y} H ${x + width} V ${y + height} H ${x} Z`;
}

/**
 * Renders one nested unit for a "fixed" layoutMode template — the
 * Fixed-Shape Template product line, where the master SVG (loaded from
 * `template.characterImagePath`, the same column character templates use)
 * already carries its own final, paten cut-line, drawn once by the
 * designer. Unlike the "dynamic" engine (lib/keychain-render.ts), this
 * NEVER runs the clipper dilate/erode/union pipeline (lib/clipper-outline.ts)
 * — the master's own geometry is trusted as final, verbatim:
 *
 * - If the master SVG has a detectable cut-line (same id="cut-line" /
 *   reddish-stroke / bare-fill:none heuristics lib/character-svg.ts already
 *   uses for character templates), its raw path data is used as-is for
 *   `outlinePath` — no union, no dilate/erode.
 * - Otherwise, the SVG's own declared bounding box (its viewBox) becomes a
 *   plain rectangular cut boundary.
 *
 * `template.customZones` (lib/db/schema.ts) mark invisible placement zones
 * inside that same master SVG. This pass only handles `type: "text"` zones:
 * the input name is rendered once per such zone, calibrated to the zone's
 * own height as its "default" size, shrunk uniformly only if it would
 * overflow the zone's width or height, and centered inside it. The
 * resulting colored glyph paths are returned via `textSegments` — layered
 * on top of `characterImage` by every existing consumer (StagingCanvas,
 * export-print-svg) as one visual unit, which is what "injecting the text
 * into the master SVG" means here: not literal XML splicing, but the same
 * background-image + foreground-colored-paths layering the dynamic engine
 * already relies on (needed anyway to keep each glyph individually
 * colorable via template.colors, which a spliced flat SVG string would
 * lose).
 *
 * `type: "image"` zones and hole placement are intentionally not handled
 * yet — see the inline notes below.
 */
export function renderFixedShapeTemplate(
  assets: TemplateAssets,
  template: Template,
  text: string
): KeychainRender {
  const vector = assets.characterVector;
  if (!vector) {
    throw new Error(
      `Template "${template.code}" (id ${template.id}) is layoutMode "fixed" but has no parseable master SVG at its characterImagePath.`
    );
  }

  const { bounds, cutLinePaths } = vector;
  const sampleText = text.trim() || template.defaultText || "Nama";

  const outlinePathNative =
    cutLinePaths.length > 0
      ? cutLinePaths.join(" ")
      : rectPathData(bounds.x, bounds.y, bounds.width, bounds.height);

  const textSegmentsNative: GlyphSegment[] = [];
  for (const zone of template.customZones ?? []) {
    if (zone.type !== "text") continue;
    if (zone.width <= 0 || zone.height <= 0) continue;

    // "Default font size" = calibrated to the zone's own height, since
    // there's no separate global size spec for fixed-shape zones the way
    // TEXT_CUT_HEIGHT_MM is for the dynamic engine's character templates.
    const { segments, bbox } = renderColoredGlyphsAtHeight(assets.font, sampleText, zone.height, template.colors);
    const rawWidth = Math.max(bbox.x2 - bbox.x1, 1e-6);
    const rawHeight = Math.max(bbox.y2 - bbox.y1, 1e-6);

    // Shrink-to-fit only (never upscale past the zone-calibrated default —
    // the `1` cap) — matches "leave the default size if it already fits".
    const scale = Math.min(zone.width / rawWidth, zone.height / rawHeight, 1);

    // Center the (possibly shrunk) text inside the zone: translate so the
    // scaled bounding box's own center lands exactly on the zone's center.
    const zoneCenterX = zone.x + zone.width / 2;
    const zoneCenterY = zone.y + zone.height / 2;
    const translateX = zoneCenterX - (scale * (bbox.x1 + bbox.x2)) / 2;
    const translateY = zoneCenterY - (scale * (bbox.y1 + bbox.y2)) / 2;

    for (const segment of segments) {
      textSegmentsNative.push({
        d: scaleAndTranslatePathData(segment.d, scale, translateX, translateY),
        color: segment.color,
      });
    }
  }

  // Normalize everything (master image, outline, text) to a shared (0, 0)
  // origin — the same convention the dynamic engine's normalizePath uses —
  // so the packer can place this item anywhere on a sheet with a plain
  // translate.
  const outlinePath = translatePathData(outlinePathNative, -bounds.x, -bounds.y);
  const textSegments = textSegmentsNative.map((segment) => ({
    ...segment,
    d: translatePathData(segment.d, -bounds.x, -bounds.y),
  }));

  return {
    width: bounds.width,
    height: bounds.height,
    outlinePath,
    // Not yet computed for fixed-shape templates: a pre-made master SVG's
    // own cut-line may already bake its physical keyring hole into its
    // silhouette (unlike a dynamic character template, whose hole position
    // must be searched for per-upload since every silhouette is unique) —
    // revisit once a real fixed-shape master file confirms whether that's
    // actually the case, or whether customZones needs its own hole marker.
    holePath: null,
    textSegments,
    characterImage: assets.characterImageDataUri
      ? {
          dataUri: assets.characterImageDataUri,
          x: -bounds.x,
          y: -bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : null,
    // `type: "image"` customZones (photo insertion) are not handled yet —
    // a later pass alongside real hole placement.
  };
}
