import { MAHAR_SHEET_WIDTH_MM, MAHAR_SHEET_HEIGHT_MM } from "@/lib/mahar-geometry";
import { getMaharItemTransform, getMaharContentSize } from "@/lib/mahar-transform";
import type { MaharLayoutItem } from "@/lib/mahar-types";
import { MaharShapePreview } from "./MaharShapePreview";

export function MaharSheetCanvas({ items }: { items: MaharLayoutItem[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <svg
        viewBox={`0 0 ${MAHAR_SHEET_WIDTH_MM} ${MAHAR_SHEET_HEIGHT_MM}`}
        className="h-auto w-full rounded border border-slate-300 bg-white"
        style={{ aspectRatio: `${MAHAR_SHEET_WIDTH_MM} / ${MAHAR_SHEET_HEIGHT_MM}` }}
      >
        {items.map((item) => {
          const content = getMaharContentSize(item);
          return (
            <g key={item.orderId} transform={getMaharItemTransform(item)}>
              <MaharShapePreview widthMm={content.width} heightMm={content.height} fields={item} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
