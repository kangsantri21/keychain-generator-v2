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
      segments.push({ d, color: colors[colorIndex % colors.length] ?? "#1e293b" });
    }
    colorIndex += 1;
  });

  return {
    segments,
    bbox: { x1: fullBbox.x1, y1: fullBbox.y1, x2: fullBbox.x2, y2: fullBbox.y2 },
  };
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
