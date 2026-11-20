"use client";

import { useState } from "react";
import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, RECEIPT_LABEL_FONT_SIZE_MM } from "@/lib/keychain-geometry";
import { activeProductionFrame, rectToFiducial } from "@/lib/active-frame";
import { getItemTransform, getContentSize, getReceiptLabelPosition } from "@/lib/staging-transform";
import { receiptBoxes } from "@/lib/production-gate";
import { internalLabelsOf } from "@/lib/receipt-labels";
import { compactionTags, productionGroupOverlay, readRememberedCompaction, type RememberedCompaction } from "@/lib/staging-overlay";
import { FIDUCIAL_CLEARANCE_MM } from "@/lib/nesting/grouped-nesting-config";
import type { StagingSheet } from "@/lib/staging-types";


type Box = ReturnType<typeof receiptBoxes>[number];

/** Debug overlay: gap from each receipt to its nearest neighbour on the right (overlapping rows) and below (overlapping columns). */
function neighbourGaps(boxes: Box[]) {
  const gaps: { x: number; y: number; text: string }[] = [];
  for (const a of boxes) {
    let right: { d: number; b: Box } | null = null;
    let below: { d: number; b: Box } | null = null;
    for (const b of boxes) {
      if (a === b) continue;
      const rowOverlap = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - Math.max(a.rect.y, b.rect.y);
      const colOverlap = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - Math.max(a.rect.x, b.rect.x);
      const dx = b.rect.x - (a.rect.x + a.rect.w);
      const dy = b.rect.y - (a.rect.y + a.rect.h);
      if (rowOverlap > 0 && dx >= 0 && (!right || dx < right.d)) right = { d: dx, b };
      if (colOverlap > 0 && dy >= 0 && (!below || dy < below.d)) below = { d: dy, b };
    }
    if (right) {
      const y = (Math.max(a.rect.y, right.b.rect.y) + Math.min(a.rect.y + a.rect.h, right.b.rect.y + right.b.rect.h)) / 2;
      gaps.push({ x: a.rect.x + a.rect.w + right.d / 2, y, text: `↔ ${right.d.toFixed(1)}` });
    }
    if (below) {
      const x = (Math.max(a.rect.x, below.b.rect.x) + Math.min(a.rect.x + a.rect.w, below.b.rect.x + below.b.rect.w)) / 2;
      gaps.push({ x, y: a.rect.y + a.rect.h + below.d / 2 + 1, text: `↕ ${below.d.toFixed(1)}` });
    }
  }
  return gaps;
}

export function StagingCanvas({ sheet }: { sheet: StagingSheet | null }) {
  const [showDebug, setShowDebug] = useState(false);
  const [rememberedCompaction, setRememberedCompaction] = useState<RememberedCompaction[]>([]);
  // Production Nesting sheets: one dashed outline per receipt (screen only —
  // not part of any export); the external receipt code only in debug view.
  // Legacy sheets mix receipts, so they keep only the per-item labels.
  const isProduction = sheet?.summary?.profile === "production";
  const groupBoxes = isProduction && sheet ? receiptBoxes(sheet.items) : [];
  const overlay = productionGroupOverlay(sheet, showDebug);

  // Same labels as the print export (lib/export-print-svg.ts): internal receipt labels on
  // Production sheets, the per-item labels on legacy sheets.
  const internalLabels = sheet ? internalLabelsOf(sheet) : null;
  const debugGaps = showDebug ? neighbourGaps(groupBoxes) : [];
  const debugCompaction = showDebug ? compactionTags(sheet, rememberedCompaction) : [];
  // The physical frame — the same one the print JPG and the DXF use (lib/active-frame.ts).
  const frame = sheet ? activeProductionFrame(sheet) : null;
  const frameWidth = frame?.widthMm ?? SHEET_WIDTH_MM;
  const frameHeight = frame?.heightMm ?? SHEET_HEIGHT_MM;
  const minFiducial =
    sheet && frame && sheet.items.length > 0
      ? Math.min(...sheet.items.flatMap((item) => frame.fiducials.map((f) => rectToFiducial({ x: item.posX, y: item.posY, w: item.width, h: item.height }, f))))
      : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {sheet && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Marker kamera: jarak artwork terdekat {minFiducial === null ? "-" : `${minFiducial.toFixed(1)} mm`} (min {FIDUCIAL_CLEARANCE_MM} mm)
          </span>
          {internalLabels && (
            <span>
              Label resi internal: {internalLabels.filter((label) => label.status === "PLACED").length}/{internalLabels.length}
              {internalLabels.some((label) => label.status === "NO_SAFE_INTERNAL_LABEL") && (
                <span className="ml-1 font-semibold text-amber-700">
                  · NO_SAFE_INTERNAL_LABEL:{" "}
                  {internalLabels
                    .filter((label) => label.status === "NO_SAFE_INTERNAL_LABEL")
                    .map((label) => label.text)
                    .join(", ")}
                </span>
              )}
            </span>
          )}
          {isProduction && (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showDebug} onChange={(event) => {
                  setShowDebug(event.target.checked);
                  if (event.target.checked) setRememberedCompaction(readRememberedCompaction());
                }} />
              Debug: jarak, kotak label &amp; kode resi luar
            </label>
          )}
        </div>
      )}
      <svg
        viewBox={`0 0 ${frameWidth} ${frameHeight}`}
        className="h-auto w-full rounded border border-slate-300 bg-white"
        style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}
      >
        {sheet?.items.map((item) => {
          const content = getContentSize(item);

          return (
            <g key={item.id} transform={getItemTransform(item)}>
              {item.render?.characterImage && (
                <image
                  href={item.render.characterImage.dataUri}
                  x={item.render.characterImage.x}
                  y={item.render.characterImage.y}
                  width={item.render.characterImage.width}
                  height={item.render.characterImage.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              )}

              {item.render?.textSegments.map((segment, index) => (
                <path key={index} d={segment.d} fill={segment.color} />
              ))}

              {!item.render && (
                <rect
                  width={content.width}
                  height={content.height}
                  fill="#f8fafc"
                  stroke="#cbd5e1"
                  strokeDasharray="2 2"
                />
              )}

              {item.render?.outlinePath && (
                <path
                  d={item.render.outlinePath}
                  fill="none"
                  stroke="red"
                  strokeWidth={0.3}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {item.render?.holePath && (
                <path
                  d={item.render.holePath}
                  fill="none"
                  stroke="red"
                  strokeWidth={0.3}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {item.order &&
                !internalLabels &&
                (() => {
                  const labelPos = getReceiptLabelPosition(item);
                  return (
                    <text x={labelPos.x} y={labelPos.y} fontSize={RECEIPT_LABEL_FONT_SIZE_MM} fill="#334155">
                      {item.order.receiptCode}
                    </text>
                  );
                })()}
            </g>
          );
        })}

        {overlay.outlines.map((outline) => (
          <rect
            key={`group-${outline.orderId}`}
            x={outline.x}
            y={outline.y}
            width={outline.w}
            height={outline.h}
            fill="none"
            stroke="#2563eb"
            strokeWidth={0.5}
            strokeDasharray="3 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {overlay.externalLabels.map((label) => (
          <text key={`group-code-${label.orderId}`} x={label.x} y={label.y} fontSize={3.2} fontWeight={700} fill="#1d4ed8">
            {label.text}
          </text>
        ))}

        {internalLabels
          ?.filter((label) => label.status === "PLACED")
          .map((label) => (
            <text
              key={`label-${label.orderId}`}
              transform={label.transform}
              x={0}
              y={0}
              fontSize={label.fontSize}
              textLength={label.textLength}
              lengthAdjust="spacingAndGlyphs"
              fill="#334155"
            >
              {label.text}
            </text>
          ))}
        {showDebug &&
          internalLabels?.map((label) =>
            label.rect ? (
              <rect
                key={`label-box-${label.orderId}`}
                x={label.rect.x}
                y={label.rect.y}
                width={label.rect.w}
                height={label.rect.h}
                fill="none"
                stroke="#16a34a"
                strokeWidth={0.3}
                vectorEffect="non-scaling-stroke"
              />
            ) : null
          )}

        {/* Camera fiducials (same positions as the JPG/DXF export) and their keep-out ring — screen only. */}
        {frame?.fiducials.map((c) => (
            <g key={`fiducial-${c.corner}`}>
              <circle cx={c.x} cy={c.y} r={c.r} fill="#0f172a" />
              <circle
                cx={c.x}
                cy={c.y}
                r={c.r + FIDUCIAL_CLEARANCE_MM}
                fill="none"
                stroke="#f97316"
                strokeWidth={0.4}
                strokeDasharray="1 1"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}

        {debugCompaction.map((tag) => (
          <text key={`compaction-${tag.orderId}`} x={tag.x} y={tag.y} fontSize={2.4} fontWeight={700} fill={tag.slack ? "#dc2626" : "#7c3aed"}>
            {tag.text}
          </text>
        ))}
        {debugGaps.map((gap, index) => (
          <text key={`gap-${index}`} x={gap.x} y={gap.y} fontSize={3} fontWeight={700} fill="#dc2626" textAnchor="middle" dominantBaseline="middle">
            {gap.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
