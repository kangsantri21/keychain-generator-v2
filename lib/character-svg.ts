import { getPathBounds, type PathBounds } from "@/lib/laser-outline";

// Uses the ambient DOMParser/XMLSerializer — native in every browser. Node
// has neither, so server callers must polyfill globalThis.DOMParser and
// globalThis.XMLSerializer before calling this (see character-svg-server.ts),
// keeping this module itself free of any Node-only dependency.

/** UTF-8-safe base64 encoding that works in both the browser and Node. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const CUT_LINE_ID_PATTERN = /^cut[-_]?line$/i;

// Loosely typed so both the browser's real `Element`/`ParentNode` and
// xmldom's Element are structurally assignable without casting each caller.
type SvgNode = {
  getAttribute(name: string): string | null;
  parentNode: unknown;
};

function asSvgNode(node: unknown): SvgNode | null {
  return node && typeof (node as SvgNode).getAttribute === "function" ? (node as SvgNode) : null;
}

export interface CharacterVector {
  /** Raw SVG path `d` strings for the designer's own pre-made cut line(s), still in the source SVG's own coordinate space. */
  cutLinePaths: string[];
  /** Data URI for the artwork with the cut-line path(s) stripped out, ready to embed via <image>. */
  artworkDataUri: string;
  /** The source SVG's own canvas size (from viewBox, falling back to the union of its paths' bounds). */
  bounds: PathBounds;
  /**
   * EVERY `<path>`/`<polygon>` shape's `d` string in the source SVG, still in
   * its own coordinate space — collected before the cut-line heuristic above
   * removes anything, so it's unaffected by (mis-)classification. Used by
   * the "fixed" layoutMode engine (lib/keychain-render-fixed.ts) to
   * auto-compute a cut-line via Clipper union+offset over the whole master
   * artwork, instead of trusting a single tagged "cut-line" layer — a
   * multi-layer designer export can mis-tag an inner design element as the
   * cut-line, slicing through the artwork instead of wrapping it.
   */
  allShapePaths: string[];
}

function attr(el: { getAttribute(name: string): string | null }, name: string): string {
  return (el.getAttribute(name) ?? "").trim().toLowerCase();
}

/** Reads `name` from inline `style="..."`, e.g. `styleProp(el, "stroke")`. */
function styleProp(el: { getAttribute(name: string): string | null }, name: string): string | null {
  const style = attr(el, "style");
  const match = style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
}

/**
 * CorelDraw/Illustrator exports often set stroke/fill on a wrapping `<g>`
 * rather than the `<path>` itself, relying on SVG's normal presentation
 * attribute inheritance. Resolve that by walking up the ancestor chain for
 * the first explicit value (inline style takes precedence over the
 * attribute at each level, matching CSS cascade rules).
 */
function resolveInherited(el: SvgNode, name: string, fallback: string): string {
  let node: SvgNode | null = el;
  while (node) {
    const fromStyle = styleProp(node, name);
    if (fromStyle) return fromStyle.toLowerCase();
    const own = node.getAttribute(name);
    if (own && own.trim() !== "") return own.trim().toLowerCase();
    node = asSvgNode(node.parentNode);
  }
  return fallback;
}

function idMatchesSelfOrAncestor(el: SvgNode): boolean {
  let node: SvgNode | null = el;
  while (node) {
    if (CUT_LINE_ID_PATTERN.test(attr(node, "id"))) return true;
    node = asSvgNode(node.parentNode);
  }
  return false;
}

/**
 * Loose "is this red, or close enough to CorelDraw's idea of red" check —
 * real-world exports use swatches like `#ED1C24`, not pure `#FF0000`.
 * Accepts hex (#rgb/#rrggbb), `rgb()`/`rgba()`, and the `red` keyword.
 */
function isReddish(color: string): boolean {
  const c = color.trim().toLowerCase();
  if (c === "red") return true;

  let r: number, g: number, b: number;

  const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);

  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else if (rgbMatch) {
    r = Number(rgbMatch[1]);
    g = Number(rgbMatch[2]);
    b = Number(rgbMatch[3]);
  } else {
    return false;
  }

  // Red channel clearly dominant over green/blue, and bright enough not to
  // be a dark brown/maroon fill mistaken for a cut line.
  return r >= 150 && r > g * 1.3 && r > b * 1.3;
}

/**
 * A `<path>`/`<polygon>` counts as the designer's cut line if:
 * - its own id, or an ancestor `<g>`'s id, matches `cut-line` (any of the
 *   usual spellings), OR
 * - its resolved (self-or-inherited) stroke color is reddish, OR
 * - its resolved fill is `none` — real CorelDraw exports often leave the
 *   cut-line path completely unpainted (no stroke color set anywhere in
 *   its ancestor chain either), relying on it being geometry-only, unlike
 *   filled artwork which always carries a visible fill color.
 */
function isCutLine(el: SvgNode): boolean {
  if (idMatchesSelfOrAncestor(el)) return true;

  const stroke = resolveInherited(el, "stroke", "none");
  const fill = resolveInherited(el, "fill", "black");

  if (stroke !== "none" && isReddish(stroke)) return true;
  if (fill === "none") return true;

  return false;
}

/** Converts a `<polygon points="...">` attribute into an SVG path `d` string. */
function polygonPointsToPathData(points: string): string | null {
  const coords = points
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (coords.length < 6 || coords.length % 2 !== 0 || coords.some(Number.isNaN)) return null;

  let d = "";
  for (let i = 0; i < coords.length; i += 2) {
    d += i === 0 ? `M ${coords[i]},${coords[i + 1]}` : ` L ${coords[i]},${coords[i + 1]}`;
  }
  return `${d} Z`;
}

function readViewBoxBounds(svgEl: { getAttribute(name: string): string | null }): PathBounds | null {
  const viewBox = svgEl.getAttribute("viewBox");
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function unionPathBounds(dList: string[]): PathBounds | null {
  let union: PathBounds | null = null;
  for (const d of dList) {
    const b = getPathBounds(d);
    if (!b) continue;
    union = union
      ? {
          x: Math.min(union.x, b.x),
          y: Math.min(union.y, b.y),
          width: Math.max(union.x + union.width, b.x + b.width) - Math.min(union.x, b.x),
          height: Math.max(union.y + union.height, b.y + b.height) - Math.min(union.y, b.y),
        }
      : b;
  }
  return union;
}

/**
 * Parses a designer-authored character SVG (from CorelDraw/Illustrator) that
 * already includes its own laser cut-line path or polygon. The cut line is
 * detected — on the element itself OR inherited from a wrapping `<g>`,
 * since CorelDraw commonly styles the group rather than the shape — by
 * `id="cut-line"`, a reddish stroke (any shade, not just pure #FF0000), or
 * a bare unfilled stroke (stroke set, fill:none). Returns null if the
 * source isn't parseable SVG or has no <path>/<polygon> elements at all —
 * callers should fall back to treating the file as a plain raster image in
 * that case.
 */
export function parseCharacterSvg(svgSource: string): CharacterVector | null {
  let doc;
  try {
    doc = new DOMParser().parseFromString(svgSource, "image/svg+xml");
  } catch {
    return null;
  }

  const svgEl = doc?.documentElement;
  if (!svgEl || svgEl.tagName?.toLowerCase() !== "svg") return null;

  const paths = Array.from(doc.getElementsByTagName("path"));
  const polygons = Array.from(doc.getElementsByTagName("polygon"));
  if (paths.length === 0 && polygons.length === 0) return null;

  const cutLinePaths: string[] = [];
  const allDs: string[] = [];

  for (const pathEl of paths) {
    const d = pathEl.getAttribute("d");
    if (!d) continue;
    allDs.push(d);
    if (isCutLine(pathEl)) {
      cutLinePaths.push(d);
      pathEl.parentNode?.removeChild(pathEl);
    }
  }

  for (const polyEl of polygons) {
    const points = polyEl.getAttribute("points");
    const d = points ? polygonPointsToPathData(points) : null;
    if (!d) continue;
    allDs.push(d);
    if (isCutLine(polyEl)) {
      cutLinePaths.push(d);
      polyEl.parentNode?.removeChild(polyEl);
    }
  }

  const bounds = readViewBoxBounds(svgEl) ?? unionPathBounds(allDs);
  if (!bounds) return null;

  const cleanedSvg = new XMLSerializer().serializeToString(doc);
  const artworkDataUri = `data:image/svg+xml;base64,${toBase64(cleanedSvg)}`;

  return { cutLinePaths, artworkDataUri, bounds, allShapePaths: allDs };
}
