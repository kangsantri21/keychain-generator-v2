"use client";

import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM, RECEIPT_LABEL_FONT_SIZE_MM } from "@/lib/keychain-geometry";
import { getItemTransform, getContentSize, getReceiptLabelY } from "@/lib/staging-transform";
import type { StagingSheet } from "@/lib/staging-types";

export function StagingCanvas({ sheet }: { sheet: StagingSheet | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <svg
        viewBox={`0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}`}
        className="h-auto w-full rounded border border-slate-300 bg-white"
        style={{ aspectRatio: `${SHEET_WIDTH_MM} / ${SHEET_HEIGHT_MM}` }}
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

              {item.order && (
                <text x={0.5} y={getReceiptLabelY(item)} fontSize={RECEIPT_LABEL_FONT_SIZE_MM} fill="#334155">
                  {item.order.receiptCode}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
