/**
 * SVG picture of a nested sheet, for the before/after images shown to Rofiq.
 * One file per sheet. Colours mark receipts. Frames and codes are drawn for
 * the shape-block result; the older box layout has neither.
 */
import { SHEET_HEIGHT_MM, SHEET_WIDTH_MM } from "@/lib/keychain-geometry";
import { framesAndLabels, type MarkItem } from "@/lib/nesting/shape-block-marks";
import type { Pt } from "@/lib/nesting/shape-outline";

const PALETTE = ["#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777", "#4d7c0f", "#0f766e", "#b45309", "#be123c"];

export interface PreviewPiece {
  orderId: number;
  code: string;
  name: string;
  sheetIndex: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotationDeg: 0 | 90 | 180 | 270;
  /** Outline in unrotated artwork space. Drawn with the piece's rotation. */
  outline: Pt[][];
  contentWidth: number;
  contentHeight: number;
}

function rot(point: Pt, deg: number, w: number, h: number): Pt {
  if (deg === 90) return { x: h - point.y, y: point.x };
  if (deg === 180) return { x: w - point.x, y: h - point.y };
  if (deg === 270) return { x: point.y, y: w - point.x };
  return point;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function piecePath(piece: PreviewPiece): string {
  return piece.outline
    .map((poly) => {
      const pts = poly.map((p) => rot(p, piece.rotationDeg, piece.contentWidth, piece.contentHeight));
      const minX = Math.min(...pts.map((p) => p.x));
      const minY = Math.min(...pts.map((p) => p.y));
      return pts
        .map((p, i) => `${i === 0 ? "M" : "L"}${((piece.posX + p.x - minX).toFixed(2))} ${((piece.posY + p.y - minY).toFixed(2))}`)
        .join(" ") + " Z";
    })
    .join(" ");
}

export function renderSheetSvg(pieces: PreviewPiece[], sheetIndex: number, title: string, withMarks: boolean): string {
  const onSheet = pieces.filter((piece) => piece.sheetIndex === sheetIndex);
  const marks = withMarks
    ? framesAndLabels(
        onSheet.map((piece) => ({ orderId: piece.orderId, posX: piece.posX, posY: piece.posY, width: piece.width, height: piece.height })),
        (orderId) => onSheet.find((piece) => piece.orderId === orderId)?.code ?? ""
      )
    : { frames: [], labels: [] };
  const paths = onSheet
    .map((piece) => {
      const color = PALETTE[(piece.orderId - 1) % PALETTE.length];
      const cx = piece.posX + piece.width / 2;
      const cy = piece.posY + piece.height / 2;
      const name = escapeXml(piece.name);
      return `<path d="${piecePath(piece)}" fill="${color}" fill-opacity="0.88" stroke="#111" stroke-width="0.25"><title>${escapeXml(piece.code)} ${name}</title></path>
  <text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="3.2" text-anchor="middle" dominant-baseline="middle" fill="#111" transform="rotate(${piece.rotationDeg} ${cx.toFixed(2)} ${cy.toFixed(2)})">${name}</text>`;
    })
    .join("\n");
  const frames = marks.frames
    .map((frame) => `<rect x="${frame.x.toFixed(2)}" y="${frame.y.toFixed(2)}" width="${frame.w.toFixed(2)}" height="${frame.h.toFixed(2)}" fill="none" stroke="#111" stroke-width="0.35"/>`)
    .join("\n");
  const labels = marks.labels
    .map(
      (label) =>
        `<text transform="${label.transform}" font-size="${label.fontSize}" textLength="${label.textLength}" lengthAdjust="spacingAndGlyphs" fill="#111">${label.text}</text>`
    )
    .join("\n");
  const fiducials = [2.5, SHEET_WIDTH_MM - 2.5].flatMap((x) =>
    [2.5, SHEET_HEIGHT_MM - 2.5].map((y) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#111"/>`)
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MM}mm" height="${SHEET_HEIGHT_MM}mm" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}">
  <title>${title}</title>
  <rect width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.4"/>
  ${paths}
  ${frames}
  ${labels}
  ${fiducials.join("\n  ")}
</svg>
`;
}

export type { MarkItem };
