import { maharShapePoints, pointsToSvgPath } from "@/lib/mahar-shapes";
import { formatWeddingDate } from "@/lib/mahar-format";
import type { MaharOrderFields } from "@/lib/mahar-types";

/**
 * One plaque's cut-line + engraved/printed text, rendered as plain SVG —
 * shared by /mahar-generator's single-item Live Preview and /mahar-
 * nesting's sheet canvas (one <MaharShapePreview> per nested item, inside
 * its own <g transform="translate(...)">). Deliberately plain <text>
 * elements, not per-glyph outline paths: a mahar plaque's names are
 * printed/engraved, not laser-cut letter by letter the way a keychain's
 * are, so there's no font/Clipper pipeline needed here at all.
 */
export function MaharShapePreview({
  widthMm,
  heightMm,
  fields,
}: {
  widthMm: number;
  heightMm: number;
  fields: MaharOrderFields;
}) {
  const outline = pointsToSvgPath(maharShapePoints(fields.frameShape, widthMm, heightMm));
  const cx = widthMm / 2;
  const cy = heightMm / 2;
  // Text block scales down for a small plaque — clamps to a sane range so
  // an unusually tiny/huge custom size never produces illegible or
  // wildly-oversized text.
  const baseFontSize = Math.min(Math.max(heightMm * 0.09, 6), 22);

  return (
    <>
      <path d={outline} fill="#ffffff" stroke="#dc2626" strokeWidth={Math.max(widthMm * 0.003, 0.3)} />
      <text
        x={cx}
        y={cy - baseFontSize * 0.9}
        textAnchor="middle"
        fontSize={baseFontSize * 0.7}
        fill="#014baa"
        fontFamily="Georgia, serif"
      >
        {fields.nominal}
      </text>
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        fontSize={baseFontSize}
        fontWeight="bold"
        fill="#1c1917"
        fontFamily="Georgia, serif"
      >
        {fields.groomName} &amp; {fields.brideName}
      </text>
      <text
        x={cx}
        y={cy + baseFontSize * 1.1}
        textAnchor="middle"
        fontSize={baseFontSize * 0.6}
        fill="#57534e"
        fontFamily="Georgia, serif"
      >
        {formatWeddingDate(fields.weddingDate)}
      </text>
    </>
  );
}
