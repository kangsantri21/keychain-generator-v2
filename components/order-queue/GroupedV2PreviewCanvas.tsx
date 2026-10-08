import { SHEET_WIDTH_MM, SHEET_HEIGHT_MM } from "@/lib/nesting/grouped-nesting-config";
import { getItemTransform, getContentSize } from "@/lib/staging-transform";
import type { GroupedV2PreviewItem, GroupedV2CanvasGroup } from "@/lib/nesting/grouped-nesting-preview";

/**
 * PHASE 2B visual validation canvas — dev/engineering tool only, rendered
 * from purely client-side (non-persisted) preview state, never from
 * `stagingItems`. Deliberately reuses `getItemTransform`/`getContentSize`
 * (lib/staging-transform.ts) UNCHANGED — the same functions the LEGACY
 * `StagingCanvas` uses — so an item's transform math is provably identical
 * between the two canvases; only its `posX`/`posY` (computed by Grouped
 * Nesting V2 instead of the legacy packer) differ.
 *
 * Renders, on top of each item's own real artwork:
 *   - one rectangular boundary per order group (groupX/groupY/groupWidth/
 *     groupHeight from the API response — preview-only, never exported).
 *   - one label per group (receiptCode, falling back to `Order #<id>` —
 *     see grouped-nesting-preview.ts's own `resolveGroupLabel`), and
 *     explicitly NO per-item receipt label (unlike legacy) — see this
 *     component's own item-rendering block below.
 *
 * A light, distinct boundary color per group is a debugging aid only
 * (`GROUP_COLORS`, cycled by index) — the label text remains the actual
 * identifier; nothing here depends on color to be unambiguous.
 */
const GROUP_COLORS = ["#014baa", "#c2410c", "#15803d", "#a21caf", "#b91c1c", "#0f766e"];

function colorForGroupIndex(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

export function GroupedV2PreviewCanvas({
  items,
  groups,
}: {
  items: GroupedV2PreviewItem[];
  groups: GroupedV2CanvasGroup[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <svg
        viewBox={`0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}`}
        className="h-auto w-full rounded border border-slate-300 bg-white"
        style={{ aspectRatio: `${SHEET_WIDTH_MM} / ${SHEET_HEIGHT_MM}` }}
      >
        {/* Item artwork — same transform helpers as legacy StagingCanvas, no per-item receipt label (that's a legacy-only concern; see this file's own top doc comment). */}
        {items.map((item, index) => {
          const content = getContentSize(item);
          return (
            <g key={index} transform={getItemTransform(item)}>
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

              {item.render?.textSegments.map((segment, segmentIndex) => (
                <path key={segmentIndex} d={segment.d} fill={segment.color} />
              ))}

              {!item.render && (
                <rect width={content.width} height={content.height} fill="#f8fafc" stroke="#cbd5e1" strokeDasharray="2 2" />
              )}

              {item.render?.outlinePath && (
                <path d={item.render.outlinePath} fill="none" stroke="red" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
              )}
              {item.render?.holePath && (
                <path d={item.render.holePath} fill="none" stroke="red" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
              )}
            </g>
          );
        })}

        {/* Group boundaries + one label each — preview-only visual aid, never part of any export. */}
        {groups.map((group, index) => {
          const color = colorForGroupIndex(index);
          return (
            <g key={index}>
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                fill="none"
                stroke={color}
                strokeWidth={0.6}
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
              />
              <text x={group.x + 1} y={group.y + 4} fontSize={3.2} fill={color} fontWeight={600}>
                {group.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
