"use client";

import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/keychain-geometry";
import type { StagingSheet } from "@/lib/staging-types";

export function StagingCanvas({ sheet }: { sheet: StagingSheet | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <svg
        viewBox={`0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}`}
        className="h-auto w-full rounded border border-slate-300 bg-white"
        style={{ aspectRatio: `${SHEET_WIDTH_MM} / ${SHEET_HEIGHT_MM}` }}
      >
        {sheet?.items.map((item) => (
          <g key={item.id} transform={`translate(${item.posX}, ${item.posY})`}>
            {item.render?.characterImage && (
              <image
                href={item.render.characterImage.dataUri}
                x={item.render.characterImage.x}
                y={item.render.characterImage.y}
                width={item.render.characterImage.size}
                height={item.render.characterImage.size}
                preserveAspectRatio="xMidYMid meet"
              />
            )}

            {item.render?.textSegments.map((segment, index) => (
              <path key={index} d={segment.d} fill={segment.color} />
            ))}

            {!item.render && (
              <rect
                width={item.width}
                height={item.height}
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
          </g>
        ))}
      </svg>
    </div>
  );
}
