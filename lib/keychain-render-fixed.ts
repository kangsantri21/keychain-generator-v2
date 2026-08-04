import type { Template } from "@/lib/db/schema";
import type { TemplateAssets } from "@/lib/keychain-render";
import type { KeychainRender } from "@/lib/render-types";
import { renderColoredGlyphsAtHeight, type GlyphSegment } from "@/lib/font-preview";
import { translatePathData, scaleAndTranslatePathData, getPathBounds, type PathBounds } from "@/lib/laser-outline";
import { computeLaserOutlineClipper } from "@/lib/clipper-outline";
import { MAX_ITEM_WIDTH_MM, DILATE_MM, ERODE_MM } from "@/lib/keychain-geometry";

/**
 * Renders one nested unit for a "fixed" layoutMode template - the
 * Fixed-Shape Template product line, where the master SVG (loaded from
 * `template.characterImagePath`, the same column character templates use)
 * is a full designer artwork file, not a font-rendered layout.
 *
 * Unlike the "dynamic" engine's designer-cut-line path (lib/keychain-
 * render.ts, for single-character uploads), this NEVER trusts a pre-tagged
 * "cut-line" layer inside the master SVG: multi-layer exports from the
 * design team repeatedly mis-tagged an inner design element as the
 * cut-line (a stray id, or an untended reddish/unfilled inner shape), which
 * then sliced straight through the artwork instead of wrapping it. Instead,
 * EVERY shape in the master SVG is unioned together and run through the
 * same Clipper dilate-then-erode closing pass the dynamic engine's own
 * outline uses (lib/clipper-outline.ts, DILATE_MM/ERODE_MM) to auto-compute
 * one clean outer silhouette hugging the artwork's true outer boundary -
 * the same outline algorithm, the same resilience, as the dynamic engine.
 *
 * `template.customZones` (lib/db/schema.ts) mark invisible placement zones
 * inside that same master SVG. This pass only handles `type: "text"` zones:
 * the input name is rendered once per such zone, calibrated to the zone's
 * own height as its "default" size, shrunk uniformly only if it would
 * overflow the zone's width or height, and centered inside it. The
 * resulting colored glyph paths are returned via `textSegments` - layered
 * on top of `characterImage` by every existing consumer (StagingCanvas,
 * export-print-svg) as one visual unit, which is what "injecting the text
 * into the master SVG" means here: not literal XML splicing, but the same
 * background-image + foreground-colored-paths layering the dynamic engine
 * already relies on (needed anyway to keep each glyph individually
 * colorable via template.colors, which a spliced flat SVG string would
 * lose).
 *
 * `type: "image"` zones and hole placement are intentionally not handled
 * yet - see the inline notes below.
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

  const { bounds, allShapePaths } = vector;
  const sampleText = text.trim() || template.defaultText || "Nama";

  // Base auto-scale: a designer's master SVG is sometimes exported at an
  // oversized native viewBox (hundreds of mm) - nested and cut at that
  // literal size, it becomes a giant item that wastes acrylic. Uniformly
  // scale the ENTIRE master (every shape, and every customZone's
  // admin-entered coordinates alike - see below) down around the SVG's own
  // origin so its width never exceeds MAX_ITEM_WIDTH_MM, before anything
  // else is computed from it. A no-op (baseScale = 1) for any master
  // already within spec.
  const baseScale = bounds.width > MAX_ITEM_WIDTH_MM ? MAX_ITEM_WIDTH_MM / bounds.width : 1;
  const scaledNativeBounds: PathBounds = {
    x: bounds.x * baseScale,
    y: bounds.y * baseScale,
    width: bounds.width * baseScale,
    height: bounds.height * baseScale,
  };

  // Every shape in the master, scaled to real output mm FIRST - the
  // dilate/erode closing pass below is a real physical clearance spec (the
  // same DILATE_MM/ERODE_MM the dynamic engine uses), so it must operate in
  // genuine output units, not the SVG's arbitrary native scale.
  const scaledShapes = allShapePaths.map((d) => scaleAndTranslatePathData(d, baseScale, 0, 0));

  // Auto-computed cut-line: union every shape in the master artwork, then
  // dilate+erode with round joins - drops any interior holes/counters the
  // same way the dynamic engine's glyph outlines do, and produces a single
  // clean outer silhouette no matter how many overlapping layers the
  // designer file has, without ever needing to guess which one is "the"
  // cut-line.
  const outlinePathScaled = computeLaserOutlineClipper(scaledShapes, { dilateMm: DILATE_MM, erodeMm: ERODE_MM });

  // Every other shape (artwork image, zone text) normalizes against the
  // outline's own bounds - which legitimately extends a little beyond the
  // raw artwork edges once dilated, exactly like the dynamic engine. Falls
  // back to the plain scaled SVG bounds only if Clipper produced nothing at
  // all (e.g. a master with no closed shapes), so the render never throws
  // even on a degenerate file.
  const normalizeBounds = (outlinePathScaled ? getPathBounds(outlinePathScaled) : null) ?? scaledNativeBounds;

  const outlinePath = outlinePathScaled
    ? translatePathData(outlinePathScaled, -normalizeBounds.x, -normalizeBounds.y)
    : null;

  const textSegmentsNative: GlyphSegment[] = [];
  for (const zone of template.customZones ?? []) {
    if (zone.type !== "text") continue;
    if (zone.width <= 0 || zone.height <= 0) continue;

    // The admin enters zone coordinates against the master's ORIGINAL
    // (unscaled) units in the template form - calibrate them by the same
    // baseScale so the zone still lines up with the now-shrunk artwork
    // exactly as previewed there (CharacterTemplateForm.tsx mirrors this
    // same calibration for its own live preview).
    const zoneX = zone.x * baseScale;
    const zoneY = zone.y * baseScale;
    const zoneWidth = zone.width * baseScale;
    const zoneHeight = zone.height * baseScale;

    // "Default font size" = calibrated to the (scaled) zone's own height,
    // since there's no separate global size spec for fixed-shape zones the
    // way TEXT_CUT_HEIGHT_MM is for the dynamic engine's character templates.
    const { segments, bbox } = renderColoredGlyphsAtHeight(assets.font, sampleText, zoneHeight, template.colors);
    const rawWidth = Math.max(bbox.x2 - bbox.x1, 1e-6);
    const rawHeight = Math.max(bbox.y2 - bbox.y1, 1e-6);

    // Shrink-to-fit only (never upscale past the zone-calibrated default -
    // the `1` cap) - matches "leave the default size if it already fits".
    const scale = Math.min(zoneWidth / rawWidth, zoneHeight / rawHeight, 1);

    // Center the (possibly shrunk) text inside the zone: translate so the
    // scaled bounding box's own center lands exactly on the zone's center.
    const zoneCenterX = zoneX + zoneWidth / 2;
    const zoneCenterY = zoneY + zoneHeight / 2;
    const translateX = zoneCenterX - (scale * (bbox.x1 + bbox.x2)) / 2;
    const translateY = zoneCenterY - (scale * (bbox.y1 + bbox.y2)) / 2;

    for (const segment of segments) {
      textSegmentsNative.push({
        d: scaleAndTranslatePathData(segment.d, scale, translateX, translateY),
        color: segment.color,
      });
    }
  }

  // textSegmentsNative are already positioned in "baseScale-adjusted" space
  // (zoneX/zoneY/zoneWidth/zoneHeight above already had baseScale applied),
  // so only the final normalize-to-(0,0) shift (against the outline's own
  // bounds) is needed here - no further scaling.
  const textSegments = textSegmentsNative.map((segment) => ({
    ...segment,
    d: translatePathData(segment.d, -normalizeBounds.x, -normalizeBounds.y),
  }));

  return {
    width: normalizeBounds.width,
    height: normalizeBounds.height,
    outlinePath,
    // Not yet computed for fixed-shape templates: a pre-made master SVG's
    // own cut-line may already bake its physical keyring hole into its
    // silhouette (unlike a dynamic character template, whose hole position
    // must be searched for per-upload since every silhouette is unique) -
    // revisit once a real fixed-shape master file confirms whether that's
    // actually the case, or whether customZones needs its own hole marker.
    holePath: null,
    textSegments,
    characterImage: assets.characterImageDataUri
      ? {
          dataUri: assets.characterImageDataUri,
          x: scaledNativeBounds.x - normalizeBounds.x,
          y: scaledNativeBounds.y - normalizeBounds.y,
          width: scaledNativeBounds.width,
          height: scaledNativeBounds.height,
        }
      : null,
    // `type: "image"` customZones (photo insertion) are not handled yet -
    // a later pass alongside real hole placement.
  };
}
