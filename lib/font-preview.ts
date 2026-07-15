import * as opentype from "opentype.js";

export interface GlyphSegment {
  d: string;
  color: string;
}

export interface ColoredTextRender {
  segments: GlyphSegment[];
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * opentype.js's TrueType curve decoding can emit a numeric NaN for a
 * control point on certain glyphs/fonts (bad source point data feeding an
 * implied-on-curve-midpoint calculation — observed even on plain letters
 * like "a"/"v"/"e" in some uploaded fonts, not just accented characters),
 * which `toPathData()` then serializes as the literal text "NaN".
 *
 * SVG's error-recovery rule truncates parsing of the *entire rest* of the
 * path at the first invalid token, so one bad control point can silently
 * cut off the remainder of a letter — this must never reach the DOM as-is.
 *
 * Do NOT substitute a fabricated coordinate for the NaN (e.g. reusing the
 * last valid number seen): that produces a syntactically valid but
 * geometrically arbitrary point, which draws a long straight stray line
 * clear across the glyph when the path jumps to it — a laser would cut
 * that spike for real. Instead drop just the individual drawing command
 * that contains the NaN — the path cursor simply continues from wherever
 * it already was straight to the next (valid) command's point, which for
 * font curves is always a small local segment, not a cross-glyph jump.
 */
function sanitizePathData(d: string): string {
  if (!d.includes("NaN")) return d;

  // A glyph's path can contain several subpaths (e.g. "a"'s outer contour
  // and inner counter, or "i"'s stem and dot) — handle each independently
  // so a bad command never bleeds across a subpath boundary onto a
  // previous, otherwise-clean contour.
  const subpaths = d.match(/[Mm][^Mm]*/g) ?? [];

  const cleanedSubpaths = subpaths.map((subpath) => {
    // Command letter followed by all its numeric args, up to (not
    // including) the next command letter.
    const commands = subpath.match(/[MLCQZmlcqz][^MLCQZmlcqz]*/g) ?? [];

    // The subpath must still open with a moveto — if that anchor point
    // itself is corrupted there's no valid position to resume from, so
    // this whole subpath is unrecoverable and gets dropped entirely.
    if (commands.length === 0 || !commands[0] || commands[0].includes("NaN")) return "";

    // Otherwise drop just the individual bad drawing commands — the cursor
    // continues from wherever it already was straight to the next valid
    // point, a small local segment rather than a cross-glyph jump.
    return commands.filter((cmd) => !cmd.includes("NaN")).join(" ");
  });

  return cleanedSubpaths.filter(Boolean).join(" ");
}

/**
 * Renders each glyph of `text` as its own path, cycling through `colors`
 * per character. Pure opentype.js logic — safe to call from both the
 * server (thumbnail generation) and the browser (live preview).
 */
export function renderColoredGlyphs(
  font: opentype.Font,
  text: string,
  fontSize: number,
  colors: string[]
): ColoredTextRender {
  const fullBbox = font.getPath(text, 0, 0, fontSize).getBoundingBox();
  const segments: GlyphSegment[] = [];
  let colorIndex = 0;

  font.forEachGlyph(text, 0, 0, fontSize, undefined, (glyph, x, y, gFontSize) => {
    const d = glyph.getPath(x, y, gFontSize).toPathData(2);
    if (d) {
      segments.push({ d: sanitizePathData(d), color: colors[colorIndex % colors.length] ?? "#1e293b" });
    }
    colorIndex += 1;
  });

  return {
    segments,
    bbox: { x1: fullBbox.x1, y1: fullBbox.y1, x2: fullBbox.x2, y2: fullBbox.y2 },
  };
}

/**
 * Renders `text` scaled so its own raw glyph bounding-box height matches
 * `targetHeight` exactly (same unit as the caller — mm for production, px
 * for a preview canvas), regardless of the font's internal metrics or which
 * characters (with/without descenders) happen to be in this particular
 * name. Fixed-fontSize rendering can't guarantee a physical size spec across
 * arbitrary uploaded fonts; this measures the actual text once at a
 * calibration size, then rescales proportionally to hit the target exactly.
 */
export function renderColoredGlyphsAtHeight(
  font: opentype.Font,
  text: string,
  targetHeight: number,
  colors: string[]
): ColoredTextRender {
  const CALIBRATION_SIZE = 100;
  const calibration = renderColoredGlyphs(font, text, CALIBRATION_SIZE, colors);
  const rawHeight = calibration.bbox.y2 - calibration.bbox.y1;
  if (!(rawHeight > 0)) return calibration; // degenerate text (e.g. blank) — nothing to scale
  const fontSize = CALIBRATION_SIZE * (targetHeight / rawHeight);
  return renderColoredGlyphs(font, text, fontSize, colors);
}

/**
 * "Template Karakter" thumbnail: character image on the left, colored text
 * rendered from the uploaded font on the right, wrapped in a joint pill
 * outline (a sneak peek of the Modul C keychain shape).
 */
export function generateCharacterPreviewSvg(
  characterImageBuffer: Buffer,
  characterExt: string,
  fontArrayBuffer: ArrayBuffer,
  text: string,
  colors: string[]
): string {
  const sampleText = text.trim() || "Nama";
  const mimeType = characterExt === ".svg" ? "image/svg+xml" : "image/png";
  const imageDataUri = `data:${mimeType};base64,${characterImageBuffer.toString("base64")}`;

  const imageBoxSize = 140;
  const outerPadding = 16;
  const innerTextPadding = 16;
  const gap = 20;

  let textPaths: string;
  let textWidth: number;
  let textTranslateX = 0;
  let textTranslateY = 0;

  try {
    const font = opentype.parse(fontArrayBuffer);
    const fontSize = 56;
    const { segments, bbox } = renderColoredGlyphs(font, sampleText, fontSize, colors);
    textPaths = segments.map((s) => `<path d="${s.d}" fill="${s.color}" />`).join("\n    ");
    textWidth = Math.max(bbox.x2 - bbox.x1, 40) + innerTextPadding * 2;
    textTranslateX = innerTextPadding - bbox.x1;
    textTranslateY = imageBoxSize / 2 - (bbox.y1 + bbox.y2) / 2;
  } catch {
    textPaths = `<text x="${innerTextPadding}" y="${imageBoxSize / 2 + 10}" font-family="sans-serif" font-size="28" fill="${colors[0] ?? "#1e293b"}">${escapeXml(sampleText)}</text>`;
    textWidth = Math.max(sampleText.length * 20, 80) + innerTextPadding * 2;
  }

  const textBoxX = outerPadding + imageBoxSize + gap;
  const totalWidth = textBoxX + textWidth + outerPadding;
  const totalHeight = imageBoxSize + outerPadding * 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}">
  <rect x="2" y="2" width="${totalWidth - 4}" height="${totalHeight - 4}" rx="${totalHeight / 2}" ry="${totalHeight / 2}" fill="#ffffff" stroke="#1e293b" stroke-width="3" />
  <image href="${imageDataUri}" x="${outerPadding}" y="${outerPadding}" width="${imageBoxSize}" height="${imageBoxSize}" preserveAspectRatio="xMidYMid meet" />
  <g transform="translate(${textBoxX + textTranslateX}, ${outerPadding + textTranslateY})">
    ${textPaths}
  </g>
</svg>`;
}
