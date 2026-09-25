import type { KeychainRenderPayload } from "@/lib/staging-types";

/**
 * Draws one production-rendered keychain unit (outline, ring hole, colored
 * text/character) as plain SVG — the same visual primitives StagingCanvas.
 * tsx uses per item on a sheet, factored out so any other "show the actual
 * cut-ready output" surface (e.g. the Input Pesanan / Order Queue "Preview
 * Pesanan" modal) can reuse it standalone, without a sheet position.
 */
export function KeychainRenderSvg({ render, className }: { render: KeychainRenderPayload; className?: string }) {
  return (
    <svg viewBox={`0 0 ${render.width} ${render.height}`} className={className}>
      {render.characterImage && (
        <image
          href={render.characterImage.dataUri}
          x={render.characterImage.x}
          y={render.characterImage.y}
          width={render.characterImage.width}
          height={render.characterImage.height}
          preserveAspectRatio="xMidYMid meet"
        />
      )}

      {render.textSegments.map((segment, index) => (
        <path key={index} d={segment.d} fill={segment.color} />
      ))}

      {render.outlinePath && (
        <path d={render.outlinePath} fill="none" stroke="red" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
      )}
      {render.holePath && (
        <path d={render.holePath} fill="none" stroke="red" strokeWidth={0.3} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
