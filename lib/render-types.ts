import type { GlyphSegment } from "@/lib/font-preview";

/**
 * Unified output every render path must produce — the existing "dynamic"
 * clipper/font auto-layout engine (lib/keychain-render.ts) and the "fixed"
 * layoutMode engine (lib/keychain-render-fixed.ts) alike — so the nesting
 * engine (app/api/staging/nest/route.ts) and every export/preview consumer
 * (StagingCanvas, export-dxf, export-print-svg) can stay engine-agnostic:
 * they only ever see this shape, never which renderer produced it.
 */
export interface KeychainRender {
  width: number;
  height: number;
  /** Red laser cutting line for the outer silhouette. */
  outlinePath: string | null;
  /** Red laser cutting line for the keyring hole. */
  holePath: string | null;
  textSegments: GlyphSegment[];
  characterImage: { dataUri: string; x: number; y: number; width: number; height: number } | null;
}
